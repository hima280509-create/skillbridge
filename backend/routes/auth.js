/**
 * SkillBridge – Auth Routes
 *
 * Authentication is handled by Firebase Auth on the client.
 * The backend only:
 *  - POST /api/auth/register  → creates/updates the users/{UID} Firestore doc
 *  - POST /api/auth/login     → validates the Firebase ID token, returns student profile
 *  - GET  /api/auth/me        → returns the student profile for the verified token
 *
 * The frontend must send a Firebase ID token as: Authorization: Bearer <idToken>
 */

'use strict';

const express = require('express');
const router  = express.Router();
const fs      = require('fs');
const path    = require('path');
const { FieldValue } = require('firebase-admin/firestore');
const auth    = require('../middleware/auth');
const db      = require('../services/firestoreService');
const { auth: firebaseAuth, storage, firestore } = require('../services/firebaseService');

const isNotFoundError = err => [5, '5', 'NOT_FOUND', 'not-found', 'ENOENT'].includes(err?.code);

async function deleteFirestoreTree(collectionName, uid) {
  console.log(`[auth/account-delete] Firestore deletion started: ${collectionName}/${uid}`);
  const documentRef = firestore.collection(collectionName).doc(uid);
  try {
    // Only resumes/{UID} has the nested data/parsed document in this project.
    // A direct Firestore delete is idempotent for the other optional documents.
    if (collectionName === 'resumes') {
      await firestore.recursiveDelete(documentRef);
    } else {
      await documentRef.delete();
    }
    console.log(`[auth/account-delete] Firestore deletion completed: ${collectionName}/${uid}`);
  } catch (err) {
    if (isNotFoundError(err)) {
      console.log(`[auth/account-delete] Firestore document missing: ${collectionName}/${uid}`);
      return;
    }
    err.deletionStep = `Firestore ${collectionName}/${uid}`;
    throw err;
  }
}

async function deleteLocalResumeFiles(uid) {
  const uploadDir = path.join(__dirname, '../uploads');
  console.log(`[auth/account-delete] Local resume deletion started: ${uploadDir}`);
  let fileNames;
  try {
    fileNames = await fs.promises.readdir(uploadDir);
  } catch (err) {
    if (err.code === 'ENOENT') {
      console.log('[auth/account-delete] Local resume directory does not exist');
      return;
    }
    err.deletionStep = 'Local resume directory read';
    throw err;
  }

  const uidPrefixes = [`resume_${uid}_`, `parse_${uid}_`];
  const matchingFiles = fileNames
    .filter(fileName => uidPrefixes.some(prefix => fileName.startsWith(prefix)))
  await Promise.all(matchingFiles.map(async fileName => {
    try {
      await fs.promises.unlink(path.join(uploadDir, fileName));
    } catch (err) {
      err.deletionStep = `Local resume file ${fileName}`;
      throw err;
    }
  }));
  console.log(`[auth/account-delete] Local resume deletion completed: ${matchingFiles.length} file(s)`);
}

async function deleteCloudResumeFiles(uid) {
  console.log(`[auth/account-delete] Firebase Storage deletion started: resumes/${uid}/`);
  try {
    const [files] = await storage.bucket().getFiles({ prefix: `resumes/${uid}/` });
    await Promise.all(files.map(file => file.delete()));
    console.log(`[auth/account-delete] Firebase Storage deletion completed: ${files.length} file(s)`);
  } catch (err) {
    // Firebase Storage is optional in this project; uploads currently use the local disk.
    console.warn('[auth/account-delete] Optional Firebase Storage cleanup skipped:', err);
  }
}

// ─── POST /api/auth/register ─────────────────────────────────────────────────
// Called after Firebase Auth creates the user on the client.
// Creates the users/{UID} Firestore document with initial profile fields.
router.post('/register', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ message: 'Firebase ID token required.' });
    }

    const idToken = authHeader.split(' ')[1];
    const decoded = await firebaseAuth.verifyIdToken(idToken);
    const uid     = decoded.uid;

    const { name, branch, academicYear, college } = req.body;

    const existing = await db.getStudent(uid);
    if (!existing) {
      await db.createStudent(uid, {
        uid,
        name:         name         || decoded.name  || '',
        email:        decoded.email || '',
        branch:       branch       || '',
        academicYear: academicYear || '2nd Year',
        college:      college      || '',
        role:         'student',
        skills:       [],
        projects:     [],
        certifications: [],
        experience:   [],
        fcmTokens:    [],
        aiAnalysis:   {},
        resumeParsed: false,
        resumeUrl:    '',
      });
    } else {
      // Update editable fields on re-register / profile completion
      const updates = { updatedAt: FieldValue.serverTimestamp() };
      if (name)         updates.name         = name;
      if (branch)       updates.branch       = branch;
      if (academicYear) updates.academicYear = academicYear;
      if (college)      updates.college      = college;
      await db.updateStudent(uid, updates);
    }

    const student = await db.getStudent(uid);
    res.status(201).json({ success: true, user: student });
  } catch (err) {
    console.error('[auth/register]', err.message);
    res.status(500).json({ message: 'Registration failed.', error: err.message });
  }
});

// ─── POST /api/auth/login ─────────────────────────────────────────────────────
// Verifies the Firebase ID token and returns the student profile.
router.post('/login', async (req, res) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ message: 'Firebase ID token required.' });
    }

    const idToken = authHeader.slice('Bearer '.length).trim();
    if (!idToken) {
      return res.status(401).json({ message: 'Firebase ID token required.' });
    }
    const decoded = await firebaseAuth.verifyIdToken(idToken);
    const uid     = decoded.uid;

    let student = await db.getStudent(uid);
    if (!student) {
      // Auto-create on first login
      await db.createStudent(uid, {
        uid,
        name:  decoded.name  || '',
        email: decoded.email || '',
        role:  'student',
        skills: [], projects: [], certifications: [], experience: [],
        fcmTokens: [], aiAnalysis: {}, resumeParsed: false, resumeUrl: '',
        branch: '', academicYear: '2nd Year', college: '',
      });
      student = await db.getStudent(uid);
    }

    res.json({ success: true, user: student });
  } catch (err) {
    console.error('[auth/login]', { code: err.code || null, message: err.message });
    if (err.code === 8 || err.code === '8' || err.code === 'RESOURCE_EXHAUSTED') {
      return res.status(503).json({ message: 'Firebase is temporarily unavailable because its service quota has been reached. Please try again later.' });
    }
    if (['auth/argument-error', 'auth/id-token-expired', 'auth/id-token-revoked', 'auth/invalid-id-token'].includes(err.code)) {
      return res.status(401).json({ message: 'Your Firebase session expired. Please sign in again.' });
    }
    res.status(503).json({ message: 'Firebase authentication is temporarily unavailable. Please try again.' });
  }
});

// ─── GET /api/auth/me ─────────────────────────────────────────────────────────
router.get('/me', auth, (req, res) => {
  res.json({ success: true, user: req.student });
});

router.delete('/account', auth, async (req, res) => {
  const uid = req.uid;
  console.log('[auth/account-delete] Authenticated UID:', uid);
  try {
    await Promise.all([
      deleteFirestoreTree('users', uid),
      deleteFirestoreTree('students', uid),
      deleteFirestoreTree('resumes', uid),
      deleteFirestoreTree('aiCache', uid),
      deleteLocalResumeFiles(uid),
      deleteCloudResumeFiles(uid),
    ]);

    console.log('[auth/account-delete] Firebase Auth deletion started:', uid);
    await firebaseAuth.deleteUser(uid);
    console.log('[auth/account-delete] Firebase Auth deletion completed:', uid);
    res.json({ success: true, message: 'Account and associated data deleted.' });
  } catch (err) {
    if (err.code === 'auth/user-not-found') {
      return res.json({ success: true, message: 'Account was already deleted.' });
    }
    console.error('[auth/account-delete]', {
      uid,
      step: err.deletionStep || 'Firebase Auth deletion',
      code: err.code || null,
      message: err.message,
      error: err,
    });
    res.status(500).json({
      success: false,
      message: 'Account deletion failed.',
      error: err.message,
      code: err.code || null,
    });
  }
});

module.exports = router;
