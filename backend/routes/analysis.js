/**
 * SkillBridge – Analysis Routes
 *
 * All student data loaded from users/{UID}.
 * Reference data (careers, skills) loaded from Firestore collections.
 * All numerical scores computed by calculationService.
 *
 * POST /api/analysis/run
 * GET  /api/analysis/results
 * GET  /api/analysis/profile-completion
 * GET  /api/analysis/career-progress
 * GET  /api/analysis/roadmap
 * POST /api/analysis/roadmap-progress
 * GET  /api/analysis/skill-gap
 * POST /api/analysis/ats-improvement
 */

'use strict';

const express = require('express');
const router  = express.Router();
const { FieldValue } = require('firebase-admin/firestore');
const auth    = require('../middleware/auth');
const db      = require('../services/firestoreService');
const calc    = require('../services/calculationService');
const careerSkills = require('../services/careerSkillsService');
const crypto = require('crypto');

function fingerprintAnalysisStudent(student, canonical) {
  const skills = [...(Array.isArray(student?.skills) ? student.skills : []), ...(Array.isArray(canonical?.userSkills) ? canonical.userSkills : [])]
    .map(s => String(s).trim())
    .filter(Boolean);
  const payload = JSON.stringify({
    careerGoal: student?.careerGoal || '',
    normalizedCareerGoal: canonical?.normalizedCareerGoal || student?.normalizedCareerGoal || '',
    skills: [...new Set(skills.map(s => s.toLowerCase()))].sort(),
    requiredSkills: [...new Set((canonical?.requiredSkills || []).map(s => String(s).trim().toLowerCase()))].sort(),
    missingSkills: [...new Set((canonical?.missingSkills || []).map(s => String(s).trim().toLowerCase()))].sort(),
    resumeUrl: student?.resumeUrl || '',
    branch: student?.branch || '',
    cgpa: student?.cgpa || 0,
    projects: (student?.projects || []).length,
    certifications: (student?.certifications || []).length,
    experience: (student?.experience || []).length,
  });
  return crypto.createHash('sha256').update(payload).digest('hex');
}

// ─── Helper: build career progress components ─────────────────────────────────
function buildCareerProgressComponents(student) {
  const skills  = student.skills        || [];
  const projects = student.projects     || [];
  const certs   = student.certifications || [];
  const exp     = student.experience    || [];

  const roadmapTopics   = student.roadmapTopics || [];
  const completedTopics = student.roadmapCompletedTopics || 0;
  const totalTopics     = roadmapTopics.length;
  const roadmapCompletionPct = calc.calculateLearningRoadmapProgress(completedTopics, totalTopics);

  const skillsAcquiredPct      = calc.clampPercentage((skills.length / 10) * 100);
  const projectsCompletedPct   = calc.clampPercentage((projects.length / 3) * 100);
  const certificationsEarnedPct = calc.clampPercentage((certs.length / 3) * 100);

  const savedCount = ((student.savedJobs || []).length + (student.savedInternships || []).length);
  const applicationsSubmittedPct = calc.clampPercentage((savedCount / 10) * 100);

  return { roadmapCompletionPct, skillsAcquiredPct, projectsCompletedPct, certificationsEarnedPct, applicationsSubmittedPct };
}

// ─── Helper: lightweight resume score from profile (no AI) ───────────────────
function buildResumeScoreFromProfile(student) {
  return calc.estimateResumeScoreFromProfile(student);
}

function buildStrengths(student, skills) {
  const s = [];
  if (skills.length >= 5) s.push('Strong technical skill base');
  if ((student.projects?.length || 0) >= 2) s.push('Good project portfolio');
  if ((student.certifications?.length || 0) >= 1) s.push('Certified learner');
  if ((student.cgpa || 0) >= 7.5) s.push('Excellent academic performance');
  const sl = skills.map(x => x.toLowerCase());
  if (sl.some(x => ['python','machine learning','deep learning'].includes(x))) s.push('AI/ML expertise');
  if (sl.some(x => ['react','node.js','javascript'].includes(x))) s.push('Modern web development skills');
  if (s.length === 0) s.push('Getting started — add more skills and projects!');
  return s;
}

function buildImprovements(student, missingSkills) {
  const i = [];
  if (missingSkills.length > 0) i.push(`Learn: ${missingSkills.slice(0, 3).join(', ')}`);
  if (!student.projects?.length) i.push('Add portfolio projects');
  if (!student.certifications?.length) i.push('Earn free certifications');
  if (!student.linkedinUrl) i.push('Build LinkedIn profile');
  if ((student.cgpa || 0) < 7.0) i.push('Focus on improving academic performance');
  return i;
}

// ─── Core analysis engine (uses Firestore careers collection) ─────────────────
async function runCoreAnalysis(student) {
  const canonical = await careerSkills.getCareerSkillResult(student);
  const { userSkills, requiredSkills, matchedSkills, missingSkills } = canonical;
  const canonicalStudent = { ...student, skills: userSkills };

  // Load active careers from Firestore careers collection
  const allCareers = await db.getCollection('careers', { isActive: true });

  const careerScores = allCareers.map(career => ({
    title:         career.careerTitle || career.Career_Name || career.careerName || career.name,
    score:         calc.calculateCareerMatch(canonicalStudent, career),
    careerData:    career,
  }));
  careerScores.sort((a, b) => b.score - a.score);
  const topCareers = careerScores.slice(0, 3);

  const { matchPct: skillMatchPercentage } = calc.calculateSkillMatch(userSkills, requiredSkills);
  const profileCompletion = calc.calculateProfileCompletion(student);
  const progressComponents = buildCareerProgressComponents(student);
  const careerProgress = calc.calculateCareerProgress(progressComponents);
  const { gapPct: skillGapPct } = calc.calculateSkillGap(userSkills, requiredSkills);
  const matchDist = calc.calculateMatchDistribution(
    matchedSkills.length,
    requiredSkills.length
  );
  const strengths    = buildStrengths(student, userSkills);
  const improvements = buildImprovements(student, missingSkills);
  const resumeScore  = buildResumeScoreFromProfile(student);
  const atsComponents = calc.estimateATSComponentsFromProfile(student);
  const overallCareerMatch = canonical.matchedCareer
    ? calc.calculateCareerMatch(canonicalStudent, { ...canonical.matchedCareer, requiredSkills })
    : 0;

  return {
    resumeScore,
    atsComponents,
    skillMatchPercentage,
    skillGapPct,
    profileCompletion,
    careerProgress,
    overallCareerMatch,
    missingSkills,
    careerGoal: canonical.careerGoal,
    matchedCareer: canonical.matchedCareer,
    userSkills,
    matchedSkills,
    missingSkills,
    requiredSkills,
    normalizedCareerGoal: canonical.matchedCareer?.Career_Name || '',
    recommendedCareers: topCareers.map(c => c.title),
    topCareers: topCareers.map(c => ({
      title:         c.title,
      score:         c.score,
      matchedSkills: c.matchedSkills,
      missingSkills: c.missingSkills,
    })),
    matchDistribution:  matchDist,
    progressComponents,
    strengths,
    improvements,
    lastAnalyzed: new Date(),
  };
}

// ─── POST /api/analysis/run ───────────────────────────────────────────────────
router.post('/run', auth, async (req, res) => {
  try {
    const student = await db.getStudent(req.uid);
    if (!student.skills || student.skills.length === 0) {
      return res.status(400).json({ message: 'Please add skills before running analysis.' });
    }

    const canonical = await careerSkills.getCareerSkillResult(student);
    const fingerprint = fingerprintAnalysisStudent(student, canonical);
    const cached = (student.aiAnalysis && student.aiAnalysis.analysisFingerprint === fingerprint) ? student.aiAnalysis : null;
    if (cached && cached.resumeScore) {
      console.log('[AI CACHE HIT] analysis result reused from Firestore.');
      return res.json({ success: true, analysis: cached, provider: 'cached' });
    }

    const analysis = await runCoreAnalysis(student);
    const saved = { ...analysis, analysisFingerprint: fingerprint };

    await db.saveAiAnalysis(req.uid, {
      resumeScore:          saved.resumeScore,
      atsComponents:        saved.atsComponents,
      skillMatchPercentage: saved.skillMatchPercentage,
      profileCompletion:    saved.profileCompletion,
      careerProgress:       saved.careerProgress,
      skillGapPct:          saved.skillGapPct,
      missingSkills:        saved.missingSkills,
      recommendedCareers:   saved.recommendedCareers,
      topCareers:           saved.topCareers,
      matchDistribution:    saved.matchDistribution,
      progressComponents:   saved.progressComponents,
      careerGoal:           saved.careerGoal,
      matchedCareer:        saved.matchedCareer,
      userSkills:           saved.userSkills,
      matchedSkills:        saved.matchedSkills,
      requiredSkills:       saved.requiredSkills || [],
      normalizedCareerGoal: saved.normalizedCareerGoal || '',
      strengths:            saved.strengths,
      improvements:         saved.improvements,
      analysisFingerprint:  fingerprint,
      lastAnalyzed:         saved.lastAnalyzed,
    });

    console.log('[AI CACHE MISS] analysis regenerated and saved to Firestore.');
    res.json({ success: true, analysis: saved, provider: 'firestore+calc' });
  } catch (err) {
    console.error('[analysis/run]', err.message);
    res.status(500).json({ message: 'Analysis failed', error: err.message });
  }
});

// ─── GET /api/analysis/results ────────────────────────────────────────────────
router.get('/results', auth, async (req, res) => {
  try {
    const student = await db.getStudent(req.uid);
    const canonical = await careerSkills.getCareerSkillResult(student);
    const fingerprint = fingerprintAnalysisStudent(student, canonical);
    const base = student.aiAnalysis || {};
    const canonicalStudent = { ...student, skills: canonical.userSkills };
    const progressComponents = buildCareerProgressComponents(student);
    const atsComponents = {
      ...(base.atsComponents || calc.estimateATSComponentsFromProfile(student)),
      experienceScore: calc.calculateExperienceScore(
        student.experience,
        student.careerGoal || student.normalizedCareerGoal
      ),
    };
    const analysis = {
      ...base,
      ...canonical,
      atsComponents,
      resumeScore: calc.calculateResumeScore(atsComponents),
      skillMatchPercentage: calc.calculateSkillMatch(canonical.userSkills, canonical.requiredSkills).matchPct,
      skillGapPct: calc.calculateSkillGap(canonical.userSkills, canonical.requiredSkills).gapPct,
      profileCompletion: calc.calculateProfileCompletion(student),
      careerProgress: calc.calculateCareerProgress(progressComponents),
      progressComponents,
      overallCareerMatch: canonical.matchedCareer
        ? calc.calculateCareerMatch(canonicalStudent, { ...canonical.matchedCareer, requiredSkills: canonical.requiredSkills })
        : 0,
      analysisFingerprint: fingerprint,
    };
    if (base?.resumeScore && base.analysisFingerprint === fingerprint) {
      console.log('[AI CACHE HIT] /analysis/results served cached analysis without re-generation.');
    }
    res.json({ success: true, analysis, skills: canonical.userSkills, provider: base?.analysisFingerprint === fingerprint ? 'cached' : 'firestore+calc' });
  } catch (err) {
    res.status(500).json({ message: 'Failed to get analysis', error: err.message });
  }
});

router.get('/career-skills', auth, async (req, res) => {
  try {
    const student = await db.getStudent(req.uid);
    res.json({ success: true, ...await careerSkills.getCareerSkillResult(student) });
  } catch (err) {
    res.status(500).json({ message: 'Failed to get career skills', error: err.message });
  }
});

// ─── GET /api/analysis/profile-completion ─────────────────────────────────────
router.get('/profile-completion', auth, async (req, res) => {
  try {
    const student = await db.getStudent(req.uid);
    const profileCompletion = calc.calculateProfileCompletion(student);
    res.json({ success: true, profileCompletion });
  } catch (err) {
    res.status(500).json({ message: 'Failed', error: err.message });
  }
});

// ─── GET /api/analysis/career-progress ───────────────────────────────────────
router.get('/career-progress', auth, async (req, res) => {
  try {
    const student    = await db.getStudent(req.uid);
    const components = buildCareerProgressComponents(student);
    const careerProgress = calc.calculateCareerProgress(components);
    res.json({ success: true, careerProgress, components });
  } catch (err) {
    res.status(500).json({ message: 'Failed', error: err.message });
  }
});

// ─── GET /api/analysis/roadmap ────────────────────────────────────────────────
router.get('/roadmap', auth, async (req, res) => {
  try {
    const student     = await db.getStudent(req.uid);
    const canonical = await careerSkills.getCareerSkillResult(student);
    const { userSkills, requiredSkills } = canonical;
    const targetCareer = canonical.matchedCareer?.Career_Name || canonical.careerGoal;

    const phases = [
      {
        phase: 1, title: 'Foundation', duration: '1-2 months',
        skills: requiredSkills.slice(0, 3),
        status: requiredSkills.length && requiredSkills.slice(0, 3).every(s => userSkills.some(userSkill => calc.skillsRelated(userSkill, s))) ? 'completed' : 'pending',
      },
      {
        phase: 2, title: 'Core Skills', duration: '2-3 months',
        skills: requiredSkills.slice(3),
        status: 'pending',
      },
      {
        phase: 3, title: 'Advanced & Projects', duration: '1-2 months',
        skills: [],
        status: 'pending',
      },
      {
        phase: 4, title: 'Job Preparation', duration: '1 month',
        skills: ['Portfolio', 'LeetCode', 'Mock Interviews', 'Resume Polish'],
        status: 'pending',
      },
    ];

    const totalTopics     = student.roadmapTopics?.length || 0;
    const completedTopics = student.roadmapCompletedTopics || 0;
    const completionPct   = calc.calculateLearningRoadmapProgress(completedTopics, totalTopics);

    res.json({ success: true, roadmap: { targetCareer, phases, completionPct, completedTopics, totalTopics } });
  } catch (err) {
    res.status(500).json({ message: 'Failed to get roadmap', error: err.message });
  }
});

// ─── POST /api/analysis/roadmap-progress ──────────────────────────────────────
router.post('/roadmap-progress', auth, async (req, res) => {
  try {
    const { completedTopics, totalTopics } = req.body;
    const student = await db.getStudent(req.uid);
    const actualTotalTopics = student.roadmapTopics?.length || Number(totalTopics) || 0;
    const safeCompletedTopics = Math.max(0, Math.min(Number(completedTopics) || 0, actualTotalTopics));
    const completionPct = calc.calculateLearningRoadmapProgress(safeCompletedTopics, actualTotalTopics);
    await db.updateStudent(req.uid, {
      roadmapCompletedTopics: safeCompletedTopics,
      updatedAt: FieldValue.serverTimestamp(),
    });
    await db.saveAiAnalysis(req.uid, { roadmapCompletionPct: completionPct });
    res.json({ success: true, completionPct, completedTopics: safeCompletedTopics, totalTopics: actualTotalTopics });
  } catch (err) {
    res.status(500).json({ message: 'Failed', error: err.message });
  }
});

// ─── GET /api/analysis/skill-gap ─────────────────────────────────────────────
router.get('/skill-gap', auth, async (req, res) => {
  try {
    const student    = await db.getStudent(req.uid);
    const canonical = await careerSkills.getCareerSkillResult(student);
    const { careerGoal, matchedCareer, userSkills, requiredSkills, matchedSkills, missingSkills } = canonical;

    const { gapPct, matchPct } = calc.calculateSkillGap(userSkills, requiredSkills);
    const { matchedPct, missingPct } = calc.calculateMatchDistribution(matchedSkills.length, requiredSkills.length);

    // Category breakdown from Firestore skills collection
    const skillsByCategory = {};
    const allDbSkills = await db.getCollection('skills', { isActive: true });
    allDbSkills.filter(skill => skill.Career_Name === matchedCareer?.Career_Name).forEach(skill => {
      const cat = skill.Skill_Category || 'Other';
      if (!skillsByCategory[cat]) skillsByCategory[cat] = { required: [] };
      skillsByCategory[cat].required.push(skill.Skill_Name);
    });
    const gapBreakdown = calc.calculateSkillGapBreakdown(userSkills, skillsByCategory);

    res.json({ success: true, careerGoal, matchedCareer, gapPct, matchPct, matchedPct, missingPct, matchedSkills, missingSkills, requiredSkills, gapBreakdown, userSkills });
  } catch (err) {
    res.status(500).json({ message: 'Failed to get skill gap', error: err.message });
  }
});

// ─── POST /api/analysis/ats-improvement ──────────────────────────────────────
router.post('/ats-improvement', auth, async (req, res) => {
  try {
    const { originalScore, improvedScore } = req.body;
    const result = calc.calculateATSImprovement(Number(originalScore) || 0, Number(improvedScore) || 0);
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ message: 'Failed', error: err.message });
  }
});

module.exports = router;
