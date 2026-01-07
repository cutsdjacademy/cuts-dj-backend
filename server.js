const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
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

// Demo login
app.post('/auth/login', (req, res) => {
  const { userId, role } = req.body || {};
  if (!userId || !role) return res.status(400).json({ error: 'userId and role are required' });
  const token = jwt.sign({ uid: userId, role }, JWT_SECRET, { expiresIn: '7d' });
  res.json({ token });
});

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
  const out = db.enroll({ classId, studentId: req.user.uid });
  res.json(out);
});

// My enrollments (student)
app.get('/my-enrollments', requireAuth, requireRole('student'), (req, res) => {
  res.json(db.listEnrollmentsForStudent(req.user.uid));
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
  res.json(db.listAttendanceForStudent(req.user.uid));
});

// Payments (student)
app.get('/my-payments', requireAuth, requireRole('student'), (req, res) => {
  res.json(db.listPaymentsForStudent(req.user.uid));
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Server listening on ${port}`));
