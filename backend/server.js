/**
 * SkillBridge – Express Server
 *
 * Database: Firebase Firestore (no MongoDB)
 * Auth:     Firebase Authentication (ID token verification via firebase-admin)
 * User data: users/{UID}
 * Resume data:  resumes/{UID}/data/parsed
 * Reference collections: careers, skills, jobs, internships, placements,
 *                        competitions, freeCertificates
 */

'use strict';


const express = require('express');
const cors    = require('cors');
const path    = require('path');
const fs      = require('fs');
const admin   = require('firebase-admin');
require('dotenv').config({ path: __dirname + '/config.env' });
const firebase = require('./services/firebaseService');

console.log('✅ Firebase Admin initialized — project:', firebase.app.options.projectId);
console.log('[Gemini] startup configuration:', JSON.stringify({
  apiKeyConfigured: Boolean(process.env.GEMINI_API_KEY),
  model: process.env.GEMINI_MODEL || 'gemini-3.6-flash',
}));

const app = express();

// ─── Middleware ───────────────────────────────────────────────────────────────
app.use(cors({
  origin: ['http://localhost:3000', 'http://127.0.0.1:5500', 'http://localhost:5500', '*'],
  credentials: true,
}));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// ─── Static files ─────────────────────────────────────────────────────────────
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });
app.use('/uploads', express.static(uploadDir));
app.use(express.static(path.join(__dirname, '../frontend')));

// ─── API Routes ───────────────────────────────────────────────────────────────
app.use('/api/auth',          require('./routes/auth'));
app.use('/api/users',         require('./routes/users'));
app.use('/api/resume',        require('./routes/resume'));
app.use('/api/analysis',      require('./routes/analysis'));
app.use('/api/opportunities', require('./routes/opportunities'));
app.use('/api/ai',            require('./routes/ai'));
app.use('/api/email',         require('./routes/email'));
app.use('/api/notifications', require('./routes/notifications'));

// ─── Health check ─────────────────────────────────────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({
    status:    'ok',
    message:   'SkillBridge API is running',
    database:  'Firestore',
    timestamp: new Date().toISOString(),
  });
});

// ─── SPA fallback ─────────────────────────────────────────────────────────────
app.get('*', (req, res) => {
  if (!req.path.startsWith('/api')) {
    res.sendFile(path.join(__dirname, '../frontend/index.html'));
  } else {
    res.status(404).json({ message: 'API route not found' });
  }
});

// ─── Error handler ────────────────────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ message: 'Internal server error', error: err.message });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`🚀 SkillBridge Server running on http://localhost:${PORT}`);
  console.log(`📊 API available at http://localhost:${PORT}/api`);
  console.log(`🌐 Frontend at http://localhost:${PORT}`);
  console.log(`🔥 Database: Firebase Firestore`);
});

module.exports = app;
