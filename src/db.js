const Database = require('better-sqlite3');
const path = require('path');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'data.sqlite');
const db = new Database(DB_PATH);

// Schema
db.exec(`
CREATE TABLE IF NOT EXISTS classes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  start_time TEXT NOT NULL,
  end_time TEXT NOT NULL,
  capacity INTEGER NOT NULL DEFAULT 0,
  instructor TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS enrollments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  class_id INTEGER NOT NULL,
  student_id TEXT NOT NULL,
  status TEXT NOT NULL,
  enrolled_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS attendance (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  class_id INTEGER NOT NULL,
  student_id TEXT NOT NULL,
  status TEXT NOT NULL,
  ts TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  student_id TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  status TEXT NOT NULL,
  due_date TEXT,
  paid_at TEXT
);

CREATE TABLE IF NOT EXISTS announcements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  class_id INTEGER,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  created_at TEXT NOT NULL
);

-- NEW: Users table for authentication
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL,
  created_at TEXT NOT NULL
);
`);

// Seed minimal data (only if classes table empty)
const classCount = db.prepare('SELECT COUNT(*) AS c FROM classes').get().c;
if (classCount === 0) {
  const now = new Date();
  const iso = (d) => d.toISOString().slice(0, 16).replace('T', ' ');

  const c1Start = new Date(now.getTime() + 2 * 24 * 3600 * 1000);
  const c1End = new Date(c1Start.getTime() + 2 * 3600 * 1000);
  const c2Start = new Date(now.getTime() + 3 * 24 * 3600 * 1000);
  const c2End = new Date(c2Start.getTime() + 2 * 3600 * 1000);

  db.prepare('INSERT INTO classes (title, start_time, end_time, capacity, instructor) VALUES (?,?,?,?,?)')
    .run('DJ Basics', iso(c1Start), iso(c1End), 20, 'Instructor A');
  db.prepare('INSERT INTO classes (title, start_time, end_time, capacity, instructor) VALUES (?,?,?,?,?)')
    .run('Mix Master 101', iso(c2Start), iso(c2End), 15, 'Instructor B');

  db.prepare('INSERT INTO announcements (class_id, title, message, created_at) VALUES (?,?,?,?)')
    .run(null, 'Welcome', 'Welcome to Cuts DJ Academy!', new Date().toISOString());
}

// NEW: User management functions
function createUser({ email, passwordHash, role }) {
  const createdAt = new Date().toISOString();
  try {
    const stmt = db.prepare('INSERT INTO users (email, password_hash, role, created_at) VALUES (?, ?, ?, ?)');
    const result = stmt.run(email, passwordHash, role, createdAt);
    return { id: result.lastInsertRowid, email, role };
  } catch (error) {
    if (error.message.includes('UNIQUE constraint failed')) {
      throw new Error('User with this email already exists');
    }
    throw error;
  }
}

function findUserByEmail(email) {
  const stmt = db.prepare('SELECT * FROM users WHERE email = ?');
  return stmt.get(email);
}

// Queries
function listClasses() {
  return db.prepare('SELECT * FROM classes ORDER BY start_time ASC').all();
}

function listAnnouncements() {
  return db.prepare('SELECT * FROM announcements ORDER BY created_at DESC').all();
}

function enroll({ classId, studentId }) {
  const enrolledAt = new Date().toISOString();
  const existing = db.prepare('SELECT id FROM enrollments WHERE class_id = ? AND student_id = ? AND status = ?')
    .get(classId, studentId, 'enrolled');
  if (existing) return { ok: true, enrollmentId: existing.id, alreadyEnrolled: true };
  const info = db.prepare(
    'INSERT INTO enrollments (class_id, student_id, status, enrolled_at) VALUES (?,?,?,?)'
  ).run(classId, studentId, 'enrolled', enrolledAt);
  return { ok: true, enrollmentId: info.lastInsertRowid, alreadyEnrolled: false };
}

function listEnrollmentsForStudent(studentId) {
  return db.prepare(
    `SELECT e.*, c.title, c.start_time, c.end_time, c.instructor
     FROM enrollments e
     JOIN classes c ON c.id = e.class_id
     WHERE e.student_id = ?
     ORDER BY c.start_time ASC`
  ).all(studentId);
}

function markAttendance({ classId, studentId, status }) {
  const ts = new Date().toISOString();
  const info = db.prepare(
    'INSERT INTO attendance (class_id, student_id极

I notice the code got cut off at the end. Let me provide the complete markAttendance function and the rest of the file:

