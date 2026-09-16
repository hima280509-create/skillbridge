/**
 * SkillBridge – Notification Routes (FCM Push)
 *
 * FCM tokens stored in users/{UID}.fcmTokens via Firestore.
 * No MongoDB.
 *
 * POST   /api/notifications/register-token
 * DELETE /api/notifications/unregister-token
 * POST   /api/notifications/send-deadline
 * POST   /api/notifications/send-interview
 * POST   /api/notifications/send-job-alert
 * POST   /api/notifications/send-course-completion
 * POST   /api/notifications/send-progress
 * POST   /api/notifications/send-opportunity-match
 * POST   /api/notifications/broadcast  (admin only)
 */

'use strict';

const express = require('express');
const router  = express.Router();
const auth    = require('../middleware/auth');
const db      = require('../services/firestoreService');
const fcm     = require('../services/firebaseService');

// ─── POST /api/notifications/register-token ───────────────────────────────────
router.post('/register-token', auth, async (req, res) => {
  try {
    const { fcmToken } = req.body;
    if (!fcmToken) return res.status(400).json({ message: 'fcmToken is required' });

    await db.addFcmToken(req.uid, fcmToken);
    res.json({ success: true, message: 'FCM token registered' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─── DELETE /api/notifications/unregister-token ───────────────────────────────
router.delete('/unregister-token', auth, async (req, res) => {
  try {
    const { fcmToken } = req.body;
    if (!fcmToken) return res.status(400).json({ message: 'fcmToken is required' });
    await db.removeFcmToken(req.uid, fcmToken);
    res.json({ success: true, message: 'FCM token removed' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─── POST /api/notifications/send-deadline ────────────────────────────────────
router.post('/send-deadline', auth, async (req, res) => {
  try {
    const tokens = await db.getFcmTokens(req.uid);
    if (!tokens.length) return res.status(400).json({ message: 'No FCM token registered for this user' });

    const { title, company, daysLeft, deadlineDate } = req.body;
    const results = await Promise.allSettled(
      tokens.map(token => fcm.sendDeadlineReminderNotification(token, { title, company, daysLeft, deadlineDate }))
    );
    const sent = results.filter(r => r.status === 'fulfilled').length;
    res.json({ success: true, sent, total: tokens.length });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─── POST /api/notifications/send-interview ───────────────────────────────────
router.post('/send-interview', auth, async (req, res) => {
  try {
    const tokens = await db.getFcmTokens(req.uid);
    if (!tokens.length) return res.status(400).json({ message: 'No FCM token registered' });

    const results = await Promise.allSettled(
      tokens.map(token => fcm.sendInterviewScheduleNotification(token, req.body))
    );
    const sent = results.filter(r => r.status === 'fulfilled').length;
    res.json({ success: true, sent, total: tokens.length });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─── POST /api/notifications/send-job-alert ───────────────────────────────────
router.post('/send-job-alert', auth, async (req, res) => {
  try {
    const tokens = await db.getFcmTokens(req.uid);
    if (!tokens.length) return res.status(400).json({ message: 'No FCM token registered' });

    const results = await Promise.allSettled(
      tokens.map(token => fcm.sendJobAlertNotification(token, req.body))
    );
    const sent = results.filter(r => r.status === 'fulfilled').length;
    res.json({ success: true, sent, total: tokens.length });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─── POST /api/notifications/send-course-completion ──────────────────────────
router.post('/send-course-completion', auth, async (req, res) => {
  try {
    const tokens = await db.getFcmTokens(req.uid);
    if (!tokens.length) return res.status(400).json({ message: 'No FCM token registered' });

    const results = await Promise.allSettled(
      tokens.map(token => fcm.sendCourseCompletionNotification(token, req.body))
    );
    const sent = results.filter(r => r.status === 'fulfilled').length;
    res.json({ success: true, sent, total: tokens.length });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─── POST /api/notifications/send-progress ────────────────────────────────────
router.post('/send-progress', auth, async (req, res) => {
  try {
    const tokens = await db.getFcmTokens(req.uid);
    if (!tokens.length) return res.status(400).json({ message: 'No FCM token registered' });

    const results = await Promise.allSettled(
      tokens.map(token => fcm.sendLearningProgressNotification(token, req.body))
    );
    const sent = results.filter(r => r.status === 'fulfilled').length;
    res.json({ success: true, sent, total: tokens.length });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─── POST /api/notifications/send-opportunity-match ──────────────────────────
router.post('/send-opportunity-match', auth, async (req, res) => {
  try {
    const tokens = await db.getFcmTokens(req.uid);
    if (!tokens.length) return res.status(400).json({ message: 'No FCM token registered' });

    const results = await Promise.allSettled(
      tokens.map(token => fcm.sendOpportunityMatchNotification(token, req.body))
    );
    const sent = results.filter(r => r.status === 'fulfilled').length;
    res.json({ success: true, sent, total: tokens.length });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─── POST /api/notifications/broadcast  (admin only) ─────────────────────────
// Collects FCM tokens from all students in Firestore. Admin-only.
router.post('/broadcast', auth, async (req, res) => {
  try {
    if (req.student.role !== 'admin') return res.status(403).json({ message: 'Admin access required' });

    // Collect all FCM tokens from all students — admin feature only
    const admin   = require('firebase-admin');
    const snapshot = await admin.firestore().collection('students').where('fcmTokens', '!=', []).get();
    const allTokens = snapshot.docs.flatMap(d => d.data().fcmTokens || []);

    if (!allTokens.length) return res.json({ success: true, sent: 0, message: 'No registered tokens' });

    const result = await fcm.sendSystemAnnouncement(allTokens, req.body);
    res.json({ success: true, ...result, total: allTokens.length });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
