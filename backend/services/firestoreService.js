/**
 * SkillBridge – Firestore Data Access Service
 *
 * Single source of truth for all Firestore reads/writes.
 * User data: users/{UID}
 * Resume data:  resumes/{UID}/data/parsed
 * Reference collections: careers, skills, jobs, internships,
 *                        placements, competitions, freeCertificates
 *
 * Rules:
 *  - Never access another student's data
 *  - Never use unrelated collections for a feature
 *  - All IDs are Firebase Auth UIDs
 */

'use strict';

const { FieldValue } = require('firebase-admin/firestore');
const { firestore } = require('./firebaseService');

function getDb() {
  return firestore;
}

// ─── Student document ─────────────────────────────────────────────────────────

async function getStudent(uid) {
  const userDoc = await getDb().collection('users').doc(uid).get();
  if (userDoc.exists) return { uid, ...userDoc.data() };
  const legacyDoc = await getDb().collection('students').doc(uid).get();
  if (!legacyDoc.exists) return null;
  const migrated = { uid, ...legacyDoc.data() };
  await getDb().collection('users').doc(uid).set(migrated, { merge: true });
  return migrated;
}

async function setStudent(uid, data) {
  await getDb().collection('users').doc(uid).set({ uid, ...data }, { merge: true });
}

async function updateStudent(uid, updates) {
  await getDb().collection('users').doc(uid).set({ uid, ...updates }, { merge: true });
}

async function createStudent(uid, data) {
  await getDb().collection('users').doc(uid).set({
    ...data,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  });
}

async function getAllStudents() {
  const snapshot = await getDb().collection('users').get();
  return snapshot.docs.map(doc => ({ uid: doc.id, ...doc.data() }));
}

// ─── Resume document ──────────────────────────────────────────────────────────

/**
 * Stored at resumes/{UID}/data/parsed
 */
async function getResume(uid) {
  const doc = await getDb().collection('resumes').doc(uid).collection('data').doc('parsed').get();
  if (!doc.exists) return null;
  return doc.data();
}

async function setResume(uid, parsedData) {
  await getDb()
    .collection('resumes')
    .doc(uid)
    .collection('data')
    .doc('parsed')
    .set({ ...parsedData, updatedAt: FieldValue.serverTimestamp() });
}

// ─── Reference collections (read-only for features) ──────────────────────────

async function getCollection(collectionName, filters = {}) {
  const snapshot = await getDb().collection(collectionName).get();
  return snapshot.docs
    .map(doc => ({ id: doc.id, ...doc.data() }))
    .filter(doc => filters.isActive === undefined || filters.isActive !== true || doc.isActive !== false)
    .filter(doc => !filters.domain || doc.domain === filters.domain)
    .filter(doc => !filters.level || doc.level === filters.level);
}

async function getDocById(collectionName, docId) {
  const doc = await getDb().collection(collectionName).doc(docId).get();
  if (!doc.exists) return null;
  return { id: doc.id, ...doc.data() };
}

// ─── FCM token helpers on users/{UID} ────────────────────────────────────────

async function addFcmToken(uid, token) {
  await getDb().collection('users').doc(uid).set(
    { fcmTokens: FieldValue.arrayUnion(token), updatedAt: FieldValue.serverTimestamp() },
    { merge: true }
  );
}

async function removeFcmToken(uid, token) {
  await getDb().collection('users').doc(uid).set(
    { fcmTokens: FieldValue.arrayRemove(token), updatedAt: FieldValue.serverTimestamp() },
    { merge: true }
  );
}

async function getFcmTokens(uid) {
  const student = await getStudent(uid);
  return student?.fcmTokens || [];
}

// ─── AI analysis persistence on users/{UID} ──────────────────────────────────

async function saveAiAnalysis(uid, analysisFields) {
  const nested = {};
  for (const [key, val] of Object.entries(analysisFields)) {
    nested[`aiAnalysis.${key}`] = val;
  }
  nested['updatedAt'] = FieldValue.serverTimestamp();
  await getDb().collection('users').doc(uid).set({ uid, ...nested }, { merge: true });
}

async function getAiCache(uid) {
  const doc = await getDb().collection('aiCache').doc(uid).get();
  if (!doc.exists) return null;
  return { uid, ...doc.data() };
}

async function saveAiCache(uid, data) {
  await getDb().collection('aiCache').doc(uid).set({
    uid,
    ...data,
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });
}

module.exports = {
  getStudent,
  setStudent,
  updateStudent,
  createStudent,
  getAllStudents,
  getResume,
  setResume,
  getCollection,
  getDocById,
  addFcmToken,
  removeFcmToken,
  getFcmTokens,
  saveAiAnalysis,
  getAiCache,
  saveAiCache,
};
