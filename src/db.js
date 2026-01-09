// src/db.js
// SQLite data layer (better-sqlite3) with user authentication support

const Database = require('better-sqlite3');
const path = require('path');
const bcrypt = require('bcrypt');

const DB_FILE = process.env.DB_FILE || path.join(__dirname, 'app.db');
const SALT_ROUNDS = parseInt(process.env.BCRYPT_SALT_ROUNDS, 10) || 12;

let db;

async function initDb() {
  if (db) return db;

  db = new Database(DB_FILE);
  db.pragma('journal_mode = WAL');

  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      email TEXT UNIQUE,
      fullName TEXT,
      passwordHash TEXT NOT NULL,
      createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
      lastLoginAt DATETIME
    );
  `);

  return db;
}

// Helpers
async function hashPassword(plain) {
  const salt = await bcrypt.genSalt(SALT_ROUNDS);
  return bcrypt.hash(plain, salt);
}

async function comparePassword(plain, hash) {
  return bcrypt.compare(plain, hash);
}

// User CRUD and auth operations

async function createUser(username, password, options = {}) {
  if (!username || !password) throw new Error('Username and password are required');

  const { email, fullName } = options;
  const passwordHash = await hashPassword(password);

  await initDb();

  try {
    const stmt = db.prepare(`
      INSERT INTO users (username, email, fullName, passwordHash)
      VALUES (?, ?, ?, ?)
    `);

    const info = stmt.run(username, email || null, fullName || null, passwordHash);

    const row = db.prepare(`
      SELECT id, username, email, fullName, createdAt, lastLoginAt
      FROM users
      WHERE id = ?
    `).get(info.lastInsertRowid);

    return row;
  } catch (err) {
    if (err && (err.code === 'SQLITE_CONSTRAINT_UNIQUE' || String(err.message || '').includes('UNIQUE'))) {
      throw new Error('User with this username or email already exists');
    }
    throw err;
  }
}

async function authenticateUser(username, password) {
  if (!username || !password) throw new Error('Username and password are required');

  await initDb();

  const row = db.prepare(`
    SELECT id, username, email, fullName, passwordHash, createdAt, lastLoginAt
    FROM users
    WHERE username = ?
  `).get(username);

  if (!row) return null;

  const match = await comparePassword(password, row.passwordHash);
  if (!match) return null;

  db.prepare(`UPDATE users SET lastLoginAt = CURRENT_TIMESTAMP WHERE id = ?`).run(row.id);

  return {
    id: row.id,
    username: row.username,
    email: row.email,
    fullName: row.fullName,
    createdAt: row.createdAt,
    lastLoginAt: new Date().toISOString(),
  };
}

async function getUserById(id) {
  await initDb();
  const row = db.prepare(`
    SELECT id, username, email, fullName, createdAt, lastLoginAt
    FROM users
    WHERE id = ?
  `).get(id);

  return row || null;
}

async function getUserByUsername(username) {
  await initDb();
  const row = db.prepare(`
    SELECT id, username, email, fullName, createdAt, lastLoginAt
    FROM users
    WHERE username = ?
  `).get(username);

  return row || null;
}

async function updateUser(id, updates = {}) {
  if (!id) throw new Error('User id is required');

  await initDb();

  const fields = [];
  const values = [];

  if (updates.username) {
    fields.push('username = ?');
    values.push(updates.username);
  }
  if (updates.email) {
    fields.push('email = ?');
    values.push(updates.email);
  }
  if (updates.fullName) {
    fields.push('fullName = ?');
    values.push(updates.fullName);
  }
  if (updates.password) {
    const passwordHash = await hashPassword(updates.password);
    fields.push('passwordHash = ?');
    values.push(passwordHash);
  }

  if (fields.length === 0) return false;

  values.push(id);

  try {
    const info = db.prepare(`UPDATE users SET ${fields.join(', ')} WHERE id = ?`).run(...values);
    return info.changes > 0;
  } catch (err) {
    if (err && (err.code === 'SQLITE_CONSTRAINT_UNIQUE' || String(err.message || '').includes('UNIQUE'))) {
      throw new Error('Update would violate unique constraints (username/email)');
    }
    throw err;
  }
}

async function deleteUser(id) {
  await initDb();
  const info = db.prepare(`DELETE FROM users WHERE id = ?`).run(id);
  return info.changes > 0;
}

async function closeDb() {
  if (!db) return;
  db.close();
  db = null;
}

module.exports = {
  initDb,
  createUser,
  authenticateUser,
  getUserById,
  getUserByUsername,
  updateUser,
  deleteUser,
  closeDb,
  hashPassword,
  comparePassword,
};
