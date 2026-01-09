// src/db.js
// SQLite-based data layer with user authentication support

// Import dependencies
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const crypto = require('crypto');
const bcrypt = require('bcrypt');

// Configuration
const DB_FILE = process.env.DB_FILE || path.join(__dirname, 'app.db');
const SALT_ROUNDS = parseInt(process.env.BCRYPT_SALT_ROUNDS, 10) || 12;

// Database handle
let db;

// Initialize the database and ensure schema exists
async function initDb() {
  if (db) return db;

  return new Promise((resolve, reject) => {
    db = new sqlite3.Database(DB_FILE, (err) => {
      if (err) {
        reject(err);
        return;
      }

      // Path: ensure a users table exists
      const createUsersTable = `
        CREATE TABLE IF NOT EXISTS users (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          username TEXT UNIQUE NOT NULL,
          email TEXT UNIQUE,
          fullName TEXT,
          passwordHash TEXT NOT NULL,
          createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
          lastLoginAt DATETIME
        );
      `;

      db.run(createUsersTable, (err) => {
        if (err) {
          reject(err);
          return;
        }
        resolve(db);
      });
    });
  });
}

// Helpers
async function hashPassword(plain) {
  const salt = await bcrypt.genSalt(SALT_ROUNDS);
  const hash = await bcrypt.hash(plain, salt);
  return hash;
}

async function comparePassword(plain, hash) {
  return bcrypt.compare(plain, hash);
}

// User CRUD and auth operations

async function createUser(username, password, options = {}) {
  if (!username || !password) {
    throw new Error('Username and password are required');
  }

  const passwordHash = await hashPassword(password);

  const { email, fullName } = options;

  await initDb();

  return new Promise((resolve, reject) => {
    const stmt = `
      INSERT INTO users (username, email, fullName, passwordHash)
      VALUES (?, ?, ?, ?)
    `;
    db.run(stmt, [username, email || null, fullName || null, passwordHash], function (err) {
      if (err) {
        // Return a more friendly error if unique constraint violated
        if (err.code === 'SQLITE_CONSTRAINT' || err.message.includes('UNIQUE')) {
          reject(new Error('User with this username or email already exists'));
        } else {
          reject(err);
        }
        return;
      }

      // Return created user (without passwordHash)
      const createdUser = {
        id: this.lastID,
        username,
        email: email || null,
        fullName: fullName || null,
        createdAt: new Date().toISOString(),
      };
      resolve(createdUser);
    });
  });
}

async function authenticateUser(username, password) {
  if (!username || !password) {
    throw new Error('Username and password are required');
  }

  await initDb();

  return new Promise((resolve, reject) => {
    const query = `
      SELECT id, username, email, fullName, passwordHash, createdAt, lastLoginAt
      FROM users
      WHERE username = ?
    `;
    db.get(query, [username], async (err, row) => {
      if (err) {
        reject(err);
        return;
      }

      if (!row) {
        // User not found
        resolve(null);
        return;
      }

      const match = await comparePassword(password, row.passwordHash);
      if (!match) {
        resolve(null);
        return;
      }

      // Update lastLoginAt
      const update = `UPDATE users SET lastLoginAt = CURRENT_TIMESTAMP WHERE id = ?`;
      db.run(update, [row.id], () => {
        // Return user data without passwordHash
        const user = {
          id: row.id,
          username: row.username,
          email: row.email,
          fullName: row.fullName,
          createdAt: row.createdAt,
          lastLoginAt: new Date().toISOString(),
        };
        resolve(user);
      });
    });
  });
}

async function getUserById(id) {
  await initDb();
  return new Promise((resolve, reject) => {
    const query = `
      SELECT id, username, email, fullName, createdAt, lastLoginAt
      FROM users
      WHERE id = ?
    `;
    db.get(query, [id], (err, row) => {
      if (err) {
        reject(err);
        return;
      }
      if (!row) {
        resolve(null);
        return;
      }
      resolve({
        id: row.id,
        username: row.username,
        email: row.email,
        fullName: row.fullName,
        createdAt: row.createdAt,
        lastLoginAt: row.lastLoginAt,
      });
    });
  });
}

async function getUserByUsername(username) {
  await initDb();
  return new Promise((resolve, reject) => {
    const query = `
      SELECT id, username, email, fullName, createdAt, lastLoginAt
      FROM users
      WHERE username = ?
    `;
    db.get(query, [username], (err, row) => {
      if (err) {
        reject(err);
        return;
      }
      if (!row) {
        resolve(null);
        return;
      }
      resolve({
        id: row.id,
        username: row.username,
        email: row.email,
        fullName: row.fullName,
        createdAt: row.createdAt,
        lastLoginAt: row.lastLoginAt,
      });
    });
  });
}

async function updateUser(id, updates = {}) {
  const allowed = ['username', 'email', 'fullName', 'password']; // password is special
  const fields = [];
  const values = [];

  if (!id) throw new Error('User id is required');

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

  let passwordPromise = null;
  if (updates.password) {
    passwordPromise = hashPassword(updates.password).then((hash) => {
      fields.push('passwordHash = ?');
      values.push(hash);
    });
  }

  await initDb();

  if (updates.password) {
    await passwordPromise;
  }

  if (fields.length === 0) {
    return false; // nothing to update
  }

  values.push(id);

  return new Promise((resolve, reject) => {
    const sql = `UPDATE users SET ${fields.join(', ')} WHERE id = ?`;
    db.run(sql, values, function (err) {
      if (err) {
        // Unique constraint handling
        if (err.code === 'SQLITE_CONSTRAINT' || err.message.includes('UNIQUE')) {
          reject(new Error('Update would violate unique constraints (username/email)'));
        } else {
          reject(err);
        }
        return;
      }
      resolve(this.changes > 0);
    });
  });
}

async function deleteUser(id) {
  await initDb();
  return new Promise((resolve, reject) => {
    const sql = `DELETE FROM users WHERE id = ?`;
    db.run(sql, [id], function (err) {
      if (err) {
        reject(err);
        return;
      }
      resolve(this.changes > 0);
    });
  });
}

// Simple wrapper to close db (if needed)
async function closeDb() {
  if (!db) return;
  return new Promise((resolve) => {
    db.close((_) => {
      db = null;
      resolve();
    });
  });
}

// Exported API
module.exports = {
  initDb,
  createUser,
  authenticateUser,
  getUserById,
  getUserByUsername,
  updateUser,
  deleteUser,
  closeDb,
  // Expose some utilities for testing or advanced usage
  hashPassword,
  comparePassword,
};
