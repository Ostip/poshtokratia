const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Pool } = require('pg');

const rootDir = __dirname;
const dataFile = path.join(rootDir, 'data.json');
const port = process.env.PORT || 3000;
const host = '0.0.0.0';

// Пароль для перегляду адмінки. Задайте свій через змінну середовища
// ADMIN_PASSWORD на Render (Settings → Environment).
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'change-me-please';

// ── DATABASE ──
// Якщо задана DATABASE_URL (Render Postgres) — усі дані живуть у базі й
// переживають рестарти/релізи сервісу. Якщо змінної немає (наприклад, при
// локальній розробці без бази) — сервер працює по-старому, зберігаючи все
// у файлі data.json, щоб не заважати локальному тестуванню.
const DATABASE_URL = process.env.DATABASE_URL || '';
const useDatabase = Boolean(DATABASE_URL);

const pool = useDatabase
  ? new Pool({
      connectionString: DATABASE_URL,
      // Render Postgres вимагає SSL для зовнішніх з'єднань; для внутрішніх
      // (той самий регіон/акаунт) це теж працює без проблем.
      ssl: { rejectUnauthorized: false }
    })
  : null;

async function ensureSchema() {
  if (!useDatabase) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id BIGINT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS cards (
      id BIGINT PRIMARY KEY,
      name TEXT NOT NULL,
      story TEXT NOT NULL,
      photo TEXT,
      date TEXT NOT NULL
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS letters (
      id BIGINT PRIMARY KEY,
      author TEXT NOT NULL,
      recipient TEXT NOT NULL,
      message TEXT NOT NULL,
      date TEXT NOT NULL
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS memes (
      id BIGINT PRIMARY KEY,
      title TEXT NOT NULL,
      text TEXT NOT NULL,
      photo TEXT,
      author_name TEXT,
      date TEXT NOT NULL
    );
  `);
}

// ── FILE FALLBACK (лише коли DATABASE_URL не задано, напр. локально) ──
function readFileState() {
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

function writeFileState(state) {
  fs.writeFileSync(dataFile, JSON.stringify(state, null, 2));
}

// ── DATA ACCESS (Postgres, з файловим фолбеком) ──
async function getPublicState() {
  if (useDatabase) {
    const [cardsRes, lettersRes, memesRes] = await Promise.all([
      pool.query('SELECT id, name, story, photo, date FROM cards ORDER BY id DESC'),
      pool.query('SELECT id, author, recipient, message, date FROM letters ORDER BY id DESC'),
      pool.query('SELECT id, title, text, photo, author_name, date FROM memes ORDER BY id DESC')
    ]);
    return { cards: cardsRes.rows, letters: lettersRes.rows, memes: memesRes.rows };
  }
  const state = readFileState();
  return { cards: state.cards, letters: state.letters, memes: state.memes };
}

async function getAdminUsers() {
  if (useDatabase) {
    const res = await pool.query('SELECT id, name, email, created_at FROM users ORDER BY created_at DESC, id DESC');
    return res.rows.map(u => ({ id: u.id, name: u.name, email: u.email, createdAt: u.created_at }));
  }
  const state = readFileState();
  return state.users.map(u => ({ id: u.id, name: u.name, email: u.email, createdAt: u.createdAt || null }));
}

async function findUserByEmail(email) {
  if (useDatabase) {
    const res = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    return res.rows[0] || null;
  }
  const state = readFileState();
  return state.users.find(u => u.email === email) || null;
}

async function insertUser(user) {
  if (useDatabase) {
    await pool.query(
      'INSERT INTO users (id, name, email, password_hash, created_at) VALUES ($1, $2, $3, $4, $5)',
      [user.id, user.name, user.email, user.password_hash, user.createdAt]
    );
    return;
  }
  const state = readFileState();
  state.users.push(user);
  writeFileState(state);
}

async function insertCard(card) {
  if (useDatabase) {
    await pool.query(
      'INSERT INTO cards (id, name, story, photo, date) VALUES ($1, $2, $3, $4, $5)',
      [card.id, card.name, card.story, card.photo, card.date]
    );
    return;
  }
  const state = readFileState();
  state.cards.unshift(card);
  writeFileState(state);
}

async function deleteCardById(id) {
  if (useDatabase) {
    await pool.query('DELETE FROM cards WHERE id = $1', [id]);
    return;
  }
  const state = readFileState();
  state.cards = state.cards.filter(c => c.id !== id);
  writeFileState(state);
}

async function deleteLetterById(id) {
  if (useDatabase) {
    await pool.query('DELETE FROM letters WHERE id = $1', [id]);
    return;
  }
  const state = readFileState();
  state.letters = state.letters.filter(l => l.id !== id);
  writeFileState(state);
}

async function deleteMemeById(id) {
  if (useDatabase) {
    await pool.query('DELETE FROM memes WHERE id = $1', [id]);
    return;
  }
  const state = readFileState();
  state.memes = state.memes.filter(m => m.id !== id);
  writeFileState(state);
}

async function insertLetter(letter) {
  if (useDatabase) {
    await pool.query(
      'INSERT INTO letters (id, author, recipient, message, date) VALUES ($1, $2, $3, $4, $5)',
      [letter.id, letter.author, letter.recipient, letter.message, letter.date]
    );
    return;
  }
  const state = readFileState();
  state.letters.unshift(letter);
  writeFileState(state);
}

async function insertMeme(meme) {
  if (useDatabase) {
    await pool.query(
      'INSERT INTO memes (id, title, text, photo, author_name, date) VALUES ($1, $2, $3, $4, $5, $6)',
      [meme.id, meme.title, meme.text, meme.photo, meme.author_name, meme.date]
    );
    return;
  }
  const state = readFileState();
  state.memes.unshift(meme);
  writeFileState(state);
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

  try {
    // ── HEALTH ──
    if (pathname === '/api/health' && req.method === 'GET') {
      sendJson(res, 200, { ok: true, storage: useDatabase ? 'postgres' : 'local-file' });
      return;
    }

    // ── PUBLIC STATE (без users) ──
    if (pathname === '/api/state' && req.method === 'GET') {
      sendJson(res, 200, await getPublicState());
      return;
    }

    // ── ADMIN: перегляд зареєстрованих людей (захищено паролем) ──
    if (pathname === '/api/admin/users' && req.method === 'GET') {
      const providedPassword = req.headers['x-admin-password'] || url.searchParams.get('password') || '';
      if (!providedPassword || !timingSafeEqual(providedPassword, ADMIN_PASSWORD)) {
        sendJson(res, 401, { success: false, error: 'Невірний пароль адміністратора' });
        return;
      }
      const users = await getAdminUsers();
      sendJson(res, 200, { success: true, users, count: users.length });
      return;
    }

    // ── ADMIN PAGE ──
    if (pathname === '/admin' || pathname === '/admin.html') {
      serveStatic(res, '/admin.html');
      return;
    }

    // ── AUTH: REGISTER ──
    if (pathname === '/api/auth/register' && req.method === 'POST') {
      const payload = await readBody(req);
      if (!payload.name || !payload.email || !payload.password) {
        sendJson(res, 400, { success: false, error: 'Заповни всі поля' });
        return;
      }
      const email = String(payload.email).trim().toLowerCase();
      const existing = await findUserByEmail(email);
      if (existing) {
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
      await insertUser(user);
      sendJson(res, 200, {
        success: true,
        user: { id: user.id, name: user.name, email: user.email },
        state: await getPublicState()
      });
      return;
    }

    // ── AUTH: LOGIN ──
    if (pathname === '/api/auth/login' && req.method === 'POST') {
      const payload = await readBody(req);
      const email = String(payload.email || '').trim().toLowerCase();
      const user = await findUserByEmail(email);
      const passwordOk = user && user.password_hash === hashPassword(payload.password || '');
      if (!passwordOk) {
        sendJson(res, 401, { success: false, error: 'Невірний email або пароль' });
        return;
      }
      sendJson(res, 200, {
        success: true,
        user: { id: user.id, name: user.name, email: user.email },
        state: await getPublicState()
      });
      return;
    }

    // ── PUBLIC: CARDS ──
    if (pathname === '/api/cards' && req.method === 'POST') {
      const payload = await readBody(req);
      const card = {
        id: Date.now(),
        name: payload.name,
        story: payload.story,
        photo: payload.photo || null,
        date: payload.date || new Date().toLocaleDateString('uk-UA')
      };
      await insertCard(card);
      sendJson(res, 200, { success: true, state: await getPublicState() });
      return;
    }

    if (pathname.startsWith('/api/cards/') && req.method === 'DELETE') {
      const id = Number(pathname.split('/').pop());
      await deleteCardById(id);
      sendJson(res, 200, { success: true, state: await getPublicState() });
      return;
    }

    if (pathname.startsWith('/api/letters/') && req.method === 'DELETE') {
      const id = Number(pathname.split('/').pop());
      await deleteLetterById(id);
      sendJson(res, 200, { success: true, state: await getPublicState() });
      return;
    }

    if (pathname.startsWith('/api/memes/') && req.method === 'DELETE') {
      const id = Number(pathname.split('/').pop());
      await deleteMemeById(id);
      sendJson(res, 200, { success: true, state: await getPublicState() });
      return;
    }

    // ── PUBLIC: LETTERS ──
    if (pathname === '/api/letters' && req.method === 'POST') {
      const payload = await readBody(req);
      const letter = {
        id: Date.now(),
        author: payload.author || 'Анонім',
        recipient: payload.recipient || 'Невідомий адресат',
        message: payload.message,
        date: payload.date || new Date().toLocaleDateString('uk-UA')
      };
      await insertLetter(letter);
      sendJson(res, 200, { success: true, state: await getPublicState() });
      return;
    }

    // ── PUBLIC: MEMES ──
    if (pathname === '/api/memes' && req.method === 'POST') {
      const payload = await readBody(req);
      const meme = {
        id: Date.now(),
        title: payload.title,
        text: payload.text,
        photo: payload.photo || null,
        author_name: payload.author_name || 'Анонім',
        date: payload.date || new Date().toLocaleDateString('uk-UA')
      };
      await insertMeme(meme);
      sendJson(res, 200, { success: true, state: await getPublicState() });
      return;
    }

    if (pathname.startsWith('/api/')) {
      sendJson(res, 404, { success: false, error: 'Not found' });
      return;
    }

    serveStatic(res, pathname);
  } catch (error) {
    console.error('Request error:', error);
    sendJson(res, 500, { success: false, error: 'Внутрішня помилка сервера' });
  }
});

async function start() {
  if (useDatabase) {
    try {
      await ensureSchema();
      console.log('✅ Підключено до Postgres, таблиці готові.');
    } catch (error) {
      console.error('❌ Не вдалося підключитись до Postgres:', error.message);
      console.error('Перевірте змінну DATABASE_URL. Сервер продовжить спробу роботи, але запити до бази будуть падати.');
    }
  } else {
    console.warn('⚠️  DATABASE_URL не задано — використовується локальний файл data.json (дані можуть губитись при рестарті). Додайте DATABASE_URL, щоб підключити Postgres.');
  }

  server.listen(port, host, () => {
    console.log(`Server is running on http://${host}:${port}`);
    if (ADMIN_PASSWORD === 'change-me-please') {
      console.warn('⚠️  ADMIN_PASSWORD не встановлено — використовується значення за замовчуванням. Встановіть свій пароль через змінну середовища ADMIN_PASSWORD.');
    }
  });
}

start();
