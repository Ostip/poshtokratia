const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const rootDir = __dirname;
const dataFile = path.join(rootDir, 'data.json');
const port = process.env.PORT || 3000;
const host = '0.0.0.0';

// Пароль для перегляду адмінки. Задайте свій через змінну середовища
// ADMIN_PASSWORD на Render (Settings → Environment). Якщо не задано,
// використовується значення за замовчуванням — ОБОВ'ЯЗКОВО змініть його в проді.
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'change-me-please';

// ── STATE ──
// users   — ПРИВАТНО: бачить лише власник сайту через /admin
// cards / letters / memes — ПУБЛІЧНО: бачать усі відвідувачі сайту
function readState() {
  if (!fs.existsSync(dataFile)) {
    const initialState = { users: [], cards: [], letters: [], memes: [] };
    fs.writeFileSync(dataFile, JSON.stringify(initialState, null, 2));
    return initialState;
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
    return {
      users: Array.isArray(parsed.users) ? parsed.users : [],
      cards: Array.isArray(parsed.cards) ? parsed.cards : [],
      letters: Array.isArray(parsed.letters) ? parsed.letters : [],
      memes: Array.isArray(parsed.memes) ? parsed.memes : []
    };
  } catch (error) {
    return { users: [], cards: [], letters: [], memes: [] };
  }
}

function writeState(state) {
  fs.writeFileSync(dataFile, JSON.stringify(state, null, 2));
}

function hashPassword(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function timingSafeEqual(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Admin-Password',
    'Content-Length': Buffer.byteLength(body)
  });
  res.end(body);
}

// Публічна версія стану — БЕЗ users, щоб фронтенд і /api/state ніколи
// не віддавали список зареєстрованих людей чи паролі стороннім.
function publicState(state) {
  return { cards: state.cards, letters: state.letters, memes: state.memes };
}

function readBody(req) {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try { resolve(JSON.parse(body || '{}')); }
      catch (error) { resolve({}); }
    });
  });
}

function serveStatic(res, requestedPath) {
  const safePath = requestedPath === '/' ? '/index.html' : requestedPath;
  const filePath = path.join(rootDir, safePath.replace(/^\//, ''));
  const resolved = path.resolve(filePath);

  // не дозволяємо вихід за межі кореня і не роздаємо data.json напряму
  if (!resolved.startsWith(rootDir) || path.basename(resolved) === 'data.json') {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Forbidden');
    return;
  }

  const ext = path.extname(resolved).toLowerCase();
  const mimeTypes = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon'
  };

  if (!fs.existsSync(resolved) || fs.statSync(resolved).isDirectory()) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not found');
    return;
  }

  const contentType = mimeTypes[ext] || 'application/octet-stream';
  res.writeHead(200, { 'Content-Type': contentType });
  fs.createReadStream(resolved).pipe(res);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = url.pathname;

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, X-Admin-Password'
    });
    res.end();
    return;
  }

  // ── HEALTH ──
  if (pathname === '/api/health' && req.method === 'GET') {
    sendJson(res, 200, { ok: true });
    return;
  }

  // ── PUBLIC STATE (без users) ──
  if (pathname === '/api/state' && req.method === 'GET') {
    sendJson(res, 200, publicState(readState()));
    return;
  }

  // ── ADMIN: перегляд зареєстрованих людей (захищено паролем) ──
  if (pathname === '/api/admin/users' && req.method === 'GET') {
    const providedPassword = req.headers['x-admin-password'] || url.searchParams.get('password') || '';
    if (!providedPassword || !timingSafeEqual(providedPassword, ADMIN_PASSWORD)) {
      sendJson(res, 401, { success: false, error: 'Невірний пароль адміністратора' });
      return;
    }
    const state = readState();
    const users = state.users.map(u => ({
      id: u.id,
      name: u.name,
      email: u.email,
      createdAt: u.createdAt || null
    }));
    sendJson(res, 200, { success: true, users, count: users.length });
    return;
  }

  // ── ADMIN PAGE (HTML, запитує пароль на клієнті) ──
  if (pathname === '/admin' || pathname === '/admin.html') {
    serveStatic(res, '/admin.html');
    return;
  }

  // ── AUTH: REGISTER ──
  if (pathname === '/api/auth/register' && req.method === 'POST') {
    const payload = await readBody(req);
    const state = readState();
    if (!payload.name || !payload.email || !payload.password) {
      sendJson(res, 400, { success: false, error: 'Заповни всі поля' });
      return;
    }
    const email = String(payload.email).trim().toLowerCase();
    if (state.users.some(user => user.email === email)) {
      sendJson(res, 400, { success: false, error: 'Користувач з таким email вже є' });
      return;
    }
    const user = {
      id: Date.now(),
      name: String(payload.name).trim(),
      email,
      password_hash: hashPassword(payload.password),
      createdAt: new Date().toLocaleDateString('uk-UA')
    };
    state.users.push(user);
    writeState(state);
    // Фронтенду повертаємо лише публічно-безпечні поля користувача, без хешу пароля
    sendJson(res, 200, {
      success: true,
      user: { id: user.id, name: user.name, email: user.email },
      state: publicState(state)
    });
    return;
  }

  // ── AUTH: LOGIN ──
  if (pathname === '/api/auth/login' && req.method === 'POST') {
    const payload = await readBody(req);
    const state = readState();
    const email = String(payload.email || '').trim().toLowerCase();
    const user = state.users.find(entry => entry.email === email && entry.password_hash === hashPassword(payload.password || ''));
    if (!user) {
      sendJson(res, 401, { success: false, error: 'Невірний email або пароль' });
      return;
    }
    sendJson(res, 200, {
      success: true,
      user: { id: user.id, name: user.name, email: user.email },
      state: publicState(state)
    });
    return;
  }

  // ── PUBLIC: CARDS (історії) ──
  if (pathname === '/api/cards' && req.method === 'POST') {
    const payload = await readBody(req);
    const state = readState();
    state.cards.unshift({
      id: Date.now(),
      name: payload.name,
      story: payload.story,
      photo: payload.photo || null,
      date: payload.date || new Date().toLocaleDateString('uk-UA')
    });
    writeState(state);
    sendJson(res, 200, { success: true, state: publicState(state) });
    return;
  }

  if (pathname.startsWith('/api/cards/') && req.method === 'DELETE') {
    const id = Number(pathname.split('/').pop());
    const state = readState();
    state.cards = state.cards.filter(card => card.id !== id);
    writeState(state);
    sendJson(res, 200, { success: true, state: publicState(state) });
    return;
  }

  // ── PUBLIC: LETTERS (пошта) ──
  if (pathname === '/api/letters' && req.method === 'POST') {
    const payload = await readBody(req);
    const state = readState();
    state.letters.unshift({
      id: Date.now(),
      author: payload.author || 'Анонім',
      recipient: payload.recipient || 'Невідомий адресат',
      message: payload.message,
      date: payload.date || new Date().toLocaleDateString('uk-UA')
    });
    writeState(state);
    sendJson(res, 200, { success: true, state: publicState(state) });
    return;
  }

  // ── PUBLIC: MEMES ──
  if (pathname === '/api/memes' && req.method === 'POST') {
    const payload = await readBody(req);
    const state = readState();
    state.memes.unshift({
      id: Date.now(),
      title: payload.title,
      text: payload.text,
      photo: payload.photo || null,
      author_name: payload.author_name || 'Анонім',
      date: payload.date || new Date().toLocaleDateString('uk-UA')
    });
    writeState(state);
    sendJson(res, 200, { success: true, state: publicState(state) });
    return;
  }

  if (pathname.startsWith('/api/')) {
    sendJson(res, 404, { success: false, error: 'Not found' });
    return;
  }

  serveStatic(res, pathname);
});

server.listen(port, host, () => {
  console.log(`Server is running on http://${host}:${port}`);
  if (ADMIN_PASSWORD === 'change-me-please') {
    console.warn('⚠️  ADMIN_PASSWORD не встановлено — використовується значення за замовчуванням. Встановіть свій пароль через змінну середовища ADMIN_PASSWORD.');
  }
});
