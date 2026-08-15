-- Довідкова схема бази даних для Залізної Зміни.
-- Сервер (server.js) сам створює ці таблиці автоматично при запуску
-- (CREATE TABLE IF NOT EXISTS), тому вручну виконувати цей файл НЕ
-- обов'язково. Він тут лише для довідки / якщо захочете створити
-- таблиці заздалегідь через Render Postgres → Shell / psql.

CREATE TABLE IF NOT EXISTS users (
  id BIGINT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS cards (
  id BIGINT PRIMARY KEY,
  name TEXT NOT NULL,
  story TEXT NOT NULL,
  photo TEXT,
  date TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS letters (
  id BIGINT PRIMARY KEY,
  author TEXT NOT NULL,
  recipient TEXT NOT NULL,
  message TEXT NOT NULL,
  date TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS memes (
  id BIGINT PRIMARY KEY,
  title TEXT NOT NULL,
  text TEXT NOT NULL,
  photo TEXT,
  author_name TEXT,
  date TEXT NOT NULL
);
