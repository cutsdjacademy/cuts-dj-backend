// server.js
const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const db = require('./src/db');

const app = express();

const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'change-me';
const CORS_ORIGIN = process.env.CORS_ORIGIN || '*';

// CORS (GoodBarber webview + Authorization header)
app.use(
  cors({
    origin: CORS_ORIGIN,
    allowedHeaders: ['Content-Type', 'Authorization'],
  })
);

app.use(express.json());

function signToken(user) {
  return jwt.sign(
    { userId: user.id, role: user.role, username: user.username },
    JWT_SECRET,
    { expiresIn: '7d' }
  );
}

function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Missing token' });

  try {
    req.user = jwt.verify(token, JWT_SECRET);
    return next();
  } catch {
    return res.status(401).json({ error: 'Invalid token' });
  }
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user?.role || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    next();
  };
}

// Health
app.get('/', (_req, res) => res.send('Cuts DJ Backend running'));

// Ensure DB is initialized early
app.use(async (_req, _res, next) => {
  try {
    await db.initDb();
    next();
  } catch (e) {
    next(e);
  }
});

// Auth: register (username + optional email)
app.post('/auth/register', async (req, res) => {
  const { username, email, fullName, password, role } = req.body || {};

  if (!username || !password || !role) {
    return res.status(400).json({ error: 'username, password, and role are required' });
  }

  try {
    const user = await db.createUser({ username, email, fullName, password, role });
    const token = signToken(user);
    res.json({ token, user });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

// Auth: login by username OR email
app.post('/auth/login', async (req, res) => {
  const { identifier, password } = req.body || {};
  if (!identifier || !password) {
    return res.status(400).json({ error: 'identifier and password are required' });
  }

  try {
    const user = await db.authenticateUser(identifier, password);
    if (!user) return res.status(401).json({ error: 'Invalid credentials' });

    const token = signToken(user);
    res.json({ token, user });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Auth: current user
app.get('/auth/me', requireAuth, async (req, res) => {
  const user = await db.getUserById(req.user.userId);
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json({ user });
});

// Classes
app.get('/classes', requireAuth, async (_req, res) => {
  res.json(await db.listClasses());
});

// Optional: teacher/admin create class
app.post('/classes', requireAuth, requireRole('teacher', 'admin'), async (req, res) => {
  const { title, description, startAt, endAt } = req.body || {};
  if (!title) return res.status(400).json({ error: 'title is required' });

  const created = await db.createClass({
    title,
    description: description || null,
    teacherId: req.user.role === 'teacher' ? req.user.userId : null,
    startAt: startAt || null,
    endAt: endAt || null,
  });

  res.json(created);
});

// Announcements
app.get('/announcements', requireAuth, async (req, res) => {
  res.json(await db.listAnnouncements({ role: req.user.role }));
});

// Optional: admin create announcement
app.post('/announcements', requireAuth, requireRole('admin'), async (req, res) => {
  const { title, body, audienceRole } = req.body || {};
  if (!title || !body) return res.status(400).json({ error: 'title and body are required' });
  res.json(await db.createAnnouncement({ title, body, audienceRole: audienceRole || 'all' }));
});

// Enroll (student)
app.post('/enroll', requireAuth, requireRole('student'), async (req, res) => {
  const { classId } = req.body || {};
  if (!classId) return res.status(400).json({ error: 'classId is required' });

  try {
    const out = await db.enroll({ classId, studentId: req.user.userId });
    res.json(out);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// My enrollments (student)
app.get('/my-enrollments', requireAuth, requireRole('student'), async (req, res) => {
  res.json(await db.listEnrollmentsForStudent(req.user.userId));
});

// Attendance (teacher/admin)
app.post('/attendance', requireAuth, requireRole('teacher', 'admin'), async (req, res) => {
  const { classId, studentId, status, date } = req.body || {};
  if (!classId || !studentId || !status) {
    return res.status(400).json({ error: 'classId, studentId, status required' });
  }
  res.json(await db.markAttendance({ classId, studentId, status, date }));
});

// Attendance (student view)
app.get('/my-attendance', requireAuth, requireRole('student'), async (req, res) => {
  res.json(await db.listAttendanceForStudent(req.user.userId));
});

// Payments (student)
app.get('/my-payments', requireAuth, requireRole('student'), async (req, res) => {
  res.json(await db.listPaymentsForStudent(req.user.userId));
});

// Payments (admin): create a payment/charge for a student
app.post('/payments', requireAuth, requireRole('admin'), async (req, res) => {
  const { studentId, amountCents, currency, status, note } = req.body || {};
  if (!studentId || !amountCents) {
    return res.status(400).json({ error: 'studentId and amountCents are required' });
  }
  res.json(await db.createPayment({ studentId, amountCents, currency, status, note }));
});

// Payments (admin): list all payments
app.get('/payments', requireAuth, requireRole('admin'), async (_req, res) => {
  res.json(await db.listAllPayments());
});

// Basic error handler
app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: 'Server error' });
});

app.listen(PORT, () => console.log(`Server listening on ${PORT}`));
