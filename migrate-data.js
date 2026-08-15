// Одноразовий скрипт: переносить дані зі старого data.json у Postgres.
// Запускати ЛИШЕ ОДИН РАЗ, після того як DATABASE_URL вже підключено і
// сервер хоча б раз запускався (щоб таблиці існували).
//
// Запуск: npm run migrate-data
// (потребує DATABASE_URL у змінних середовища — на Render Shell це вже є)

const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const dataFile = path.join(__dirname, 'data.json');
const DATABASE_URL = process.env.DATABASE_URL || '';

if (!DATABASE_URL) {
  console.error('❌ DATABASE_URL не задано. Встановіть змінну середовища й спробуйте ще раз.');
  process.exit(1);
}

if (!fs.existsSync(dataFile)) {
  console.log('ℹ️  Файл data.json не знайдено — переносити нічого.');
  process.exit(0);
}

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function main() {
  const raw = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
  const users = Array.isArray(raw.users) ? raw.users : [];
  const cards = Array.isArray(raw.cards) ? raw.cards : [];
  const letters = Array.isArray(raw.letters) ? raw.letters : [];
  const memes = Array.isArray(raw.memes) ? raw.memes : [];

  let migrated = 0;

  for (const u of users) {
    try {
      await pool.query(
        'INSERT INTO users (id, name, email, password_hash, created_at) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (id) DO NOTHING',
        [u.id, u.name, u.email, u.password_hash, u.createdAt || new Date().toLocaleDateString('uk-UA')]
      );
      migrated++;
    } catch (error) {
      console.warn(`⚠️  Пропущено користувача ${u.email}: ${error.message}`);
    }
  }

  for (const c of cards) {
    try {
      await pool.query(
        'INSERT INTO cards (id, name, story, photo, date) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (id) DO NOTHING',
        [c.id, c.name, c.story, c.photo || null, c.date]
      );
      migrated++;
    } catch (error) {
      console.warn(`⚠️  Пропущено картку ${c.id}: ${error.message}`);
    }
  }

  for (const l of letters) {
    try {
      await pool.query(
        'INSERT INTO letters (id, author, recipient, message, date) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (id) DO NOTHING',
        [l.id, l.author, l.recipient, l.message, l.date]
      );
      migrated++;
    } catch (error) {
      console.warn(`⚠️  Пропущено лист ${l.id}: ${error.message}`);
    }
  }

  for (const m of memes) {
    try {
      await pool.query(
        'INSERT INTO memes (id, title, text, photo, author_name, date) VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (id) DO NOTHING',
        [m.id, m.title, m.text, m.photo || null, m.author_name || 'Анонім', m.date]
      );
      migrated++;
    } catch (error) {
      console.warn(`⚠️  Пропущено мем ${m.id}: ${error.message}`);
    }
  }

  console.log(`✅ Перенесено записів: ${migrated}`);
  await pool.end();
}

main().catch(error => {
  console.error('❌ Помилка міграції:', error.message);
  process.exit(1);
});
