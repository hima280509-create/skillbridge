/**
 * SkillBridge – Centralized Calculation Service
 *
 * ALL numerical scores, percentages, and progress values must be
 * computed here. AI APIs supply component scores only;
 * this service performs every final weighted calculation.
 *
 * Rules:
 *  - No hardcoded student results
 *  - No random percentages
 *  - Every result is clamped 0-100 and rounded to the nearest integer
 */

'use strict';

// ─── Utility ─────────────────────────────────────────────────────────────────

/**
 * Clamp a value to [0, 100] and round to nearest integer.
 * Handles NaN, null, undefined, Infinity.
 * @param {number} value
 * @returns {number}
 */
function clampPercentage(value) {
  if (value === null || value === undefined || isNaN(value) || !isFinite(value)) return 0;
  return Math.min(100, Math.max(0, Math.round(Number(value))));
}

/**
 * Normalize a skill name for comparison.
 * @param {string} skill
 * @returns {string}
 */
function normalizeSkill(skill) {
  const value = (skill || '').toString().toLowerCase().trim().replace(/[.\-_/&]+/g, ' ');
  const aliases = {
    ml: 'machine learning',
    js: 'javascript',
    dsa: 'data structures and algorithms',
    reactjs: 'react',
    'react js': 'react',
    postgresql: 'postgres',
    'python programming': 'python',
    'git github': 'git github',
  };
  return aliases[value] || value.replace(/\b(programming|development|developer)\b/g, '').replace(/\s+/g, ' ').trim();
}

function skillsRelated(left, right) {
  const a = normalizeSkill(left);
  const b = normalizeSkill(right);
  if (!a || !b) return false;
  const aTokens = new Set(a.split(' '));
  const bTokens = new Set(b.split(' '));
  if (a === b) return true;
  const aInB = [...aTokens].every(token => bTokens.has(token));
  const bInA = [...bTokens].every(token => aTokens.has(token));
  return aInB || bInA;
}

/**
 * Normalize an array of skills for comparison.
 * @param {string[]} skills
 * @returns {string[]}
 */
function normalizeSkills(skills) {
  return [...new Set((skills || []).map(normalizeSkill).filter(Boolean))];
}

// ─── 1. ATS Score (Section 1 of spec) ────────────────────────────────────────

/**
 * Calculate the final ATS score from AI component scores.
 * The AI provider returns components; this function does the math.
 *
 * Weights:
 *   Structure          15%
 *   Skills Relevance   20%
 *   Keyword            20%
 *   Project            15%
 *   Certification      10%
 *   Experience         10%
 *   Industry Relevance 10%
 *
 * @param {object} components
 * @param {number} components.structureScore       0-100
 * @param {number} components.skillsRelevanceScore 0-100
 * @param {number} components.keywordScore         0-100
 * @param {number} components.projectScore         0-100
 * @param {number} components.certificationScore   0-100
 * @param {number} components.experienceScore      0-100
 * @param {number} components.industryRelevanceScore 0-100
 * @returns {number} 0-100
 */
function calculateATSScore(components) {
  const {
    structureScore       = 0,
    skillsRelevanceScore = 0,
    keywordScore         = 0,
    projectScore         = 0,
    certificationScore   = 0,
    experienceScore      = 0,
    industryRelevanceScore = 0,
  } = components || {};

  const raw =
    clampPercentage(structureScore)         * 0.15 +
    clampPercentage(skillsRelevanceScore)   * 0.20 +
    clampPercentage(keywordScore)           * 0.20 +
    clampPercentage(projectScore)           * 0.15 +
    clampPercentage(certificationScore)     * 0.10 +
    clampPercentage(experienceScore)        * 0.10 +
    clampPercentage(industryRelevanceScore) * 0.10;

  return clampPercentage(raw);
}

// ─── 2. Resume Score = ATS Score ─────────────────────────────────────────────

/**
 * Resume Score uses the same ATS calculation.
 * @param {object} atsComponents  Same shape as calculateATSScore
 * @returns {number} 0-100
 */
function calculateResumeScore(atsComponents) {
  return calculateATSScore(atsComponents);
}

function parseExperienceMonths(entry) {
  const text = typeof entry === 'string' ? entry : JSON.stringify(entry || {});
  const monthNames = '(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';
  const datePart = `(?:(?:${monthNames})[.,\\s]*)?20\\d{2}`;
  const range = text.match(new RegExp(`(${datePart})\\s*(?:[-–—]|\\bto\\b|\\bthrough\\b)\\s*(${datePart}|present|current|ongoing)`, 'i'));
  if (range) {
    const startYear = Number(range[1].match(/20\d{2}/)?.[0]);
    const endYear = Number(range[2].match(/20\d{2}/)?.[0] || new Date().getFullYear());
    const monthIndex = value => value ? ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'].findIndex(month => value.toLowerCase().includes(month)) : 0;
    const startMonth = monthIndex(range[1]);
    const endMonth = monthIndex(range[2]);
    return Math.max(0, (endYear - startYear) * 12 + endMonth - startMonth + 1);
  }
  const durationMatch = text.match(/(\d+(?:\.\d+)?)\s*(years?|yrs?|months?|mos?)/i);
  if (durationMatch) return Math.max(0, Math.round(Number(durationMatch[1]) * (/year|yr/i.test(durationMatch[2]) ? 12 : 1)));
  return 0;
}

function experienceLevel(entry) {
  const text = `${entry?.type || ''} ${entry?.title || ''} ${entry?.role || ''} ${entry?.category || ''} ${entry?.description || ''}`.toLowerCase();
  if (/workshop|seminar|short[- ]?term training/.test(text)) return 0.25;
  if (/training|course|bootcamp/.test(text)) return 0.35;
  if (/intern(ship)?|trainee|apprentice/.test(text)) return 0.65;
  if (/part[- ]?time|freelance|contract/.test(text)) return 0.75;
  if (/full[- ]?time|professional|employee|engineer|developer|analyst|manager/.test(text)) return 1;
  return 0.45;
}

function experienceRelevance(entry, careerGoal) {
  const goal = String(careerGoal || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ');
  if (!goal.trim()) return 0;
  const text = JSON.stringify(entry || {}).toLowerCase().replace(/[^a-z0-9 ]/g, ' ');
  const tokens = [...new Set(goal.split(/\s+/).filter(token => token.length > 2))];
  if (!tokens.length) return 0;
  const matches = tokens.filter(token => text.includes(token)).length;
  return clampPercentage((matches / tokens.length) * 100);
}

function calculateExperienceScore(experience, careerGoal = '') {
  const entries = Array.isArray(experience) ? experience.filter(Boolean) : experience ? [experience] : [];
  if (!entries.length) return 0;
  const details = entries.map(entry => ({
    months: parseExperienceMonths(entry),
    level: experienceLevel(typeof entry === 'string' ? { description: entry } : entry),
    relevance: experienceRelevance(entry, careerGoal),
  }));
  const totalMonths = details.reduce((sum, detail) => sum + detail.months, 0);
  const durationScore = clampPercentage(Math.min(totalMonths / 36, 1) * 100);
  const levelScore = clampPercentage((details.reduce((sum, detail) => sum + detail.level, 0) / details.length) * 100);
  const relevanceScore = clampPercentage(details.reduce((sum, detail) => sum + detail.relevance, 0) / details.length);
  const meaningfulScore = clampPercentage(Math.min(entries.length / 3, 1) * 100);
  return clampPercentage(durationScore * 0.40 + levelScore * 0.25 + relevanceScore * 0.20 + meaningfulScore * 0.15);
}

function estimateATSComponentsFromProfile(user = {}) {
  const skills = user.skills || [];
  const projects = user.projects || [];
  const certifications = user.certifications || [];
  const experience = user.experience || [];
  return {
    structureScore: user.resumeUrl || user.resumeParsed ? 80 : 40,
    skillsRelevanceScore: clampPercentage(skills.length * 8),
    keywordScore: clampPercentage(skills.length * 6 + (user.careerGoal ? 20 : 0)),
    projectScore: clampPercentage(projects.length * 30),
    certificationScore: clampPercentage(certifications.length * 40),
    experienceScore: calculateExperienceScore(experience, user.careerGoal || user.normalizedCareerGoal),
    industryRelevanceScore: clampPercentage((user.careerGoal ? 30 : 0) + skills.length * 5),
  };
}

function estimateResumeScoreFromProfile(user) {
  return calculateATSScore(estimateATSComponentsFromProfile(user));
}

// ─── 3. Skill Match Percentage ────────────────────────────────────────────────

/**
 * Calculate how many required skills the student possesses.
 * @param {string[]} studentSkills
 * @param {string[]} requiredSkills
 * @returns {{ matchPct: number, matchedSkills: string[], missingSkills: string[] }}
 */
function calculateSkillMatch(studentSkills, requiredSkills) {
  const student  = normalizeSkills(studentSkills);
  const required = normalizeSkills(requiredSkills);

  if (required.length === 0) {
    return { matchPct: 0, skillMatchPercentage: 0, matchedSkills: [], missingSkills: [] };
  }

  const matchedSkills = required.filter(requiredSkill => student.some(studentSkill => skillsRelated(studentSkill, requiredSkill)));
  const missingSkills = required.filter(requiredSkill => !matchedSkills.includes(requiredSkill));

  const matchPct = clampPercentage((matchedSkills.length / required.length) * 100);
  const skillMatchPercentage = (matchedSkills.length / required.length) * 100;
  return { matchPct, skillMatchPercentage, matchedSkills, missingSkills };
}

// ─── 4. Skill Added Percentage ───────────────────────────────────────────────

/**
 * Percentage of recommended/required skills the student has acquired.
 * Identical formula to Skill Match but named separately for readability.
 * @param {string[]} studentSkills
 * @param {string[]} targetSkills
 * @returns {number} 0-100
 */
function calculateSkillAdded(studentSkills, targetSkills) {
  return calculateSkillMatch(studentSkills, targetSkills).matchPct;
}

// ─── 5. Profile Completion ────────────────────────────────────────────────────

/**
 * Required profile fields and their weights (total = 10 fields).
 * Each field checked: completedFields++
 *
 * Fields:
 *  personalDetails  (name + email + phone)
 *  resume           (resumeUrl present)
 *  skills           (skills.length > 0)
 *  projects         (projects.length > 0)
 *  certifications   (certifications.length > 0)
 *  careerPreferences (careerGoal set)
 *  careerGoal       (careerGoal set — same as above, counted once)
 *  academicInfo     (branch + cgpa)
 *  linkedIn         (linkedinUrl)
 *  experience       (experience.length > 0)
 *
 * @param {object} user
 * @returns {number} 0-100
 */
function calculateProfileCompletion(user) {
  if (!user) return 0;

  const checks = [
    !!(user.name && user.email),                              // personal details
    !!(user.phone || user.mobile),                            // contact
    !!(user.resumeUrl || user.resumeParsed),                  // resume uploaded
    !!(user.skills && user.skills.length > 0),               // skills
    !!(user.projects && user.projects.length > 0),           // projects
    !!(user.certifications && user.certifications.length > 0), // certifications
    !!(user.careerGoal),                                      // career goal / preferences
    !!(user.branch && user.cgpa),                             // academic info
    !!(user.linkedinUrl || user.linkedin),                    // LinkedIn
    !!(user.experience && user.experience.length > 0),       // experience
  ];

  const total = checks.length;
  const completed = checks.filter(Boolean).length;
  return clampPercentage((completed / total) * 100);
}

// ─── 7. Career Progress ──────────────────────────────────────────────────────

/**
 * Career progress from actual student progress data.
 *
 * Weights:
 *   Roadmap Completion  40%
 *   Skills Acquired     20%
 *   Projects Completed  15%
 *   Certifications      15%
 *   Applications        10%
 *
 * @param {object} params
 * @param {number} params.roadmapCompletionPct  0-100
 * @param {number} params.skillsAcquiredPct     0-100  (student skills / target skills)
 * @param {number} params.projectsCompletedPct  0-100  (projects / recommended target)
 * @param {number} params.certificationsEarnedPct 0-100
 * @param {number} params.applicationsSubmittedPct 0-100
 * @returns {number} 0-100
 */
function calculateCareerProgress({
  roadmapCompletionPct    = 0,
  skillsAcquiredPct       = 0,
  projectsCompletedPct    = 0,
  certificationsEarnedPct = 0,
  applicationsSubmittedPct = 0,
} = {}) {
  const raw =
    clampPercentage(roadmapCompletionPct)    * 0.40 +
    clampPercentage(skillsAcquiredPct)       * 0.20 +
    clampPercentage(projectsCompletedPct)    * 0.15 +
    clampPercentage(certificationsEarnedPct) * 0.15 +
    clampPercentage(applicationsSubmittedPct) * 0.10;

  return clampPercentage(raw);
}

// ─── 8. Overall Career Match ─────────────────────────────────────────────────

/**
 * Calculate the overall career match from Gemini component scores.
 *
 * Weights:
 *   Skill Match         40%
 *   Resume Skill Rel.   20%
 *   Project Relevance   15%
 *   Branch Relevance    10%
 *   Experience Rel.     10%
 *   Academic Relevance   5%
 *
 * @param {object} components  (returned by Gemini – structured JSON)
 * @returns {number} 0-100
 */
function calculateOverallMatch(components) {
  const {
    skillMatchScore         = 0,
    resumeSkillRelevance    = 0,
    projectRelevance        = 0,
    branchRelevance         = 0,
    experienceRelevance     = 0,
    academicRelevance       = 0,
  } = components || {};

  const raw =
    clampPercentage(skillMatchScore)      * 0.40 +
    clampPercentage(resumeSkillRelevance) * 0.20 +
    clampPercentage(projectRelevance)     * 0.15 +
    clampPercentage(branchRelevance)      * 0.10 +
    clampPercentage(experienceRelevance)  * 0.10 +
    clampPercentage(academicRelevance)    * 0.05;

  return clampPercentage(raw);
}

// ─── 9. Opportunity Match ────────────────────────────────────────────────────

/**
 * Calculate the match score for a single job/internship/placement/etc.
 *
 * Weights:
 *   Skill Match      40%
 *   Career Goal      20%
 *   Eligibility      15%
 *   Project Rel.     10%
 *   Cert Rel.        10%
 *   Academic Rel.     5%
 *
 * @param {object} params
 * @param {string[]} params.studentSkills
 * @param {string[]} params.requiredSkills
 * @param {boolean}  params.careerGoalMatch
 * @param {boolean}  params.eligibilityMatch
 * @param {number}   params.projectRelevance  0-100 (calculated externally)
 * @param {number}   params.certRelevance     0-100
 * @param {number}   params.academicRelevance 0-100
 * @returns {number} 0-100
 */
function calculateOpportunityMatch({
  studentSkills    = [],
  requiredSkills   = [],
  careerGoalMatch  = false,
  eligibilityMatch = false,
  projectRelevance  = 0,
  certRelevance     = 0,
  academicRelevance = 0,
} = {}) {
  const { matchPct: skillMatchPct } = calculateSkillMatch(studentSkills, requiredSkills);
  const careerGoalScore  = careerGoalMatch  ? 100 : 0;
  const eligibilityScore = eligibilityMatch ? 100 : 0;

  const raw =
    skillMatchPct              * 0.40 +
    careerGoalScore            * 0.20 +
    eligibilityScore           * 0.15 +
    clampPercentage(projectRelevance)  * 0.10 +
    clampPercentage(certRelevance)     * 0.10 +
    clampPercentage(academicRelevance) * 0.05;

  return clampPercentage(raw);
}

// ─── 10. ATS Improvement ─────────────────────────────────────────────────────

/**
 * Calculate the improvement when a resume is updated.
 * @param {number} originalScore 0-100
 * @param {number} improvedScore 0-100
 * @returns {{ pointChange: number, improvementPct: number }}
 */
function calculateATSImprovement(originalScore, improvedScore) {
  const orig = clampPercentage(originalScore);
  const impr = clampPercentage(improvedScore);
  const pointChange = impr - orig;
  const improvementPct = orig > 0
    ? clampPercentage(((impr - orig) / orig) * 100)
    : 0;
  return { pointChange, improvementPct };
}

// ─── 11. Skill Gap ───────────────────────────────────────────────────────────

/**
 * Calculate the skill gap percentage.
 * @param {string[]} studentSkills
 * @param {string[]} requiredSkills
 * @returns {{ gapPct: number, matchPct: number, matchedSkills: string[], missingSkills: string[] }}
 */
function calculateSkillGap(studentSkills, requiredSkills) {
  const required = normalizeSkills(requiredSkills);
  if (required.length === 0) {
    return { gapPct: 0, matchPct: 0, matchedSkills: [], missingSkills: [] };
  }

  const { matchPct, matchedSkills, missingSkills } = calculateSkillMatch(studentSkills, requiredSkills);
  const gapPct = clampPercentage((missingSkills.length / required.length) * 100);

  return { gapPct, matchPct, matchedSkills, missingSkills };
}

// ─── 12. Match Distribution ──────────────────────────────────────────────────

/**
 * Dynamic match / missing distribution percentages.
 * @param {number} totalMatched
 * @param {number} totalRequired
 * @returns {{ matchedPct: number, missingPct: number }}
 */
function calculateMatchDistribution(totalMatched, totalRequired) {
  if (!totalRequired || totalRequired <= 0) return { matchedPct: 0, missingPct: 0 };
  const matchedPct = clampPercentage((totalMatched / totalRequired) * 100);
  const missingPct = clampPercentage(((totalRequired - totalMatched) / totalRequired) * 100);
  return { matchedPct, missingPct };
}

// ─── 13. Skill Gap Breakdown by Category ─────────────────────────────────────

/**
 * Category-wise skill gap.
 * @param {string[]} studentSkills
 * @param {object}   skillsByCategory  { categoryName: { required: string[], ... } }
 *                   (built from Firestore skills collection)
 * @returns {object} { categoryName: { have: string[], missing: string[], gapPct: number } }
 */
function calculateSkillGapBreakdown(studentSkills, skillsByCategory) {
  const student = normalizeSkills(studentSkills);
  const result  = {};

  for (const [cat, data] of Object.entries(skillsByCategory || {})) {
    const required = normalizeSkills(data.required || data.skills || []);
    if (required.length === 0) continue;

    const have    = required.filter(requiredSkill => student.some(studentSkill => skillsRelated(studentSkill, requiredSkill)));
    const missing = required.filter(requiredSkill => !have.includes(requiredSkill));
    const gapPct  = clampPercentage((missing.length / required.length) * 100);

    result[cat] = { have, missing, gapPct, total: required.length };
  }

  return result;
}

// ─── 14. Learning Roadmap Completion ─────────────────────────────────────────

/**
 * Roadmap completion percentage.
 * Gemini generates the topics; JS tracks and calculates completion.
 * @param {number} completedTopics
 * @param {number} totalTopics
 * @returns {number} 0-100
 */
function calculateLearningRoadmapProgress(completedTopics, totalTopics) {
  if (!totalTopics || totalTopics <= 0) return 0;
  return clampPercentage((completedTopics / totalTopics) * 100);
}

// ─── 15. Expected Match After Improvement ────────────────────────────────────

/**
 * Expected career match score after proposed improvements.
 * Gemini returns future component scores; this calculates the final number.
 * Uses the SAME formula as calculateOverallMatch.
 * @param {object} futureComponents  (same shape as calculateOverallMatch input)
 * @returns {number} 0-100
 */
function calculateExpectedMatchAfterImprovement(futureComponents) {
  return calculateOverallMatch(futureComponents);
}

// ─── Career Match from Firestore Data (no AI needed) ─────────────────────────

/**
 * Compute a career match score directly from Firestore career + skill data
 * vs. the student's actual profile. Used for DB-backed matching without AI.
 *
 * @param {object} user     Student user document
 * @param {object} career   Firestore careers document
 * @returns {number} 0-100
 */
function calculateCareerMatch(user, career) {
  if (!user || !career) return 0;

  const studentSkills = normalizeSkills(user.skills);
  const requiredSkills = normalizeSkills(career.requiredSkills || []);
  const preferredSkills = normalizeSkills(career.preferredSkills || []);

  // Skill match (required skills only, weighted 70% req + 30% preferred)
  const reqMatch  = requiredSkills.length  > 0 ? requiredSkills.filter(required => studentSkills.some(student => skillsRelated(student, required))).length  / requiredSkills.length  : 0;
  const prefMatch = preferredSkills.length > 0 ? preferredSkills.filter(preferred => studentSkills.some(student => skillsRelated(student, preferred))).length / preferredSkills.length : 0;
  const skillMatchScore = clampPercentage((reqMatch * 0.70 + prefMatch * 0.30) * 100);

  // Branch relevance
  const careerBranches = (career.eligibleBranches || []).map(b => b.toLowerCase());
  const branch = (user.branch || '').toLowerCase();
  const branchRelevance = careerBranches.length === 0
    ? 100
    : branch && careerBranches.some(b => b === 'all' || branch.includes(b) || b.includes(branch)) ? 100 : 0;

  // Academic relevance (CGPA)
  const minCgpa = career.minimumCGPA || 0;
  const cgpa = user.cgpa || 0;
  const academicRelevance = minCgpa === 0 ? (cgpa > 0 ? 100 : 0) : cgpa >= minCgpa ? 100 : clampPercentage((cgpa / minCgpa) * 100);

  // Project relevance (rough: has projects = 80, multiple = 100)
  const projectCount = (user.projects || []).length;
  const projectRelevance = projectCount === 0 ? 0 : projectCount >= 3 ? 100 : projectCount >= 1 ? 80 : 0;

  // Certification relevance
  const certCount = (user.certifications || []).length;
  const certRelevance = certCount === 0 ? 20 : certCount >= 2 ? 100 : 60;

  // Experience relevance
  const experienceRelevance = calculateExperienceScore(
    user.experience,
    user.careerGoal || user.normalizedCareerGoal || career.careerTitle || career.Career_Name
  );

  return calculateOverallMatch({
    skillMatchScore,
    resumeSkillRelevance: skillMatchScore, // resume skill rel ≈ skill match for DB path
    projectRelevance,
    branchRelevance,
    experienceRelevance,
    academicRelevance,
  });
}

// ─── Exports ──────────────────────────────────────────────────────────────────

module.exports = {
  normalizeSkill,
  skillsRelated,
  clampPercentage,
  normalizeSkill,
  normalizeSkills,
  calculateATSScore,
  calculateResumeScore,
  calculateExperienceScore,
  estimateATSComponentsFromProfile,
  estimateResumeScoreFromProfile,
  calculateSkillMatch,
  calculateSkillAdded,
  calculateProfileCompletion,
  calculateCareerProgress,
  calculateOverallMatch,
  calculateOpportunityMatch,
  calculateATSImprovement,
  calculateSkillGap,
  calculateMatchDistribution,
  calculateSkillGapBreakdown,
  calculateLearningRoadmapProgress,
  calculateExpectedMatchAfterImprovement,
  calculateCareerMatch,
};
