// src/db.js
// SQLite data layer (better-sqlite3) + auth + app tables for classes, announcements, enrollments, attendance, payments

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
  db.pragma('foreign_keys = ON');

  // USERS
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      email TEXT UNIQUE,
      fullName TEXT,
      role TEXT NOT NULL CHECK (role IN ('student','teacher','admin')),
      passwordHash TEXT NOT NULL,
      createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
      lastLoginAt DATETIME
    );
  `);

  // CLASSES
  db.exec(`
    CREATE TABLE IF NOT EXISTS classes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      description TEXT,
      teacherId INTEGER,
      startAt DATETIME,
      endAt DATETIME,
      createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (teacherId) REFERENCES users(id) ON DELETE SET NULL
    );
  `);

  // ANNOUNCEMENTS
  db.exec(`
    CREATE TABLE IF NOT EXISTS announcements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      audienceRole TEXT CHECK (audienceRole IN ('student','teacher','admin','all')) DEFAULT 'all',
      createdAt DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // ENROLLMENTS (student -> class)
  db.exec(`
    CREATE TABLE IF NOT EXISTS enrollments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      classId INTEGER NOT NULL,
      studentId INTEGER NOT NULL,
      createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(classId, studentId),
      FOREIGN KEY (classId) REFERENCES classes(id) ON DELETE CASCADE,
      FOREIGN KEY (studentId) REFERENCES users(id) ON DELETE CASCADE
    );
  `);

  // ATTENDANCE
  db.exec(`
    CREATE TABLE IF NOT EXISTS attendance (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      classId INTEGER NOT NULL,
      studentId INTEGER NOT NULL,
      date TEXT NOT NULL, -- YYYY-MM-DD
      status TEXT NOT NULL CHECK (status IN ('present','absent','late','excused')),
      createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(classId, studentId, date),
      FOREIGN KEY (classId) REFERENCES classes(id) ON DELETE CASCADE,
      FOREIGN KEY (studentId) REFERENCES users(id) ON DELETE CASCADE
    );
  `);

  // PAYMENTS
  db.exec(`
    CREATE TABLE IF NOT EXISTS payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      studentId INTEGER NOT NULL,
      amountCents INTEGER NOT NULL,
      currency TEXT NOT NULL DEFAULT 'USD',
      status TEXT NOT NULL CHECK (status IN ('pending','paid','failed','refunded')) DEFAULT 'pending',
      note TEXT,
      createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (studentId) REFERENCES users(id) ON DELETE CASCADE
    );
  `);

  // Helpful indexes
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
    CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
    CREATE INDEX IF NOT EXISTS idx_enrollments_studentId ON enrollments(studentId);
    CREATE INDEX IF NOT EXISTS idx_attendance_studentId ON attendance(studentId);
    CREATE INDEX IF NOT EXISTS idx_payments_studentId ON payments(studentId);
  `);

  return db;
}

// ---------- Helpers ----------
async function hashPassword(plain) {
  const salt = await bcrypt.genSalt(SALT_ROUNDS);
  return bcrypt.hash(plain, salt);
}

async function comparePassword(plain, hash) {
  return bcrypt.compare(plain, hash);
}

function normalizeIdentifier(s) {
  return String(s || '').trim();
}

function isEmail(s) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(s || '').trim());
}

// ---------- Users ----------
async function createUser({ username, email = null, fullName = null, role, password }) {
  username = normalizeIdentifier(username);
  email = email ? normalizeIdentifier(email).toLowerCase() : null;

  if (!username) throw new Error('username is required');
  if (email && !isEmail(email)) throw new Error('email is invalid');
  if (!role) throw new Error('role is required');
  if (!password) throw new Error('password is required');

  const passwordHash = await hashPassword(password);

  await initDb();

  try {
    const info = db
      .prepare(
        `INSERT INTO users (username, email, fullName, role, passwordHash)
         VALUES (?, ?, ?, ?, ?)`
      )
      .run(username, email, fullName, role, passwordHash);

    return getUserById(info.lastInsertRowid);
  } catch (err) {
    if (err && (err.code === 'SQLITE_CONSTRAINT_UNIQUE' || String(err.message || '').includes('UNIQUE'))) {
      throw new Error('User with this username or email already exists');
    }
    throw err;
  }
}

async function findUserByEmail(email) {
  email = normalizeIdentifier(email).toLowerCase();
  if (!email) return null;
  await initDb();
  return (
    db
      .prepare(
        `SELECT id, username, email, fullName, role, createdAt, lastLoginAt
         FROM users WHERE email = ?`
      )
      .get(email) || null
  );
}

async function findUserByUsername(username) {
  username = normalizeIdentifier(username);
  if (!username) return null;
  await initDb();
  return (
    db
      .prepare(
        `SELECT id, username, email, fullName, role, createdAt, lastLoginAt
         FROM users WHERE username = ?`
      )
      .get(username) || null
  );
}

async function getUserById(id) {
  await initDb();
  return (
    db
      .prepare(
        `SELECT id, username, email, fullName, role, createdAt, lastLoginAt
         FROM users WHERE id = ?`
      )
      .get(id) || null
  );
}

async function getUserAuthByIdentifier(identifier) {
  // identifier can be username OR email
  identifier = normalizeIdentifier(identifier);
  if (!identifier) return null;

  await initDb();

  if (isEmail(identifier)) {
    return (
      db
        .prepare(
          `SELECT id, username, email, fullName, role, passwordHash, createdAt, lastLoginAt
           FROM users WHERE email = ?`
        )
        .get(identifier.toLowerCase()) || null
    );
  }

  return (
    db
      .prepare(
        `SELECT id, username, email, fullName, role, passwordHash, createdAt, lastLoginAt
         FROM users WHERE username = ?`
      )
      .get(identifier) || null
  );
}

async function authenticateUser(identifier, password) {
  if (!identifier || !password) throw new Error('identifier and password are required');

  const row = await getUserAuthByIdentifier(identifier);
  if (!row) return null;

  const match = await comparePassword(password, row.passwordHash);
  if (!match) return null;

  await initDb();
  db.prepare(`UPDATE users SET lastLoginAt = CURRENT_TIMESTAMP WHERE id = ?`).run(row.id);

  return {
    id: row.id,
    username: row.username,
    email: row.email,
    fullName: row.fullName,
    role: row.role,
    createdAt: row.createdAt,
    lastLoginAt: new Date().toISOString(),
  };
}

async function updateUser(id, updates = {}) {
  if (!id) throw new Error('User id is required');

  await initDb();

  const fields = [];
  const values = [];

  if (updates.username) {
    fields.push('username = ?');
    values.push(normalizeIdentifier(updates.username));
  }
  if (updates.email !== undefined) {
    const email = updates.email ? normalizeIdentifier(updates.email).toLowerCase() : null;
    if (email && !isEmail(email)) throw new Error('email is invalid');
    fields.push('email = ?');
    values.push(email);
  }
  if (updates.fullName !== undefined) {
    fields.push('fullName = ?');
    values.push(updates.fullName || null);
  }
  if (updates.role) {
    fields.push('role = ?');
    values.push(updates.role);
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

// ---------- App data ----------
async function listClasses() {
  await initDb();
  return db
    .prepare(
      `SELECT c.id, c.title, c.description, c.teacherId, u.fullName AS teacherName, c.startAt, c.endAt, c.createdAt
       FROM classes c
       LEFT JOIN users u ON u.id = c.teacherId
       ORDER BY c.createdAt DESC`
    )
    .all();
}

async function createClass({ title, description = null, teacherId = null, startAt = null, endAt = null }) {
  await initDb();
  const info = db
    .prepare(
      `INSERT INTO classes (title, description, teacherId, startAt, endAt)
       VALUES (?, ?, ?, ?, ?)`
    )
    .run(title, description, teacherId, startAt, endAt);
  return db.prepare(`SELECT * FROM classes WHERE id = ?`).get(info.lastInsertRowid);
}

async function listAnnouncements({ role = 'all' } = {}) {
  await initDb();
  // show 'all' + targeted role
  return db
    .prepare(
      `SELECT id, title, body, audienceRole, createdAt
       FROM announcements
       WHERE audienceRole = 'all' OR audienceRole = ?
       ORDER BY createdAt DESC`
    )
    .all(role);
}

async function createAnnouncement({ title, body, audienceRole = 'all' }) {
  await initDb();
  const info = db
    .prepare(
      `INSERT INTO announcements (title, body, audienceRole)
       VALUES (?, ?, ?)`
    )
    .run(title, body, audienceRole);
  return db.prepare(`SELECT * FROM announcements WHERE id = ?`).get(info.lastInsertRowid);
}

async function enroll({ classId, studentId }) {
  await initDb();
  try {
    const info = db
      .prepare(`INSERT INTO enrollments (classId, studentId) VALUES (?, ?)`)
      .run(classId, studentId);
    return db.prepare(`SELECT * FROM enrollments WHERE id = ?`).get(info.lastInsertRowid);
  } catch (err) {
    if (err && (err.code === 'SQLITE_CONSTRAINT_UNIQUE' || String(err.message || '').includes('UNIQUE'))) {
      throw new Error('Already enrolled');
    }
    throw err;
  }
}

async function listEnrollmentsForStudent(studentId) {
  await initDb();
  return db
    .prepare(
      `SELECT e.id, e.classId, e.studentId, e.createdAt,
              c.title, c.description, c.startAt, c.endAt
       FROM enrollments e
       JOIN classes c ON c.id = e.classId
       WHERE e.studentId = ?
       ORDER BY e.createdAt DESC`
    )
    .all(studentId);
}

async function markAttendance({ classId, studentId, status, date }) {
  await initDb();
  const isoDate = date || new Date().toISOString().slice(0, 10); // YYYY-MM-DD

  // Upsert
  const existing = db
    .prepare(`SELECT id FROM attendance WHERE classId = ? AND studentId = ? AND date = ?`)
    .get(classId, studentId, isoDate);

  if (existing) {
    db.prepare(`UPDATE attendance SET status = ? WHERE id = ?`).run(status, existing.id);
    return db.prepare(`SELECT * FROM attendance WHERE id = ?`).get(existing.id);
  }

  const info = db
    .prepare(`INSERT INTO attendance (classId, studentId, date, status) VALUES (?, ?, ?, ?)`)
    .run(classId, studentId, isoDate, status);

  return db.prepare(`SELECT * FROM attendance WHERE id = ?`).get(info.lastInsertRowid);
}

async function listAttendanceForStudent(studentId) {
  await initDb();
  return db
    .prepare(
      `SELECT a.id, a.classId, a.studentId, a.date, a.status, a.createdAt,
              c.title
       FROM attendance a
       JOIN classes c ON c.id = a.classId
       WHERE a.studentId = ?
       ORDER BY a.date DESC, a.createdAt DESC`
    )
    .all(studentId);
}

async function listPaymentsForStudent(studentId) {
  await initDb();
  return db
    .prepare(
      `SELECT id, studentId, amountCents, currency, status, note, createdAt
       FROM payments
       WHERE studentId = ?
       ORDER BY createdAt DESC`
    )
    .all(studentId);
}

async function createPayment({ studentId, amountCents, currency = 'USD', status = 'pending', note = null }) {
  await initDb();
  const info = db
    .prepare(
      `INSERT INTO payments (studentId, amountCents, currency, status, note)
       VALUES (?, ?, ?, ?, ?)`
    )
    .run(studentId, amountCents, currency, status, note);
  return db.prepare(`SELECT * FROM payments WHERE id = ?`).get(info.lastInsertRowid);
}

async function closeDb() {
  if (!db) return;
  db.close();
  db = null;
}

module.exports = {
  initDb,

  // auth helpers
  hashPassword,
  comparePassword,

  // users
  createUser,
  authenticateUser,
  getUserById,
  findUserByEmail,
  findUserByUsername,
  updateUser,
  deleteUser,

  // app data
  listClasses,
  createClass,
  listAnnouncements,
  createAnnouncement,
  enroll,
  listEnrollmentsForStudent,
  markAttendance,
  listAttendanceForStudent,
  listPaymentsForStudent,
  createPayment,

  closeDb,
};
