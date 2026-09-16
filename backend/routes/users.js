/**
 * SkillBridge – User Routes
 * All data is scoped to the authenticated student: users/{UID}
 *
 * GET  /api/users/profile
 * PUT  /api/users/profile
 * POST /api/users/skills
 * GET  /api/users/dashboard-stats
 */

'use strict';

const express = require('express');
const router  = express.Router();
const auth    = require('../middleware/auth');
const db      = require('../services/firestoreService');
const calc    = require('../services/calculationService');
const { FieldValue } = require('firebase-admin/firestore');

// ─── GET /api/users/profile ───────────────────────────────────────────────────
router.get('/profile', auth, async (req, res) => {
  try {
    const student = await db.getStudent(req.uid);
    res.json({ success: true, user: student });
  } catch (err) {
    res.status(500).json({ message: 'Failed to get profile', error: err.message });
  }
});

// ─── PUT /api/users/profile ───────────────────────────────────────────────────
router.put('/profile', auth, async (req, res) => {
  try {
    const allowed = [
      'name', 'email', 'branch', 'academicYear', 'college', 'cgpa',
      'skills', 'phone', 'mobile', 'language', 'location', 'preferredLocation',
      'linkedinUrl', 'githubUrl', 'bio', 'interests', 'careerGoal',
      'projects', 'certifications', 'experience', 'internships', 'achievements', 'preferences',
    ];

    const updates = { updatedAt: FieldValue.serverTimestamp() };
    allowed.forEach(field => {
      if (req.body[field] !== undefined) updates[field] = req.body[field];
    });
    if (!String(updates.name || '').trim()) {
      return res.status(400).json({ message: 'Name is required.' });
    }
    if (updates.skills !== undefined && !Array.isArray(updates.skills)) {
      return res.status(400).json({ message: 'Skills must be a list.' });
    }

    await db.updateStudent(req.uid, updates);
    const student = await db.getStudent(req.uid);
    res.json({ success: true, user: student });
  } catch (err) {
    res.status(500).json({ message: 'Profile update failed', error: err.message });
  }
});

// ─── POST /api/users/skills ───────────────────────────────────────────────────
router.post('/skills', auth, async (req, res) => {
  try {
    const { skills } = req.body;
    if (!Array.isArray(skills)) return res.status(400).json({ message: 'skills must be an array' });

    await db.updateStudent(req.uid, {
      skills,
      updatedAt: FieldValue.serverTimestamp(),
    });

    res.json({ success: true, skills });
  } catch (err) {
    res.status(500).json({ message: 'Skills update failed', error: err.message });
  }
});

// ─── GET /api/users/dashboard-stats ──────────────────────────────────────────
router.get('/dashboard-stats', auth, async (req, res) => {
  try {
    const student = await db.getStudent(req.uid);
    const stats = {
      skillsCount:   (student.skills || []).length,
      resumeScore:   student.aiAnalysis?.resumeScore || 0,
      skillMatch:    student.aiAnalysis?.skillMatchPercentage || 0,
      projectsCount: (student.projects || []).length,
      certsCount:    (student.certifications || []).length,
      topCareer:     student.aiAnalysis?.recommendedCareers?.[0] || 'Not analyzed yet',
      profileCompletion: calc.calculateProfileCompletion(student),
    };
    res.json({ success: true, stats });
  } catch (err) {
    res.status(500).json({ message: 'Failed to get stats', error: err.message });
  }
});

module.exports = router;
