const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const db = require('./src/db');

const app = express();

// CORS (allow GoodBarber webview + Authorization header)
app.use(cors({ origin: "*", allowedHeaders: ["Content-Type", "Authorization"] }));

app.use(express.json());

const JWT_SECRET = process.env.JWT_SECRET || 'change-me';

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
app.get('/', (req, res) => res.send('Cuts DJ Backend running'));

// NEW: Secure email/password registration
app.post('/auth/register', async (req, res) => {
  const { email, password, role } = req.body || {};
  if (!email || !password || !role) {
    return res.status(400).json({ error: 'Email, password, and role are required' });
  }

  try {
    const existingUser = db.findUserByEmail(email);
    if (existingUser) return res.status(400).json({ error: 'User already exists' });

    const passwordHash = await bcrypt.hash(password, 10);
    const user = db.createUser({ email, passwordHash, role });

    res.json({ id: user.id, email: user.email, role: user.role });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// NEW: Secure email/password login (replaces demo login)
app.post('/auth/login', async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }

  try {
    const user = db.findUserByEmail(email);
    if (!user) return res.status(401).json({ error: 'Invalid email or password' });

    const isValidPassword = await bcrypt.compare(password, user.password_hash);
    if (!isValidPassword) return res.status(401).json({ error: 'Invalid email or password' });

    const token = jwt.sign({ userId: user.id, role: user.role }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ token, userId: user.id, role: user.role });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// REMOVED: Demo login endpoint (replaced by secure login above)
// app.post('/auth/login', (req, res) => {
//   const { userId, role } = req.body || {};
//   if (!userId || !role) return res.status(400).json({ error: 'userId and role are required' });
//   const token = jwt.sign({ uid: userId, role }, JWT_SECRET, { expiresIn: '7d' });
//   res.json({ token });
// });

// Classes
app.get('/classes', requireAuth, (req, res) => {
  res.json(db.listClasses());
});

// Announcements
app.get('/announcements', requireAuth, (req, res) => {
  res.json(db.listAnnouncements());
});

// Enroll (student)
app.post('/enroll', requireAuth, requireRole('student'), (req, res) => {
  const { classId } = req.body || {};
  if (!classId) return res.status(400).json({ error: 'classId is required' });
  const out = db.enroll({ classId, studentId: req.user.userId });
  res.json(out);
});

// My enrollments (student)
app.get('/my-enrollments', requireAuth, requireRole('student'), (req, res) => {
  res.json(db.listEnrollmentsForStudent(req.user.userId));
});

// Attendance (teacher)
app.post('/attendance', requireAuth, requireRole('teacher'), (req, res) => {
  const { classId, studentId, status } = req.body || {};
  if (!classId || !studentId || !status) {
    return res.status(400).json({ error: 'classId, studentId, status required' });
  }
  res.json(db.markAttendance({ classId, studentId, status }));
});

// Attendance (student view)
app.get('/my-attendance', requireAuth, requireRole('student'), (req, res) => {
  res.json(db.listAttendanceForStudent(req.user.userId));
});

// Payments (student)
app.get('/my-payments', requireAuth, requireRole('student'), (req, res) => {
  res.json(db.listPaymentsForStudent(req.user.userId));
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Server listening on ${port}`));
