'use strict';
/**
 * Залізна Зміна — сервер без зовнішніх залежностей (чистий Node.js).
 *
 * Що вміє:
 *  - акаунти (реєстрація / вхід / профіль) із безпечними сесіями (HttpOnly cookie)
 *  - паролі через scrypt, старі акаунти автоматично мігруються при першому вході
 *  - історії, листи, меми, лайки
 *  - ЗАХОДИ: публікуються з міні-сайту /admin за ключем адміністратора
 *  - фото зберігаються файлами (uploads/), а не у JSON
 *  - ліміти запитів, перевірка вводу, атомарний запис даних
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const zlib = require('zlib');
const { promisify } = require('util');
const scrypt = promisify(crypto.scrypt);

// ───────────────────────── Налаштування ─────────────────────────
const ROOT = __dirname;
const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : ROOT;
const DATA_FILE = path.join(DATA_DIR, 'data.json');
const UPLOAD_DIR = path.join(DATA_DIR, 'uploads');
const PORT = process.env.PORT || 3000;
const HOST = '0.0.0.0';
const ADMIN_KEY = process.env.ADMIN_PASSWORD || '';
const ADMIN_ENABLED = !!ADMIN_KEY && ADMIN_KEY !== 'change-me-please';
const SESSION_DAYS = 30;
const MAX_BODY = 9 * 1024 * 1024; // 9 МБ (фото приходять стиснутими з браузера)
const EVENT_CATEGORIES = ['meetup', 'workshop', 'party', 'charity', 'online', 'other'];
const RESERVED_USERNAMES = new Set(['admin', 'administrator', 'root', 'api', 'system', 'support', 'moderator',
  'poshtokratia', 'zalizna', 'zmina', 'uploads', 'null', 'undefined', 'me']);

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// ───────────────────────── Помічники ─────────────────────────
class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const bad = (m) => new HttpError(400, m);
const newId = () => crypto.randomBytes(8).toString('hex');
const nowIso = () => new Date().toISOString();
const uaDate = () => new Date().toLocaleDateString('uk-UA');

function text(v, { min = 0, max, label, multiline = false }) {
  if (v === undefined || v === null) v = '';
  if (typeof v !== 'string') throw bad(`${label}: некоректне значення`);
  let s = v.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
  s = multiline ? s.trim() : s.replace(/\s+/g, ' ').trim();
  if (s.length < min) throw bad(min === 1 ? `${label}: це поле обов'язкове` : `${label}: мінімум ${min} символи`);
  if (s.length > max) throw bad(`${label}: максимум ${max} символів`);
  return s;
}

function safeEqual(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  if (x.length !== y.length) return false;
  return crypto.timingSafeEqual(x, y);
}

function clientIp(req) {
  const xff = String(req.headers['x-forwarded-for'] || '').split(',').map((s) => s.trim()).filter(Boolean);
  return xff.length ? xff[xff.length - 1] : (req.socket.remoteAddress || 'unknown');
}

// ───────────────────────── Ліміти запитів ─────────────────────────
const buckets = new Map();
function hit(key, max, windowMs) {
  const t = Date.now();
  let b = buckets.get(key);
  if (!b || b.reset < t) { b = { n: 0, reset: t + windowMs }; buckets.set(key, b); }
  b.n += 1;
  return b.n <= max;
}
function peek(key, max) {
  const b = buckets.get(key);
  return !b || b.reset < Date.now() || b.n < max;
}
function limit(key, max, windowMs) {
  if (!hit(key, max, windowMs)) throw new HttpError(429, 'Забагато спроб. Спробуй за кілька хвилин.');
}
setInterval(() => {
  const t = Date.now();
  for (const [k, b] of buckets) if (b.reset < t) buckets.delete(k);
}, 60 * 1000).unref();

// ───────────────────────── Зображення ─────────────────────────
const IMG_TYPES = {
  'image/jpeg': { ext: '.jpg', magic: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  'image/png': { ext: '.png', magic: (b) => b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 },
  'image/webp': { ext: '.webp', magic: (b) => b.slice(0, 4).toString() === 'RIFF' && b.slice(8, 12).toString() === 'WEBP' },
  'image/gif': { ext: '.gif', magic: (b) => b.slice(0, 3).toString() === 'GIF' },
};

function decodeImage(dataUrl, maxBytes) {
  if (typeof dataUrl !== 'string') throw bad('Фото: некоректний формат');
  const m = /^data:(image\/[a-z]+);base64,/.exec(dataUrl.slice(0, 40));
  if (!m || !IMG_TYPES[m[1]]) throw bad('Фото: дозволені лише JPG, PNG, WEBP, GIF');
  const buf = Buffer.from(dataUrl.slice(m[0].length), 'base64');
  if (!buf.length) throw bad('Фото порожнє');
  if (buf.length > maxBytes) throw bad(`Фото завелике (максимум ${Math.round(maxBytes / 1024 / 1024 * 10) / 10} МБ)`);
  if (!IMG_TYPES[m[1]].magic(buf)) throw bad('Фото пошкоджене або має хибний формат');
  return { buf, ext: IMG_TYPES[m[1]].ext };
}

function storeImage(dataUrl, maxBytes) {
  const { buf, ext } = decodeImage(dataUrl, maxBytes);
  const name = crypto.randomBytes(14).toString('hex') + ext;
  fs.writeFileSync(path.join(UPLOAD_DIR, name), buf);
  return '/uploads/' + name;
}

function removeImage(url) {
  if (typeof url !== 'string' || !url.startsWith('/uploads/')) return;
  const name = path.basename(url);
  if (!/^[a-f0-9]+\.(jpg|png|webp|gif)$/.test(name)) return;
  fs.unlink(path.join(UPLOAD_DIR, name), () => {});
}

// ───────────────────────── Сховище даних ─────────────────────────
let db;

function emptyDb() {
  return { meta: { secret: '', version: 2 }, users: [], cards: [], letters: [], memes: [], events: [], follows: [] };
}

function saveDb() {
  const tmp = DATA_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db));
  fs.renameSync(tmp, DATA_FILE);
}

function loadDb() {
  let raw = null;
  if (fs.existsSync(DATA_FILE)) {
    try {
      raw = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    } catch (err) {
      const backup = path.join(DATA_DIR, `data.corrupt-${Date.now()}.json`);
      try { fs.copyFileSync(DATA_FILE, backup); } catch (e) { /* ignore */ }
      console.error('⚠️  data.json пошкоджений, копію збережено:', backup);
    }
  }
  db = emptyDb();
  if (raw && typeof raw === 'object') {
    for (const k of ['users', 'cards', 'letters', 'memes', 'events', 'follows']) if (Array.isArray(raw[k])) db[k] = raw[k];
    if (raw.meta && typeof raw.meta === 'object') db.meta = { ...db.meta, ...raw.meta };
  }
  migrate();
  saveDb();
}

function migrate() {
  db.meta.secret = process.env.SESSION_SECRET || db.meta.secret || crypto.randomBytes(32).toString('hex');
  db.meta.version = 2;

  // користувачі зі старої версії → додаємо username, bio тощо
  const taken = new Set();
  for (const u of db.users) {
    u.id = String(u.id || newId());
    u.email = String(u.email || '').toLowerCase();
    u.name = String(u.name || 'Учасник').slice(0, 40);
    u.bio = u.bio || '';
    u.avatar = u.avatar || null;
    u.tv = u.tv || 0;
    u.createdAt = u.createdAt || nowIso();
    let base = String(u.username || (u.email.split('@')[0] || 'user')).toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 20);
    if (base.length < 3) base = (base + 'user').slice(0, 20);
    let candidate = base;
    let i = 1;
    while (taken.has(candidate) || RESERVED_USERNAMES.has(candidate)) { candidate = base.slice(0, 16) + (++i); }
    u.username = candidate;
    taken.add(candidate);
  }

  const fix = (list, imgField) => {
    for (const item of list) {
      item.id = String(item.id || newId());
      if (!Array.isArray(item.likes)) item.likes = [];
      if (!item.createdAt) item.createdAt = nowIso();
      if (item.userId !== undefined && item.userId !== null) item.userId = String(item.userId);
      // старі фото у base64 → у файли
      if (imgField && typeof item[imgField] === 'string' && item[imgField].startsWith('data:')) {
        try { item[imgField] = storeImage(item[imgField], 8 * 1024 * 1024); } catch (e) { item[imgField] = null; }
      }
    }
  };
  fix(db.cards, 'photo');
  fix(db.memes, 'photo');
  fix(db.letters, null);
  db.follows = db.follows.filter((f) => f && f.from && f.to && f.from !== f.to);
  for (const e of db.events) {
    e.id = String(e.id || newId());
    if (!Array.isArray(e.going)) e.going = [];
    if (!e.status) e.status = 'published';
  }
}

const userById = (id) => (id ? db.users.find((u) => u.id === String(id)) : null);

// ───────────────────────── Паролі та сесії ─────────────────────────
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

async function hashPassword(password, salt) {
  return (await scrypt(String(password), salt, 64, { N: 16384, r: 8, p: 1 })).toString('hex');
}

async function verifyPassword(user, password) {
  if (user.algo === 'scrypt') {
    return safeEqual(await hashPassword(password, user.salt), user.pw);
  }
  // стара схема (sha256, можливо із сіллю) — перевіряємо й одразу оновлюємо
  const legacy = user.password_hash || '';
  const ok = legacy && safeEqual(sha256(String(user.salt || '') + String(password)), legacy);
  if (ok) {
    user.salt = crypto.randomBytes(16).toString('hex');
    user.pw = await hashPassword(password, user.salt);
    user.algo = 'scrypt';
    delete user.password_hash;
    saveDb();
  }
  return ok;
}

const hmac = (s) => crypto.createHmac('sha256', db.meta.secret).update(s).digest('base64url');

function makeToken(user) {
  const payload = `${user.id}.${user.tv || 0}.${Date.now() + SESSION_DAYS * 86400000}`;
  return Buffer.from(payload).toString('base64url') + '.' + hmac(payload);
}

function parseCookies(req) {
  const out = {};
  for (const part of String(req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return out;
}

function sessionUser(req) {
  const token = parseCookies(req).zz_session;
  if (!token) return null;
  const [b64, sig] = token.split('.');
  if (!b64 || !sig) return null;
  let payload;
  try { payload = Buffer.from(b64, 'base64url').toString(); } catch (e) { return null; }
  if (!safeEqual(hmac(payload), sig)) return null;
  const [uid, tv, exp] = payload.split('.');
  if (Number(exp) < Date.now()) return null;
  const user = userById(uid);
  if (!user || (user.tv || 0) !== Number(tv)) return null;
  return user;
}

function isSecure(req) {
  return !!req.socket.encrypted || String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https';
}

function sessionCookie(req, user) {
  const base = `zz_session=${makeToken(user)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}`;
  return isSecure(req) ? base + '; Secure' : base;
}
function clearCookie(req) {
  const base = 'zz_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0';
  return isSecure(req) ? base + '; Secure' : base;
}

// ───────────────────────── Адмін-ключ ─────────────────────────
function adminGuard(req, { silent = false } = {}) {
  const provided = req.headers['x-admin-password'];
  if (!provided) {
    if (silent) return false;
    throw new HttpError(401, 'Потрібен ключ адміністратора');
  }
  if (!ADMIN_ENABLED) {
    throw new HttpError(503, 'Адмін-доступ вимкнено: задай змінну середовища ADMIN_PASSWORD на сервері (Render → Environment).');
  }
  const ip = clientIp(req);
  if (!peek('adminfail:' + ip, 10)) throw new HttpError(429, 'Забагато невдалих спроб. Спробуй за 15 хвилин.');
  if (!safeEqual(provided, ADMIN_KEY)) {
    hit('adminfail:' + ip, 10, 15 * 60 * 1000);
    throw new HttpError(401, 'Невірний ключ адміністратора');
  }
  return true;
}

// ───────────────────────── Представлення даних ─────────────────────────
const brief = (u) => (u ? { username: u.username, name: u.name, avatar: u.avatar || null } : null);
const pubUser = (u) => ({ username: u.username, name: u.name, bio: u.bio || '', avatar: u.avatar || null, joined: u.createdAt });
const followersOf = (uid) => db.follows.filter((f) => f.to === uid);
const followingOf = (uid) => db.follows.filter((f) => f.from === uid);
const isFollowing = (a, b) => db.follows.some((f) => f.from === a && f.to === b);
const meUser = (u) => ({
  ...pubUser(u), email: u.email,
  following: followingOf(u.id).map((f) => userById(f.to)).filter(Boolean).map((x) => x.username),
  followers: followersOf(u.id).length,
});

function viewCard(c, viewer) {
  const u = userById(c.userId);
  return {
    id: c.id, name: u ? u.name : (c.name || 'Анонім'), story: c.story || '', photo: c.photo || null,
    date: c.date || '', createdAt: c.createdAt, author: brief(u),
    likes: c.likes.length, liked: !!viewer && c.likes.includes(viewer.id), mine: !!viewer && c.userId === viewer.id,
  };
}
function viewMeme(m, viewer) {
  const u = userById(m.userId);
  return {
    id: m.id, title: m.title || '', text: m.text || '', photo: m.photo || null,
    author_name: u ? u.name : (m.author_name || 'Анонім'), date: m.date || '', createdAt: m.createdAt, author: brief(u),
    likes: m.likes.length, liked: !!viewer && m.likes.includes(viewer.id), mine: !!viewer && m.userId === viewer.id,
  };
}
function viewLetter(l) {
  const u = userById(l.userId);
  return { id: l.id, author: u ? u.name : (l.author || 'Анонім'), recipient: l.recipient || '', message: l.message || '',
    date: l.date || '', createdAt: l.createdAt, authorInfo: brief(u) };
}
function viewEvent(e, viewer) {
  return {
    id: e.id, title: e.title, text: e.text, category: e.category, date: e.date || '', place: e.place || '',
    link: e.link || '', cover: e.cover || null, pinned: !!e.pinned, status: e.status, createdAt: e.createdAt,
    going: e.going.length, goingMe: !!viewer && e.going.includes(viewer.id),
  };
}

function removeUserTraces(user) {
  for (const key of ['cards', 'memes']) {
    const list = db[key];
    for (let i = list.length - 1; i >= 0; i--) {
      if (list[i].userId === user.id) { removeImage(list[i].photo); list.splice(i, 1); }
      else list[i].likes = list[i].likes.filter((x) => x !== user.id);
    }
  }
  db.letters = db.letters.filter((l) => l.userId !== user.id);
  db.follows = db.follows.filter((f) => f.from !== user.id && f.to !== user.id);
  for (const e of db.events) e.going = e.going.filter((x) => x !== user.id);
  removeImage(user.avatar);
  db.users = db.users.filter((u) => u.id !== user.id);
}

// ───────────────────────── Маршрути ─────────────────────────
const routes = [];
function route(method, pattern, handler) {
  const keys = [];
  const re = new RegExp('^' + pattern.replace(/:([a-z]+)/gi, (_, k) => { keys.push(k); return '([^/]+)'; }) + '/?$');
  routes.push({ method, re, keys, handler });
}
const requireUser = (ctx) => { if (!ctx.user) throw new HttpError(401, 'Спочатку увійди в акаунт'); return ctx.user; };

route('GET', '/api/health', () => ({ ok: true }));

// ── публічний стан
route('GET', '/api/state', (ctx) => {
  const v = ctx.user;
  const published = db.events.filter((e) => e.status === 'published').length;
  return {
    success: true,
    cards: db.cards.slice(0, 200).map((c) => viewCard(c, v)),
    letters: db.letters.slice(0, 100).map(viewLetter),
    memes: db.memes.slice(0, 200).map((m) => viewMeme(m, v)),
    stats: { people: db.users.length, stories: db.cards.length, letters: db.letters.length, memes: db.memes.length, events: published },
  };
});

route('GET', '/api/events', (ctx) => ({
  success: true,
  events: db.events.filter((e) => e.status === 'published').map((e) => viewEvent(e, ctx.user)),
}));

route('POST', '/api/events/:id/going', (ctx) => {
  const user = requireUser(ctx);
  limit('going:' + user.id, 60, 60 * 60 * 1000);
  const e = db.events.find((x) => x.id === ctx.params.id && x.status === 'published');
  if (!e) throw new HttpError(404, 'Захід не знайдено');
  const i = e.going.indexOf(user.id);
  if (i >= 0) e.going.splice(i, 1); else e.going.push(user.id);
  saveDb();
  return { success: true, event: viewEvent(e, user) };
});

// ── акаунти
route('POST', '/api/auth/register', async (ctx) => {
  limit('reg:' + ctx.ip, 8, 60 * 60 * 1000);
  const b = ctx.body;
  const name = text(b.name, { min: 2, max: 40, label: "Ім'я" });
  const username = text(b.username, { min: 3, max: 20, label: 'Нікнейм' }).toLowerCase();
  const email = text(b.email, { min: 1, max: 120, label: 'Email' }).toLowerCase();
  const password = typeof b.password === 'string' ? b.password : '';
  if (!/^[a-z0-9_]+$/.test(username)) throw bad('Нікнейм: лише латиниця, цифри та _');
  if (RESERVED_USERNAMES.has(username)) throw bad('Цей нікнейм зарезервований');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) throw bad('Введи коректний email');
  if (password.length < 8) throw bad('Пароль: мінімум 8 символів');
  if (password.length > 128) throw bad('Пароль занадто довгий');
  const taken = () => {
    if (db.users.some((u) => u.email === email)) throw bad('Користувач з таким email вже є');
    if (db.users.some((u) => u.username === username)) throw bad('Цей нікнейм вже зайнятий');
  };
  taken();
  const salt = crypto.randomBytes(16).toString('hex');
  const pw = await hashPassword(password, salt);
  taken(); // перевірка ще раз після асинхронного хешування
  const user = { id: newId(), name, username, email, algo: 'scrypt', salt, pw, bio: '', avatar: null, tv: 0, createdAt: nowIso() };
  db.users.push(user);
  saveDb();
  ctx.headers['Set-Cookie'] = sessionCookie(ctx.req, user);
  return { success: true, user: meUser(user) };
});

route('POST', '/api/auth/login', async (ctx) => {
  const ident = text(ctx.body.identifier ?? ctx.body.email, { min: 1, max: 120, label: 'Email' }).toLowerCase();
  const password = typeof ctx.body.password === 'string' ? ctx.body.password : '';
  limit('login-ip:' + ctx.ip, 30, 15 * 60 * 1000);
  limit('login-id:' + ident, 10, 15 * 60 * 1000);
  const user = db.users.find((u) => u.email === ident || u.username === ident);
  let ok = false;
  if (user) ok = await verifyPassword(user, password);
  else await hashPassword(password, 'dummy-salt-for-timing'); // вирівнюємо час відповіді
  if (!ok) throw new HttpError(401, 'Невірний email/нікнейм або пароль');
  ctx.headers['Set-Cookie'] = sessionCookie(ctx.req, user);
  return { success: true, user: meUser(user) };
});

route('POST', '/api/auth/logout', (ctx) => {
  ctx.headers['Set-Cookie'] = clearCookie(ctx.req);
  return { success: true };
});

route('GET', '/api/me', (ctx) => ({ success: true, user: ctx.user ? meUser(ctx.user) : null }));

route('PATCH', '/api/me', (ctx) => {
  const user = requireUser(ctx);
  const b = ctx.body;
  const name = b.name !== undefined ? text(b.name, { min: 2, max: 40, label: "Ім'я" }) : user.name;
  const bio = b.bio !== undefined ? text(b.bio, { max: 200, label: 'Про себе', multiline: true }) : user.bio;
  let avatar = user.avatar;
  let removeOld = null;
  if (b.avatar === null) { removeOld = user.avatar; avatar = null; }
  else if (typeof b.avatar === 'string' && b.avatar.startsWith('data:')) {
    avatar = storeImage(b.avatar, 600 * 1024);
    removeOld = user.avatar;
  }
  user.name = name; user.bio = bio; user.avatar = avatar;
  removeImage(removeOld);
  saveDb();
  return { success: true, user: meUser(user) };
});

route('POST', '/api/me/password', async (ctx) => {
  const user = requireUser(ctx);
  limit('pwchange:' + user.id, 8, 60 * 60 * 1000);
  const { current, next } = ctx.body;
  if (typeof next !== 'string' || next.length < 8) throw bad('Новий пароль: мінімум 8 символів');
  if (next.length > 128) throw bad('Пароль занадто довгий');
  if (!(await verifyPassword(user, typeof current === 'string' ? current : ''))) throw new HttpError(401, 'Поточний пароль невірний');
  user.salt = crypto.randomBytes(16).toString('hex');
  user.pw = await hashPassword(next, user.salt);
  user.algo = 'scrypt';
  user.tv = (user.tv || 0) + 1; // виходимо з усіх інших пристроїв
  saveDb();
  ctx.headers['Set-Cookie'] = sessionCookie(ctx.req, user);
  return { success: true };
});

route('DELETE', '/api/me', async (ctx) => {
  const user = requireUser(ctx);
  limit('delme:' + user.id, 5, 60 * 60 * 1000);
  if (!(await verifyPassword(user, typeof ctx.body.password === 'string' ? ctx.body.password : ''))) {
    throw new HttpError(401, 'Пароль невірний');
  }
  removeUserTraces(user);
  saveDb();
  ctx.headers['Set-Cookie'] = clearCookie(ctx.req);
  return { success: true };
});

route('GET', '/api/users/:username', (ctx) => {
  const u = db.users.find((x) => x.username === ctx.params.username.toLowerCase());
  if (!u) throw new HttpError(404, 'Користувача не знайдено');
  const cards = db.cards.filter((c) => c.userId === u.id);
  const memes = db.memes.filter((m) => m.userId === u.id);
  const likesReceived = [...cards, ...memes].reduce((s, x) => s + x.likes.length, 0);
  return {
    success: true,
    user: pubUser(u),
    stats: { stories: cards.length, memes: memes.length, likes: likesReceived, followers: followersOf(u.id).length, following: followingOf(u.id).length },
    isFollowing: !!ctx.user && isFollowing(ctx.user.id, u.id),
    isMe: !!ctx.user && ctx.user.id === u.id,
    cards: cards.map((c) => viewCard(c, ctx.user)),
    memes: memes.map((m) => viewMeme(m, ctx.user)),
  };
});

route('POST', '/api/users/:username/follow', (ctx) => {
  const me = requireUser(ctx);
  limit('follow:' + me.id, 120, 60 * 60 * 1000);
  const u = db.users.find((x) => x.username === ctx.params.username.toLowerCase());
  if (!u) throw new HttpError(404, 'Користувача не знайдено');
  if (u.id === me.id) throw bad('Не можна підписатися на себе');
  const i = db.follows.findIndex((f) => f.from === me.id && f.to === u.id);
  if (i >= 0) db.follows.splice(i, 1); else db.follows.push({ from: me.id, to: u.id, at: nowIso() });
  saveDb();
  return { success: true, following: i < 0, followers: followersOf(u.id).length };
});

for (const kind of ['followers', 'following']) {
  route('GET', `/api/users/:username/${kind}`, (ctx) => {
    const u = db.users.find((x) => x.username === ctx.params.username.toLowerCase());
    if (!u) throw new HttpError(404, 'Користувача не знайдено');
    const ids = kind === 'followers' ? followersOf(u.id).map((f) => f.from) : followingOf(u.id).map((f) => f.to);
    const users = ids.map(userById).filter(Boolean).slice(0, 200)
      .map((x) => ({ ...brief(x), bio: (x.bio || '').slice(0, 80), isFollowing: !!ctx.user && isFollowing(ctx.user.id, x.id), isMe: !!ctx.user && ctx.user.id === x.id }));
    return { success: true, users };
  });
}

// «Люди спільноти» — для знайомств і підписок
route('GET', '/api/people', (ctx) => {
  const v = ctx.user;
  const users = db.users.filter((u) => !v || u.id !== v.id).map((u) => ({
    u, followers: followersOf(u.id).length,
    posts: db.cards.filter((c) => c.userId === u.id).length + db.memes.filter((m) => m.userId === u.id).length,
  })).sort((a, b) => (b.followers - a.followers) || (b.posts - a.posts) || (a.u.createdAt < b.u.createdAt ? 1 : -1))
    .slice(0, 20)
    .map(({ u, followers, posts }) => ({ ...brief(u), bio: (u.bio || '').slice(0, 80), followers, posts, isFollowing: !!v && isFollowing(v.id, u.id) }));
  return { success: true, people: users };
});

// ── історії
route('POST', '/api/cards', (ctx) => {
  const user = requireUser(ctx);
  limit('post:' + user.id, 30, 60 * 60 * 1000);
  const story = text(ctx.body.story, { min: 3, max: 2000, label: 'Історія', multiline: true });
  const photo = ctx.body.photo ? storeImage(ctx.body.photo, 2.5 * 1024 * 1024) : null;
  const card = { id: newId(), userId: user.id, name: user.name, story, photo, date: uaDate(), createdAt: nowIso(), likes: [] };
  db.cards.unshift(card);
  saveDb();
  return { success: true, card: viewCard(card, user) };
});

// ── меми
route('POST', '/api/memes', (ctx) => {
  const user = requireUser(ctx);
  limit('post:' + user.id, 30, 60 * 60 * 1000);
  const title = text(ctx.body.title, { min: 2, max: 80, label: 'Назва' });
  const body = text(ctx.body.text, { min: 1, max: 500, label: 'Текст', multiline: true });
  const photo = ctx.body.photo ? storeImage(ctx.body.photo, 2.5 * 1024 * 1024) : null;
  const meme = { id: newId(), userId: user.id, title, text: body, photo, author_name: user.name, date: uaDate(), createdAt: nowIso(), likes: [] };
  db.memes.unshift(meme);
  saveDb();
  return { success: true, meme: viewMeme(meme, user) };
});

// ── лайки та видалення для історій і мемів
for (const kind of ['cards', 'memes']) {
  route('POST', `/api/${kind}/:id/like`, (ctx) => {
    const user = requireUser(ctx);
    limit('like:' + user.id, 200, 60 * 60 * 1000);
    const item = db[kind].find((x) => x.id === ctx.params.id);
    if (!item) throw new HttpError(404, 'Не знайдено');
    const i = item.likes.indexOf(user.id);
    if (i >= 0) item.likes.splice(i, 1); else item.likes.push(user.id);
    saveDb();
    return { success: true, likes: item.likes.length, liked: i < 0 };
  });
  route('DELETE', `/api/${kind}/:id`, (ctx) => {
    const item = db[kind].find((x) => x.id === ctx.params.id);
    if (!item) throw new HttpError(404, 'Не знайдено');
    const owner = ctx.user && item.userId === ctx.user.id;
    if (!owner && !adminGuard(ctx.req, { silent: true })) throw new HttpError(403, 'Видаляти можна лише власні публікації');
    removeImage(item.photo);
    db[kind] = db[kind].filter((x) => x.id !== item.id);
    saveDb();
    return { success: true };
  });
}

// ── листи (можна й без акаунта)
route('POST', '/api/letters', (ctx) => {
  limit('letter:' + ctx.ip, 15, 60 * 60 * 1000);
  const b = ctx.body;
  const message = text(b.message, { min: 3, max: 1500, label: 'Повідомлення', multiline: true });
  const recipient = text(b.recipient, { max: 60, label: 'Кому' }) || 'Невідомий адресат';
  const anonymous = !!b.anonymous || !ctx.user;
  let author = 'Анонім';
  let userId = null;
  if (ctx.user && !b.anonymous) { author = ctx.user.name; userId = ctx.user.id; }
  else if (!ctx.user && b.author) author = text(b.author, { max: 40, label: "Ім'я" }) || 'Анонім';
  const letter = { id: newId(), userId, author, recipient, message, date: uaDate(), createdAt: nowIso(), likes: [], anonymous };
  db.letters.unshift(letter);
  saveDb();
  return { success: true, letter: viewLetter(letter) };
});
route('DELETE', '/api/letters/:id', (ctx) => {
  adminGuard(ctx.req);
  db.letters = db.letters.filter((l) => l.id !== ctx.params.id);
  saveDb();
  return { success: true };
});

// ───────────────────────── Адмінка ─────────────────────────
function parseEvent(b) {
  const title = text(b.title, { min: 2, max: 120, label: 'Назва' });
  const body = text(b.text, { min: 1, max: 6000, label: 'Текст', multiline: true });
  const category = EVENT_CATEGORIES.includes(b.category) ? b.category : 'other';
  const date = typeof b.date === 'string' ? b.date.trim() : '';
  if (date && (!/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?$/.test(date) || Number.isNaN(Date.parse(date)))) throw bad('Дата: некоректний формат');
  const place = text(b.place, { max: 120, label: 'Місце' });
  const link = typeof b.link === 'string' ? b.link.trim() : '';
  if (link) {
    if (link.length > 300) throw bad('Посилання занадто довге');
    let ok = false;
    try { ok = /^https?:$/.test(new URL(link).protocol); } catch (e) { ok = false; }
    if (!ok) throw bad('Посилання має починатися з http:// або https://');
  }
  const status = b.status === 'draft' ? 'draft' : 'published';
  return { title, text: body, category, date, place, link, pinned: !!b.pinned, status };
}

route('GET', '/api/admin/ping', (ctx) => { adminGuard(ctx.req); return { success: true }; });

route('GET', '/api/admin/content', (ctx) => {
  adminGuard(ctx.req);
  const cnt = (list, uid) => list.filter((x) => x.userId === uid).length;
  return {
    success: true,
    users: db.users.map((u) => ({
      id: u.id, username: u.username, name: u.name, email: u.email, createdAt: u.createdAt, avatar: u.avatar || null,
      stories: cnt(db.cards, u.id), memes: cnt(db.memes, u.id), followers: followersOf(u.id).length,
    })),
    cards: db.cards.map((c) => viewCard(c, null)),
    letters: db.letters.map((l) => ({ ...viewLetter(l), anonymous: !!l.anonymous })),
    memes: db.memes.map((m) => viewMeme(m, null)),
    events: db.events.map((e) => viewEvent(e, null)),
  };
});

route('POST', '/api/admin/events', (ctx) => {
  adminGuard(ctx.req);
  const data = parseEvent(ctx.body);
  const cover = ctx.body.cover ? storeImage(ctx.body.cover, 3 * 1024 * 1024) : null;
  const ev = { id: newId(), ...data, cover, going: [], createdAt: nowIso(), updatedAt: nowIso() };
  db.events.unshift(ev);
  saveDb();
  return { success: true, event: viewEvent(ev, null) };
});

route('PUT', '/api/admin/events/:id', (ctx) => {
  adminGuard(ctx.req);
  const ev = db.events.find((e) => e.id === ctx.params.id);
  if (!ev) throw new HttpError(404, 'Захід не знайдено');
  const data = parseEvent(ctx.body);
  let cover = ev.cover;
  let drop = null;
  if (ctx.body.cover === null) { drop = ev.cover; cover = null; }
  else if (typeof ctx.body.cover === 'string' && ctx.body.cover.startsWith('data:')) {
    cover = storeImage(ctx.body.cover, 3 * 1024 * 1024);
    drop = ev.cover;
  }
  Object.assign(ev, data, { cover, updatedAt: nowIso() });
  removeImage(drop);
  saveDb();
  return { success: true, event: viewEvent(ev, null) };
});

route('DELETE', '/api/admin/events/:id', (ctx) => {
  adminGuard(ctx.req);
  const ev = db.events.find((e) => e.id === ctx.params.id);
  if (!ev) throw new HttpError(404, 'Захід не знайдено');
  removeImage(ev.cover);
  db.events = db.events.filter((e) => e.id !== ev.id);
  saveDb();
  return { success: true };
});

route('DELETE', '/api/admin/users/:id', (ctx) => {
  adminGuard(ctx.req);
  const u = userById(ctx.params.id);
  if (!u) throw new HttpError(404, 'Користувача не знайдено');
  removeUserTraces(u);
  saveDb();
  return { success: true };
});

// ───────────────────────── HTTP-шар ─────────────────────────
const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'SAMEORIGIN',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
};

function send(req, res, status, headers, body) {
  const buf = Buffer.isBuffer(body) ? body : Buffer.from(body);
  const h = { ...SECURITY_HEADERS, ...headers };
  const type = String(h['Content-Type'] || '');
  const compressible = /json|text|javascript|svg|xml/.test(type);
  if (compressible && buf.length > 1024 && /\bgzip\b/.test(String(req.headers['accept-encoding'] || ''))) {
    const z = zlib.gzipSync(buf);
    h['Content-Encoding'] = 'gzip';
    h.Vary = 'Accept-Encoding';
    h['Content-Length'] = z.length;
    res.writeHead(status, h);
    res.end(req.method === 'HEAD' ? undefined : z);
    return;
  }
  h['Content-Length'] = buf.length;
  res.writeHead(status, h);
  res.end(req.method === 'HEAD' ? undefined : buf);
}

function sendJson(req, res, status, payload, extra = {}) {
  send(req, res, status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...extra }, JSON.stringify(payload));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) { reject(new HttpError(413, 'Запит завеликий')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) return resolve({});
      try {
        const v = JSON.parse(raw);
        resolve(v && typeof v === 'object' && !Array.isArray(v) ? v : {});
      } catch (e) { reject(bad('Некоректний JSON')); }
    });
    req.on('error', reject);
  });
}

async function handleApi(req, res, url) {
  const method = req.method === 'HEAD' ? 'GET' : req.method;
  if (method !== 'GET') {
    const origin = req.headers.origin;
    if (origin) {
      let same = false;
      try { same = new URL(origin).host === req.headers.host; } catch (e) { same = false; }
      if (!same) throw new HttpError(403, 'Заборонено');
    }
  }
  for (const r of routes) {
    if (r.method !== method) continue;
    const m = r.re.exec(url.pathname);
    if (!m) continue;
    const params = {};
    r.keys.forEach((k, i) => { try { params[k] = decodeURIComponent(m[i + 1]); } catch (e) { params[k] = m[i + 1]; } });
    const ctx = {
      req, res, url, params, headers: {}, ip: clientIp(req), user: sessionUser(req),
      body: method === 'GET' ? {} : await readBody(req),
    };
    const result = await r.handler(ctx);
    sendJson(req, res, 200, result, ctx.headers);
    return;
  }
  throw new HttpError(404, 'Not found');
}

// ── статичні файли
const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.ico': 'image/x-icon', '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8', '.webmanifest': 'application/manifest+json',
};
const PRIVATE_FILES = new Set(['server.js', 'package.json', 'package-lock.json', 'render.yaml', 'readme.md', 'data.json']);

function serveFile(req, res, filePath, cache) {
  let st;
  try { st = fs.statSync(filePath); } catch (e) { return false; }
  if (!st.isFile()) return false;
  const type = MIME[path.extname(filePath).toLowerCase()];
  if (!type) return false;
  const etag = `W/"${st.size}-${Math.floor(st.mtimeMs)}"`;
  if (req.headers['if-none-match'] === etag) {
    res.writeHead(304, { ...SECURITY_HEADERS, ETag: etag, 'Cache-Control': cache });
    res.end();
    return true;
  }
  send(req, res, 200, { 'Content-Type': type, ETag: etag, 'Cache-Control': cache }, fs.readFileSync(filePath));
  return true;
}

function notFound(req, res) {
  send(req, res, 404, { 'Content-Type': 'text/plain; charset=utf-8' }, 'Not found');
}

function serveStatic(req, res, pathname) {
  let rel;
  try { rel = decodeURIComponent(pathname); } catch (e) { rel = null; }
  if (rel === null || rel.includes('\0')) return notFound(req, res);
  if (rel === '/') rel = '/index.html';
  if (rel === '/admin' || rel === '/admin/') rel = '/admin.html';

  if (rel.startsWith('/uploads/')) {
    const name = path.basename(rel);
    if (/^[a-f0-9]+\.(jpg|png|webp|gif)$/.test(name) &&
        serveFile(req, res, path.join(UPLOAD_DIR, name), 'public, max-age=31536000, immutable')) return undefined;
    return notFound(req, res);
  }

  const parts = rel.split('/').filter(Boolean);
  if (!parts.length || parts.some((p) => p === '..' || p.startsWith('.') || p === 'node_modules')) return notFound(req, res);
  if (PRIVATE_FILES.has(parts[parts.length - 1].toLowerCase()) || parts[0] === 'data') return notFound(req, res);
  const abs = path.join(ROOT, ...parts);
  if (path.relative(ROOT, abs).startsWith('..')) return notFound(req, res);
  if (!serveFile(req, res, abs, 'no-cache')) return notFound(req, res);
  return undefined;
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    if (url.pathname.startsWith('/api/')) {
      await handleApi(req, res, url);
      return;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      send(req, res, 405, { 'Content-Type': 'text/plain; charset=utf-8' }, 'Method not allowed');
      return;
    }
    serveStatic(req, res, url.pathname);
  } catch (err) {
    if (res.headersSent) { try { res.end(); } catch (e) { /* ignore */ } return; }
    if (err instanceof HttpError) {
      sendJson(req, res, err.status, { success: false, error: err.message });
    } else {
      console.error('Помилка сервера:', err);
      sendJson(req, res, 500, { success: false, error: 'Внутрішня помилка сервера' });
    }
  }
});

loadDb();
server.listen(PORT, HOST, () => {
  console.log(`Залізна Зміна запущена: http://${HOST}:${PORT}`);
  if (!ADMIN_ENABLED) console.warn('⚠️  ADMIN_PASSWORD не задано — адмінка /admin вимкнена. Додай змінну середовища ADMIN_PASSWORD.');
  else if (ADMIN_KEY.length < 10) console.warn('⚠️  ADMIN_PASSWORD короткий — краще 12+ символів.');
});

function shutdown() { try { saveDb(); } catch (e) { /* ignore */ } process.exit(0); }
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
