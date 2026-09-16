/**
 * SkillBridge – Opportunities Routes
 *
 * Reads from Firestore reference collections only:
 *   jobs, internships, placements, competitions, freeCertificates, careers
 *
 * Student data loaded from users/{UID} for skill-match scoring.
 * No MongoDB. No cross-student data access.
 *
 * GET /api/opportunities/jobs
 * GET /api/opportunities/internships
 * GET /api/opportunities/placements
 * GET /api/opportunities/competitions
 * GET /api/opportunities/freeCertificates
 * GET /api/opportunities/recommendations
 * GET /api/opportunities/careers
 */

'use strict';

const express = require('express');
const router  = express.Router();
const auth    = require('../middleware/auth');
const db      = require('../services/firestoreService');
const calc    = require('../services/calculationService');
const careerSkills = require('../services/careerSkillsService');

function requiredSkillsFor(opportunity) {
  const skills = opportunity.Required_Skills || opportunity.requiredSkills || opportunity.required_skills || opportunity.Skills_Covered || opportunity.skillsCovered || opportunity.skills || [];
  return (Array.isArray(skills) ? skills : [skills]).map(skill =>
    typeof skill === 'object' ? (skill.skillName || skill.name || skill.title || '') : skill
  ).filter(Boolean);
}

function normalizeOpportunity(opportunity, type) {
  const requiredSkills = requiredSkillsFor(opportunity);
  const isCertification = type === 'certifications' || type === 'freeCertificates';
  const title = type === 'jobs'
    ? opportunity.Title || opportunity.title || opportunity.name || opportunity.role
    : type === 'internships'
      ? opportunity.Internship_Title || opportunity.internshipTitle || opportunity.Title || opportunity.title
      : type === 'placements'
        ? opportunity.Placement_Role || opportunity.placementRole || opportunity.Title || opportunity.title
        : type === 'competitions'
          ? opportunity.Competition_Name || opportunity.competitionName || opportunity.Title || opportunity.title
          : isCertification
            ? opportunity.Certification_Name || opportunity.certificationName || opportunity.Title || opportunity.title
            : opportunity.title || opportunity.name || opportunity.role || opportunity.position;
  const company = type === 'jobs'
    ? opportunity.Organization || opportunity.organization || opportunity.Company_Name || opportunity.company
    : type === 'internships'
      ? opportunity.Organization || opportunity.Organization_Name || opportunity.Company_Name || opportunity.company
      : type === 'placements'
        ? opportunity.Company_Name || opportunity.companyName || opportunity.company
        : type === 'competitions'
          ? opportunity.Organizer || opportunity.organizer
          : isCertification
            ? opportunity.Provider || opportunity.provider
            : opportunity.company || opportunity.organization || opportunity.organizer || opportunity.provider;
  const id = type === 'jobs'
    ? opportunity.Job_ID || opportunity.jobId
    : type === 'internships'
      ? opportunity.Internship_ID || opportunity.internshipId
      : type === 'placements'
        ? opportunity.Placement_ID || opportunity.placementId
        : type === 'competitions'
          ? opportunity.Competition_ID || opportunity.competitionId
          : isCertification
            ? opportunity.Certification_ID || opportunity.certificationId
            : opportunity.id || opportunity.opportunityId || opportunity.Opportunity_ID;
  return {
    ...opportunity,
    id: id || opportunity.title || opportunity.name || title || 'Opportunity',
    title: title || opportunity.careerTitle || 'Opportunity',
    company: company || '',
    description: opportunity.description || opportunity.details || opportunity.summary || '',
    location: opportunity.Location || opportunity.location || opportunity.city || opportunity.Platform || opportunity.platform || opportunity.Mode || opportunity.mode || '',
    deadline: opportunity.Deadline || opportunity.deadline || opportunity.applyBy || opportunity.registrationDeadline || opportunity.endDate || '',
    requiredSkills,
    type,
  };
}

function normalizeDeadline(opportunity) {
  const value = opportunity.Deadline || opportunity.deadline || opportunity.applyBy || opportunity.registrationDeadline || opportunity.endDate;
  if (value === undefined || value === null || value === '') return null;

  let date;
  if (value && typeof value.toDate === 'function') date = value.toDate();
  else if (value && typeof value === 'object' && Number.isFinite(value.seconds)) date = new Date(value.seconds * 1000);
  else if (typeof value === 'string') {
    const candidate = value.trim();
    if (!candidate) return null;
    const isoMatch = candidate.match(/^\d{4}-\d{2}-\d{2}$/);
    // Dataset format is DD-MM-YYYY (e.g. "31-08-2026"), which the native
    // Date constructor cannot parse (it returns Invalid Date). Handle it
    // explicitly before falling back to the generic parser.
    const dmyMatch = candidate.match(/^(\d{2})-(\d{2})-(\d{4})$/);
    if (isoMatch) {
      date = new Date(`${candidate}T00:00:00`);
    } else if (dmyMatch) {
      const [, day, month, year] = dmyMatch;
      date = new Date(`${year}-${month}-${day}T00:00:00`);
    } else {
      date = new Date(candidate);
    }
  } else {
    date = new Date(value);
  }

  if (Number.isNaN(date.getTime())) return null;

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function getDaysRemaining(deadlineDate) {
  if (!deadlineDate) return null;
  const deadline = new Date(`${deadlineDate}T00:00:00`);
  if (Number.isNaN(deadline.getTime())) return null;
  const today = new Date();
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const diffMs = deadline.getTime() - startOfToday.getTime();
  return Math.ceil(diffMs / (1000 * 60 * 60 * 24));
}

function getPriorityFromDays(daysRemaining) {
  if (daysRemaining >= 1 && daysRemaining <= 21) return 'high';
  if (daysRemaining >= 22 && daysRemaining <= 42) return 'medium';
  if (daysRemaining >= 43 && daysRemaining <= 63) return 'low';
  return null;
}

// NOTE: This mirrors filterPersonalizedOpportunities() in frontend/opportunities2.html
// EXACTLY, so that "Upcoming Deadlines" always matches what the student sees under
// "Top Matches For You" on the Opportunities page. Do not diverge the two again.
function isRelevantStudentOpportunity(student, opportunity, type, matchedCareerName) {
  const normalizedStudentSkills = (student.skills || []).map(skill => recommendationText(typeof skill === 'object' ? (skill.skillName || skill.name || skill.skill || skill.title || '') : skill));

  if (type === 'jobs' || type === 'internships' || type === 'freeCertificates') {
    const normalizedCareer = recommendationText(matchedCareerName);
    if (!normalizedCareer) return false;
    const opportunityCareerName = opportunity.Career_Name || opportunity.careerName || opportunity.Career || opportunity.career || '';
    return recommendationText(opportunityCareerName) === normalizedCareer;
  }

  if (type === 'placements' || type === 'competitions') {
    const branchOk = branchMatches(student.branch, opportunityEligibleBranches(opportunity));
    const requiredSkills = opportunityRequiredSkills(opportunity);
    const matchingSkills = requiredSkills.filter(requiredSkill => normalizedStudentSkills.some(studentSkill => skillRelated(studentSkill, recommendationText(requiredSkill))));
    return branchOk && matchingSkills.length > 0;
  }

  return false;
}

function recommendationText(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ');
}

function opportunityRequiredSkills(opportunity) {
  const value = opportunity.Required_Skills ?? opportunity.requiredSkills ?? opportunity.Skills_Covered ?? opportunity.skillsCovered ?? opportunity.skills ?? '';
  const values = Array.isArray(value) ? value : String(value).split(',');
  return values.flatMap(item => {
    if (item && typeof item === 'object') return [item.skillName || item.name || item.skill || item.title || ''];
    return [item];
  }).map(skill => String(skill || '').trim()).filter(Boolean);
}

function opportunityEligibleBranches(opportunity) {
  const value = opportunity.Eligible_Branch ?? opportunity.Eligible_Branchs ??
    opportunity.Eligible_Branches ?? opportunity.eligibleBranch ??
    opportunity.eligibleBranches ?? opportunity.Branch ?? opportunity.branch ?? '';
  const values = Array.isArray(value) ? value : String(value).split(/[,/|]/);
  return values.map(branch => recommendationText(branch)).filter(Boolean);
}

function branchMatches(studentBranch, eligibleBranches) {
  const branch = recommendationText(studentBranch);
  if (!branch || !eligibleBranches.length) return false;
  return eligibleBranches.some(eligible =>
    eligible === 'all' || eligible.includes('all branch') ||
    eligible === branch || eligible.includes(branch) || branch.includes(eligible)
  );
}

function hasMatchingUserSkill(studentSkills, requiredSkills) {
  return (Array.isArray(studentSkills) ? studentSkills : []).some(studentSkill =>
    requiredSkills.some(requiredSkill => skillRelated(
      typeof studentSkill === 'object'
        ? (studentSkill.skillName || studentSkill.name || studentSkill.skill || studentSkill.title || '')
        : studentSkill,
      requiredSkill
    ))
  );
}

function skillRelated(left, right) {
  const normalizedLeft = recommendationText(left);
  const normalizedRight = recommendationText(right);
  return !!normalizedLeft && !!normalizedRight && (
    normalizedLeft === normalizedRight ||
    normalizedLeft.includes(normalizedRight) ||
    normalizedRight.includes(normalizedLeft)
  );
}

function studentProfile(student) {
  return {
    name: student.name || '', email: student.email || '', branch: student.branch || '',
    academicYear: student.academicYear || '', college: student.college || '', cgpa: student.cgpa || 0,
    skills: student.skills || [], projects: student.projects || [], certifications: student.certifications || [],
    experience: student.experience || [], careerGoal: student.careerGoal || student.normalizedCareerGoal || '',
    resumeUrl: student.resumeUrl || '',
  };
}

function localOpportunityMatch(student, opportunity, type) {
  const requiredSkills = requiredSkillsFor(opportunity);
  const normalizedCareerGoal = (student.careerGoal || student.normalizedCareerGoal || '').toLowerCase();
  const skillMatch = calc.calculateSkillMatch(student.skills || [], requiredSkills);
  const eligibilityMatch = student.cgpa === undefined || student.cgpa === null || Number(student.cgpa) >= Number(opportunity.minCgpa || 0);
  const careerText = [
    opportunity.title,
    opportunity.name,
    opportunity.role,
    opportunity.description,
    opportunity.domain,
    opportunity.category,
    opportunity.career,
    opportunity.careerGoal,
    opportunity.company,
  ].filter(Boolean).join(' ');
  const careerGoalMatch = !!normalizedCareerGoal && !!careerText && careerText.toLowerCase().includes(normalizedCareerGoal);
  const locationText = (opportunity.location || opportunity.city || opportunity.region || '').toString().toLowerCase();
  const preferredLocation = (student.preferredLocation || student.location || '').toString().toLowerCase();
  const locationRelevance = !locationText ? 100 : (
    !preferredLocation ? 80 : (
      locationText.includes(preferredLocation) || preferredLocation.includes(locationText) ? 100 : 60
    )
  );
  const careerRelevance = careerGoalMatch ? 100 : 70;
  const finalScore = calc.calculateOpportunityMatch({
    studentSkills: student.skills || [],
    requiredSkills,
    careerGoalMatch,
    eligibilityMatch,
    projectRelevance: Math.min(100, Math.round((student.projects || []).length * 20 + (student.certifications || []).length * 10)),
    certRelevance: Math.min(100, (student.certifications || []).length * 25),
    academicRelevance: eligibilityMatch ? 100 : 0,
  });

  return normalizeOpportunity({
    ...opportunity,
    requiredSkills,
    matchScore: finalScore,
    matchedSkills: skillMatch.matchedSkills,
    missingSkills: skillMatch.missingSkills,
    skillMatch: skillMatch.matchPct,
    eligibility: eligibilityMatch,
    eligibilityMatch,
    careerGoalMatch,
    careerRelevance,
    locationRelevance,
    matchComponents: {
      careerGoalMatch,
      eligibilityMatch,
      skillMatch: skillMatch.matchPct,
      locationRelevance,
      careerRelevance,
    },
    reasons: skillMatch.matchedSkills.length
      ? [`${skillMatch.matchedSkills.slice(0, 3).join(', ')} match your current skills.`]
      : ['This opportunity is relevant to your target career profile.'],
    whyThis: careerGoalMatch ? 'This opportunity aligns with your chosen career path and your current skill profile.' : 'This opportunity is a strong fit based on your existing technical strengths and profile.',
  }, type);
}

async function personalize(opportunities, student, type) {
  if (!opportunities.length) return [];
  return opportunities
    .map(opportunity => localOpportunityMatch(student, opportunity, type))
    .sort((a, b) => (b.matchScore || 0) - (a.matchScore || 0));
}

// ─── Helper: basic skill match score ─────────────────────────────────────────
function calcSkillMatch(userSkills, requiredSkills) {
  if (!requiredSkills || requiredSkills.length === 0) return 0;
  return calc.calculateSkillMatch(userSkills, requiredSkills).matchPct;
}

// ─── Helper: apply text search filter client-side (Firestore lacks regex) ─────
function textMatches(doc, fields, search) {
  if (!search) return true;
  const lower = search.toLowerCase();
  return fields.some(f => (doc[f] || '').toLowerCase().includes(lower));
}

// ─── GET /api/opportunities/jobs ──────────────────────────────────────────────
router.get('/jobs', auth, async (req, res) => {
  try {
    const { domain, search } = req.query;
    const student = req.student;

    const filters = { isActive: true };
    if (domain) filters.domain = domain;

    let jobs = await db.getCollection('jobs', filters);

    if (search) {
      jobs = jobs.filter(j => textMatches(j, ['title', 'company'], search));
    }

    const scored = (await personalize(jobs, student, 'jobs')).map(j => ({
      ...j, eligible: (student.cgpa || 0) >= (j.minCgpa || 0),
    })).sort((a, b) => b.matchScore - a.matchScore);

    res.json({ success: true, jobs: scored, total: scored.length });
  } catch (err) {
    res.status(500).json({ message: 'Failed to get jobs', error: err.message });
  }
});

// ─── GET /api/opportunities/internships ───────────────────────────────────────
router.get('/internships', auth, async (req, res) => {
  try {
    const { domain, search } = req.query;
    const student = req.student;

    const filters = { isActive: true };
    if (domain) filters.domain = domain;

    let internships = await db.getCollection('internships', filters);

    if (search) {
      internships = internships.filter(i => textMatches(i, ['title', 'company'], search));
    }

    const scored = (await personalize(internships, student, 'internships')).sort((a, b) => b.matchScore - a.matchScore);

    res.json({ success: true, internships: scored });
  } catch (err) {
    res.status(500).json({ message: 'Failed to get internships', error: err.message });
  }
});

// ─── GET /api/opportunities/placements ────────────────────────────────────────
router.get('/placements', auth, async (req, res) => {
  try {
    const student    = req.student;
    const placements = await db.getCollection('placements', { isActive: true });

    const matchingPlacements = placements.filter(placement =>
      branchMatches(student.branch, opportunityEligibleBranches(placement)) &&
      hasMatchingUserSkill(student.skills, opportunityRequiredSkills(placement))
    );
    const scored = (await personalize(matchingPlacements, student, 'placements')).map(p => ({
      ...p, eligible: (student.cgpa || 0) >= (p.minCgpa || 0),
    })).sort((a, b) => b.matchScore - a.matchScore);

    res.json({ success: true, placements: scored });
  } catch (err) {
    res.status(500).json({ message: 'Failed to get placements', error: err.message });
  }
});

// ─── GET /api/opportunities/competitions ──────────────────────────────────────
router.get('/competitions', auth, async (req, res) => {
  try {
    const student      = req.student;
    const competitions = await db.getCollection('competitions', { isActive: true });

    const matchingCompetitions = competitions.filter(competition =>
      branchMatches(student.branch, opportunityEligibleBranches(competition)) &&
      hasMatchingUserSkill(student.skills, opportunityRequiredSkills(competition))
    );
    const scored = await personalize(matchingCompetitions, student, 'competitions');

    res.json({ success: true, competitions: scored });
  } catch (err) {
    res.status(500).json({ message: 'Failed to get competitions', error: err.message });
  }
});

// ─── GET /api/opportunities/freeCertificates ─────────────────────────────────
router.get('/freeCertificates', auth, async (req, res) => {
  try {
    const { domain, level } = req.query;
    const student = req.student;

    const filters = { isActive: true };
    if (domain) filters.domain = domain;
    if (level)  filters.level  = level;

    let certs = await db.getCollection('freeCertificates', filters);

    const missingSkills = student.aiAnalysis?.missingSkills || [];

    const scored = (await personalize(certs, student, 'freeCertificates')).map(cert => ({
      ...cert,
      requiredSkills: requiredSkillsFor(cert),
      relevanceScore: cert.matchScore,
    })).sort((a, b) => {
      const aRelevant = a.missingSkills?.some(s => missingSkills.some(m => calc.normalizeSkill ? calc.normalizeSkill(s) === calc.normalizeSkill(m) : s.toLowerCase() === m.toLowerCase()));
      const bRelevant = b.missingSkills?.some(s => missingSkills.some(m => calc.normalizeSkill ? calc.normalizeSkill(s) === calc.normalizeSkill(m) : s.toLowerCase() === m.toLowerCase()));
      if (aRelevant && !bRelevant) return -1;
      if (!aRelevant && bRelevant) return 1;
      return (b.rating || 0) - (a.rating || 0);
    });

    res.json({ success: true, freeCertificates: scored, total: scored.length });
  } catch (err) {
    console.error('[opportunities/freeCertificates]', err.message);
    res.status(500).json({ message: 'Failed to get free certificates.' });
  }
});

// ─── GET /api/opportunities/deadlines ────────────────────────────────────────
router.get('/deadlines', auth, async (req, res) => {
  try {
    const student = req.student || {};

    // Resolve the student's career the SAME way opportunities2.html does
    // (via /analysis/career-skills -> careerSkillsService), so the deadline
    // list always matches the "Top Matches For You" recommendations.
    let careerSkillResult = null;
    let careerLookupError = null;
    try {
      careerSkillResult = await careerSkills.getCareerSkillResult(student);
    } catch (err) {
      careerLookupError = err.message;
    }
    const matchedCareer = careerSkillResult?.matchedCareer || null;
    const matchedCareerName = matchedCareer
      ? (matchedCareer.Career_Name || matchedCareer.careerName || matchedCareer.careerTitle || matchedCareer.Career || matchedCareer.name || '')
      : '';

    const allCollections = [
      ['jobs', 'jobs'],
      ['internships', 'internships'],
      ['placements', 'placements'],
      ['competitions', 'competitions'],
      ['freeCertificates', 'freeCertificates'],
    ];

    const debugByType = {};

    const results = await Promise.all(allCollections.map(async ([collectionName, responseType]) => {
      const opportunities = await db.getCollection(collectionName, { isActive: true });
      const relevant = opportunities.filter(opportunity => isRelevantStudentOpportunity(student, opportunity, responseType, matchedCareerName));
      const scored = await personalize(relevant, student, responseType);
      const withDeadlineWindow = scored.map(opportunity => {
        const deadline = normalizeDeadline(opportunity);
        const daysRemaining = deadline ? getDaysRemaining(deadline) : null;
        const priority = deadline && daysRemaining !== null ? getPriorityFromDays(daysRemaining) : null;
        if (!deadline || daysRemaining === null || priority === null) return null;
        if (daysRemaining < 1 || daysRemaining > 63) return null;
        return {
          id: String(opportunity.id || opportunity.opportunityId || opportunity.title || ''),
          title: opportunity.title || opportunity.name || 'Opportunity',
          company: opportunity.company || opportunity.organization || '',
          type: opportunity.type || responseType,
          deadline,
          daysRemaining,
          priority,
          matchScore: Number(opportunity.matchScore || 0),
          matchedSkills: opportunity.matchedSkills || [],
          missingSkills: opportunity.missingSkills || [],
          careerGoalMatch: Boolean(opportunity.careerGoalMatch),
        };
      }).filter(Boolean);

      // TEMP DEBUG: show why "relevant" items are being dropped by the deadline
      // filter — the raw field value, what normalizeDeadline() parsed it to,
      // and days-remaining. Remove once the root cause is confirmed.
      const droppedSamples = relevant.slice(0, 5).map(opportunity => {
        const rawValue = opportunity.Deadline ?? opportunity.deadline ?? opportunity.applyBy ??
          opportunity.registrationDeadline ?? opportunity.endDate ?? null;
        const parsedDeadline = normalizeDeadline(opportunity);
        const daysRemaining = parsedDeadline ? getDaysRemaining(parsedDeadline) : null;
        return {
          title: opportunity.title || opportunity.name || opportunity.id,
          rawValue,
          rawValueType: typeof rawValue,
          parsedDeadline,
          daysRemaining,
        };
      });

      debugByType[responseType] = {
        totalInFirestore: opportunities.length,
        relevantAfterCareerOrSkillMatch: relevant.length,
        withUsableDeadlineInRange: withDeadlineWindow.length,
        droppedSamples,
      };

      return withDeadlineWindow;
    }));

    const deadlines = results.flat().sort((a, b) => a.deadline.localeCompare(b.deadline));
    res.json({
      success: true,
      deadlines,
      total: deadlines.length,
      debug: {
        careerGoal: student.careerGoal || student.normalizedCareerGoal || '',
        matchedCareerName: matchedCareerName || null,
        careerLookupError,
        studentSkillCount: (student.skills || []).length,
        studentBranch: student.branch || '',
        byType: debugByType,
      },
    });
  } catch (err) {
    console.error('[opportunities/deadlines] ERROR:', err);
    res.status(500).json({
      message: 'Unable to load personalized deadlines.',
      ...(process.env.NODE_ENV === 'development' ? { error: err.message } : {}),
    });
  }
});


// ─── GET /api/opportunities/recommendations ───────────────────────────────────
router.get('/recommendations', auth, async (req, res) => {
  try {
    const student    = req.student;
    const userSkills = student.skills || [];

    const jobs = await db.getCollection('jobs', { isActive: true });
    const internships = await db.getCollection('internships', { isActive: true });
    const allCerts = await db.getCollection('freeCertificates', { isActive: true });

    const topJobs = (await personalize(jobs, student, 'jobs')).slice(0, 3);
    const topInternships = (await personalize(internships, student, 'internships')).slice(0, 3);
    const missingSkills = student.aiAnalysis?.missingSkills || [];
    const topCerts = (await personalize(allCerts, student, 'freeCertificates')).filter(c =>
      (c.requiredSkills || []).some(skill => missingSkills.some(missing => calc.normalizeSkill(skill) === calc.normalizeSkill(missing)))
    ).slice(0, 3);

    res.json({
      success: true,
      recommendations: {
        jobs: topJobs,
        internships: topInternships,
        freeCertificates: topCerts.length > 0 ? topCerts : (await personalize(allCerts, student, 'freeCertificates')).slice(0, 3),
      },
    });
  } catch (err) {
    res.status(500).json({ message: 'Failed to get recommendations', error: err.message });
  }
});

router.get('/dashboard-recommendations', auth, async (req, res) => {
  try {
    const student = req.student;
    const [jobs, internships, placements, competitions, certs] = await Promise.all([
      db.getCollection('jobs', { isActive: true }),
      db.getCollection('internships', { isActive: true }),
      db.getCollection('placements', { isActive: true }),
      db.getCollection('competitions', { isActive: true }),
      db.getCollection('freeCertificates', { isActive: true }),
    ]);

    const ranked = {
      jobs: (await personalize(jobs, student, 'jobs')).slice(0, 3),
      internships: (await personalize(internships, student, 'internships')).slice(0, 3),
      placements: (await personalize(placements, student, 'placements')).slice(0, 3),
      competitions: (await personalize(competitions, student, 'competitions')).slice(0, 3),
      freeCertificates: (await personalize(certs, student, 'freeCertificates')).slice(0, 3),
    };

    res.json({ success: true, recommendations: ranked, provider: 'firestore+calc' });
  } catch (err) {
    res.status(500).json({ message: 'Failed to get dashboard recommendations', error: err.message });
  }
});

// ─── GET /api/opportunities/careers ──────────────────────────────────────────
router.get('/careers', auth, async (req, res) => {
  try {
    const student = req.student;
    const careers = await db.getCollection('careers', { isActive: true });

    const scored = careers.map(c => ({
      ...c,
      matchScore: calc.calculateCareerMatch(student, c),
    })).sort((a, b) => b.matchScore - a.matchScore);

    res.json({ success: true, careers: scored });
  } catch (err) {
    res.status(500).json({ message: 'Failed to get careers', error: err.message });
  }
});

module.exports = router;