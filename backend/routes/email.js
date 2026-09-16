/**
 * SkillBridge – Email Routes (Resend)
 *
 * Student data loaded from users/{UID}.
 * No MongoDB. All user lookups use Firebase Auth UID.
 *
 * POST /api/email/send-otp
 * POST /api/email/verify-otp
 * POST /api/email/send-deadline-reminder
 * POST /api/email/send-interview
 * POST /api/email/send-job-alert
 * POST /api/email/forgot-password  (email-based lookup — does not expose other student data)
 * POST /api/email/welcome
 */

'use strict';

const express = require('express');
const router  = express.Router();
const admin   = require('firebase-admin');
const auth    = require('../middleware/auth');
const db      = require('../services/firestoreService');
const email   = require('../services/emailService');

// In-memory OTP store (use Redis in production)
const otpStore = new Map();

function generateOTP() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

// ─── POST /api/email/send-otp ─────────────────────────────────────────────────
router.post('/send-otp', async (req, res) => {
  try {
    const { emailAddress, purpose = 'verification', name = 'Student' } = req.body;
    if (!emailAddress) return res.status(400).json({ message: 'emailAddress is required' });

    const existing = otpStore.get(emailAddress);
    if (existing && existing.attempts >= 3 && Date.now() < existing.expires) {
      return res.status(429).json({ message: 'Too many OTP requests. Try again in 10 minutes.' });
    }

    const otp     = generateOTP();
    const expires = Date.now() + 10 * 60 * 1000;
    otpStore.set(emailAddress, { otp, expires, attempts: (existing?.attempts || 0) + 1, verified: false });

    await email.sendOTP(emailAddress, { name, otp, purpose, expiresInMinutes: 10 });
    res.json({ success: true, message: `OTP sent to ${emailAddress}` });
  } catch (err) {
    console.error('[Email/send-otp]', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─── POST /api/email/verify-otp ───────────────────────────────────────────────
router.post('/verify-otp', async (req, res) => {
  try {
    const { emailAddress, otp } = req.body;
    if (!emailAddress || !otp) return res.status(400).json({ message: 'emailAddress and otp are required' });

    const record = otpStore.get(emailAddress);
    if (!record) return res.status(400).json({ success: false, message: 'No OTP found. Request a new one.' });
    if (Date.now() > record.expires) {
      otpStore.delete(emailAddress);
      return res.status(400).json({ success: false, message: 'OTP expired. Request a new one.' });
    }
    if (record.otp !== String(otp)) {
      return res.status(400).json({ success: false, message: 'Invalid OTP.' });
    }

    record.verified = true;
    otpStore.set(emailAddress, record);
    setTimeout(() => otpStore.delete(emailAddress), 5 * 60 * 1000);

    res.json({ success: true, message: 'OTP verified successfully' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─── POST /api/email/send-deadline-reminder ───────────────────────────────────
router.post('/send-deadline-reminder', auth, async (req, res) => {
  try {
    const student = await db.getStudent(req.uid);
    const { deadlines } = req.body;
    if (!deadlines?.length) return res.status(400).json({ message: 'deadlines array is required' });

    await email.sendDeadlineReminder(student.email, { name: student.name, deadlines });
    res.json({ success: true, message: `Deadline reminder sent to ${student.email}` });
  } catch (err) {
    console.error('[Email/deadline]', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─── POST /api/email/send-interview ──────────────────────────────────────────
router.post('/send-interview', auth, async (req, res) => {
  try {
    const student = await db.getStudent(req.uid);
    await email.sendInterviewNotification(student.email, { name: student.name, ...req.body });
    res.json({ success: true, message: `Interview notification sent to ${student.email}` });
  } catch (err) {
    console.error('[Email/interview]', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─── POST /api/email/send-job-alert ───────────────────────────────────────────
router.post('/send-job-alert', auth, async (req, res) => {
  try {
    const student = await db.getStudent(req.uid);
    const { opportunities } = req.body;
    if (!opportunities?.length) return res.status(400).json({ message: 'opportunities array is required' });

    await email.sendJobAlert(student.email, { name: student.name, opportunities });
    res.json({ success: true, message: `Job alert sent to ${student.email}` });
  } catch (err) {
    console.error('[Email/job-alert]', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─── POST /api/email/forgot-password ─────────────────────────────────────────
// Uses Firebase Auth to look up the email — never exposes another student's data.
router.post('/forgot-password', async (req, res) => {
  try {
    const { emailAddress } = req.body;
    if (!emailAddress) return res.status(400).json({ message: 'emailAddress is required' });

    let userName = 'Student';
    try {
      const firebaseUser = await admin.auth().getUserByEmail(emailAddress.toLowerCase());
      userName = firebaseUser.displayName || 'Student';
    } catch {
      // Always return success to prevent email enumeration
    }

    const token     = require('crypto').randomBytes(32).toString('hex');
    const resetLink = `http://localhost:5000/reset-password.html?token=${token}&email=${emailAddress}`;

    await email.sendPasswordReset(emailAddress, { name: userName, resetLink, expiresInMinutes: 30 });
    res.json({ success: true, message: 'If that email exists, a reset link was sent.' });
  } catch (err) {
    console.error('[Email/forgot-password]', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─── POST /api/email/welcome ──────────────────────────────────────────────────
router.post('/welcome', auth, async (req, res) => {
  try {
    const student = await db.getStudent(req.uid);
    await email.sendWelcomeEmail(student.email, { name: student.name, branch: student.branch, careerGoal: student.careerGoal });
    res.json({ success: true, message: `Welcome email sent to ${student.email}` });
  } catch (err) {
    console.error('[Email/welcome]', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
