/**
 * SkillBridge – Auth Middleware
 *
 * Verifies a Firebase ID token sent as `Authorization: Bearer <idToken>`.
 * Sets req.user (decoded Firebase claims), req.uid (Firebase UID), and
 * req.student (Firestore users/{UID} doc).
 *
 * The frontend must pass the Firebase ID token obtained from:
 *   firebase.auth().currentUser.getIdToken()
 */

'use strict';

const db = require('../services/firestoreService');
const { auth: firebaseAuth } = require('../services/firebaseService');

module.exports = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !/^Bearer\s+\S+$/i.test(authHeader)) {
      return res.status(401).json({ message: 'Access denied. No token provided.' });
    }

    const idToken = authHeader.replace(/^Bearer\s+/i, '');

    // Verify Firebase ID token — identifies the logged-in student by UID
    const decoded = await firebaseAuth.verifyIdToken(idToken);
    req.user = decoded;
    req.uid = decoded.uid;
    console.log('Authenticated UID:', req.user?.uid);

    // Attach student Firestore document (users/{UID})
    const student = await db.getStudent(req.uid);
    if (!student) {
      // First-time access: create a minimal student doc from token claims
      const minimalStudent = {
        uid:   decoded.uid,
        email: decoded.email || '',
        name:  decoded.name  || '',
        role:  'student',
        skills: [],
        projects: [],
        certifications: [],
        experience: [],
        fcmTokens: [],
        aiAnalysis: {},
      };
      await db.createStudent(req.uid, minimalStudent);
      req.student = minimalStudent;
    } else {
      req.student = student;
    }

    next();
  } catch (err) {
    console.error('[auth middleware]', err.message);
    if (err.code === 8 || err.code === '8' || err.code === 'RESOURCE_EXHAUSTED') {
      return res.status(503).json({ message: 'Firebase is temporarily unavailable because its service quota has been reached. Please try again later.' });
    }
    res.status(401).json({ message: 'Invalid or expired Firebase token.' });
  }
};
