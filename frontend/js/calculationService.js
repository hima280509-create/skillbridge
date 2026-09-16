/**
 * SkillBridge – Frontend Centralized Calculation Service
 *
 * Mirror of backend/services/calculationService.js for client-side use.
 * All numerical percentages, scores, and progress values are computed here.
 * No hardcoded values, no random numbers, no AI-generated final scores.
 *
 * Usage: window.SBCalc.calculateATSScore(components)
 */

(function (global) {
  'use strict';

  // ─── Utility ──────────────────────────────────────────────────────────────

  /**
   * Clamp to [0,100] and round. Handles NaN, null, undefined, Infinity.
   */
  function clampPercentage(value) {
    if (value === null || value === undefined || isNaN(value) || !isFinite(value)) return 0;
    return Math.min(100, Math.max(0, Math.round(Number(value))));
  }

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
    };
    return (aliases[value] || value).replace(/\b(programming|development|developer)\b/g, '').replace(/\s+/g, ' ').trim();
  }

  function normalizeSkills(skills) {
    return [...new Set((skills || []).map(normalizeSkill).filter(Boolean))];
  }

  // ─── 1. ATS Score ─────────────────────────────────────────────────────────

  /**
   * ATS Score from component scores.
   * Weights: Structure 15%, Skills Relevance 20%, Keyword 20%,
   *          Project 15%, Certification 10%, Experience 10%, Industry 10%
   */
  function calculateATSScore(components) {
    const c = components || {};
    const raw =
      clampPercentage(c.structureScore        || 0) * 0.15 +
      clampPercentage(c.skillsRelevanceScore  || 0) * 0.20 +
      clampPercentage(c.keywordScore          || 0) * 0.20 +
      clampPercentage(c.projectScore          || 0) * 0.15 +
      clampPercentage(c.certificationScore    || 0) * 0.10 +
      clampPercentage(c.experienceScore       || 0) * 0.10 +
      clampPercentage(c.industryRelevanceScore || 0) * 0.10;
    return clampPercentage(raw);
  }

  // ─── 2. Resume Score = ATS Score ──────────────────────────────────────────

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

  /**
   * Lightweight resume score estimated from profile data (no AI needed).
   * Used when AI analysis hasn't been run yet.
   */
  // ─── 3. Skill Match ───────────────────────────────────────────────────────

  /**
   * @returns {{ matchPct, matchedSkills, missingSkills }}
   */
  function calculateSkillMatch(studentSkills, requiredSkills) {
    const student  = normalizeSkills(studentSkills);
    const required = normalizeSkills(requiredSkills);

    if (required.length === 0) return { matchPct: 0, skillMatchPercentage: 0, matchedSkills: [], missingSkills: [] };

    const related = (left, right) => {
      if (left === right) return true;
      const leftTokens = new Set(left.split(' '));
      const rightTokens = new Set(right.split(' '));
      return [...leftTokens].every(token => rightTokens.has(token)) ||
        [...rightTokens].every(token => leftTokens.has(token));
    };
    const matchedSkills = required.filter(requiredSkill => student.some(studentSkill => related(studentSkill, requiredSkill)));
    const missingSkills = required.filter(requiredSkill => !matchedSkills.includes(requiredSkill));
    const matchPct = clampPercentage((matchedSkills.length / required.length) * 100);

    const skillMatchPercentage = (matchedSkills.length / required.length) * 100;
    return { matchPct, skillMatchPercentage, matchedSkills, missingSkills };
  }

  // ─── 4. Skill Added ───────────────────────────────────────────────────────

  function calculateSkillAdded(studentSkills, targetSkills) {
    return calculateSkillMatch(studentSkills, targetSkills).matchPct;
  }

  // ─── 5. Profile Completion ────────────────────────────────────────────────

  /**
   * 10 required fields, each contributes 10%.
   */
  function calculateProfileCompletion(user) {
    if (!user) return 0;
    const checks = [
      !!(user.name && user.email),
      !!(user.phone || user.mobile),
      !!(user.resumeUrl || user.resumeParsed),
      !!(user.skills && user.skills.length > 0),
      !!(user.projects && user.projects.length > 0),
      !!(user.certifications && user.certifications.length > 0),
      !!(user.careerGoal),
      !!(user.branch && user.cgpa),
      !!(user.linkedinUrl || user.linkedin),
      !!(user.experience && user.experience.length > 0),
    ];
    return clampPercentage((checks.filter(Boolean).length / checks.length) * 100);
  }

  // ─── 7. Career Progress ───────────────────────────────────────────────────

  /**
   * Weights: Roadmap 40%, Skills 20%, Projects 15%, Certs 15%, Applications 10%
   */
  function calculateCareerProgress({
    roadmapCompletionPct     = 0,
    skillsAcquiredPct        = 0,
    projectsCompletedPct     = 0,
    certificationsEarnedPct  = 0,
    applicationsSubmittedPct = 0,
  } = {}) {
    const raw =
      clampPercentage(roadmapCompletionPct)     * 0.40 +
      clampPercentage(skillsAcquiredPct)        * 0.20 +
      clampPercentage(projectsCompletedPct)     * 0.15 +
      clampPercentage(certificationsEarnedPct)  * 0.15 +
      clampPercentage(applicationsSubmittedPct) * 0.10;
    return clampPercentage(raw);
  }

  /**
   * Build career progress components from a user object (local profile data).
   */
  function buildCareerProgressComponents(user, roadmapChecked) {
    const skills       = user.skills   || [];
    const projects     = user.projects || [];
    const certs        = user.certifications || [];

    // Roadmap completion from localStorage checked topics
    let completedTopics = 0;
    let totalTopics     = Number(user.roadmapTopics?.length) || 0;
    if (roadmapChecked && typeof roadmapChecked === 'object') {
      completedTopics = Object.values(roadmapChecked).filter(Boolean).length;
      totalTopics     = Math.max(totalTopics, completedTopics);
    }
    if (!roadmapChecked && user.roadmapCompletedTopics) {
      completedTopics = Number(user.roadmapCompletedTopics) || 0;
    }
    const roadmapCompletionPct = calculateLearningRoadmapProgress(completedTopics, totalTopics);

    const skillsAcquiredPct       = clampPercentage((skills.length   / 10) * 100);
    const projectsCompletedPct    = clampPercentage((projects.length  / 3)  * 100);
    const certificationsEarnedPct = clampPercentage((certs.length    / 3)  * 100);

    const savedCount = ((user.savedJobs || []).length + (user.savedInternships || []).length);
    const applicationsSubmittedPct = clampPercentage((savedCount / 10) * 100);

    return {
      roadmapCompletionPct,
      skillsAcquiredPct,
      projectsCompletedPct,
      certificationsEarnedPct,
      applicationsSubmittedPct,
    };
  }

  // ─── 8. Overall Career Match ──────────────────────────────────────────────

  /**
   * Weights: Skill Match 40%, Resume Skill Rel 20%, Project 15%,
   *          Branch 10%, Experience 10%, Academic 5%
   */
  function calculateOverallMatch(components) {
    const c = components || {};
    const raw =
      clampPercentage(c.skillMatchScore         || 0) * 0.40 +
      clampPercentage(c.resumeSkillRelevance    || 0) * 0.20 +
      clampPercentage(c.projectRelevance        || 0) * 0.15 +
      clampPercentage(c.branchRelevance         || 0) * 0.10 +
      clampPercentage(c.experienceRelevance     || 0) * 0.10 +
      clampPercentage(c.academicRelevance       || 0) * 0.05;
    return clampPercentage(raw);
  }

  // ─── 9. Opportunity Match ─────────────────────────────────────────────────

  /**
   * Weights: Skill Match 40%, Career Goal 20%, Eligibility 15%,
   *          Project 10%, Cert 10%, Academic 5%
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
    const raw =
      skillMatchPct                          * 0.40 +
      (careerGoalMatch  ? 100 : 0)           * 0.20 +
      (eligibilityMatch ? 100 : 0)           * 0.15 +
      clampPercentage(projectRelevance)      * 0.10 +
      clampPercentage(certRelevance)         * 0.10 +
      clampPercentage(academicRelevance)     * 0.05;
    return clampPercentage(raw);
  }

  // ─── 10. ATS Improvement ─────────────────────────────────────────────────

  function calculateATSImprovement(originalScore, improvedScore) {
    const orig = clampPercentage(originalScore);
    const impr = clampPercentage(improvedScore);
    const pointChange = impr - orig;
    const improvementPct = orig > 0
      ? clampPercentage(((impr - orig) / orig) * 100)
      : 0;
    return { pointChange, improvementPct };
  }

  // ─── 11. Skill Gap ────────────────────────────────────────────────────────

  function calculateSkillGap(studentSkills, requiredSkills) {
    const required = normalizeSkills(requiredSkills);
    if (required.length === 0) return { gapPct: 0, matchPct: 0, matchedSkills: [], missingSkills: [] };

    const { matchPct, matchedSkills, missingSkills } = calculateSkillMatch(studentSkills, requiredSkills);
    const gapPct = clampPercentage((missingSkills.length / required.length) * 100);
    return { gapPct, matchPct, matchedSkills, missingSkills };
  }

  // ─── 12. Match Distribution ───────────────────────────────────────────────

  function calculateMatchDistribution(totalMatched, totalRequired) {
    if (!totalRequired || totalRequired <= 0) return { matchedPct: 0, missingPct: 0 };
    const matchedPct = clampPercentage((totalMatched / totalRequired) * 100);
    const missingPct = clampPercentage(((totalRequired - totalMatched) / totalRequired) * 100);
    return { matchedPct, missingPct };
  }

  // ─── 13. Skill Gap Breakdown ─────────────────────────────────────────────

  function calculateSkillGapBreakdown(studentSkills, skillsByCategory) {
    const student = normalizeSkills(studentSkills);
    const result  = {};
    for (const [cat, data] of Object.entries(skillsByCategory || {})) {
      const required = normalizeSkills(data.required || data.skills || []);
      if (required.length === 0) continue;
      const have    = required.filter(requiredSkill => student.some(studentSkill => {
        if (studentSkill === requiredSkill) return true;
        const leftTokens = new Set(studentSkill.split(' '));
        const rightTokens = new Set(requiredSkill.split(' '));
        return [...leftTokens].every(token => rightTokens.has(token)) ||
          [...rightTokens].every(token => leftTokens.has(token));
      }));
      const missing = required.filter(requiredSkill => !have.includes(requiredSkill));
      const gapPct  = clampPercentage((missing.length / required.length) * 100);
      result[cat] = { have, missing, gapPct, total: required.length };
    }
    return result;
  }

  // ─── 14. Learning Roadmap Progress ───────────────────────────────────────

  function calculateLearningRoadmapProgress(completedTopics, totalTopics) {
    if (!totalTopics || totalTopics <= 0) return 0;
    return clampPercentage((completedTopics / totalTopics) * 100);
  }

  // ─── 15. Expected Match After Improvement ────────────────────────────────

  function calculateExpectedMatchAfterImprovement(futureComponents) {
    return calculateOverallMatch(futureComponents);
  }

  function calculateCareerMatch(user, career) {
    if (!user || !career) return 0;

    const studentSkills = normalizeSkills(user.skills);
    const requiredSkills = normalizeSkills(career.requiredSkills || career.Required_Skills || career.skills || []);
    const preferredSkills = normalizeSkills(career.preferredSkills || career.Preferred_Skills || []);
    const requiredMatch = calculateSkillMatch(studentSkills, requiredSkills).matchPct;
    const preferredMatch = calculateSkillMatch(studentSkills, preferredSkills).matchPct;
    const skillMatchScore = clampPercentage(requiredSkills.length
      ? requiredMatch * 0.70 + preferredMatch * 0.30
      : preferredMatch);
    const branches = (career.eligibleBranches || career.Eligible_Branches || []).map(branch => String(branch).toLowerCase());
    const branchRelevance = branches.length === 0 || branches.some(branch => branch === 'all' || (user.branch || '').toLowerCase().includes(branch) || branch.includes((user.branch || '').toLowerCase())) ? 100 : 0;
    const minCgpa = Number(career.minimumCGPA || career.minimumCgpa || 0);
    const cgpa = Number(user.cgpa || 0);
    const academicRelevance = minCgpa === 0 ? 80 : cgpa >= minCgpa ? 100 : clampPercentage((cgpa / minCgpa) * 100);
    const projects = (user.projects || []).length;
    const certs = (user.certifications || []).length;
    const experienceScore = calculateExperienceScore(
      user.experience,
      user.careerGoal || user.normalizedCareerGoal || career.careerTitle || career.Career_Name
    );
    return calculateOverallMatch({
      skillMatchScore,
      resumeSkillRelevance: skillMatchScore,
      projectRelevance: projects >= 3 ? 100 : projects > 0 ? 80 : 0,
      branchRelevance,
      experienceRelevance: experienceScore,
      academicRelevance,
    });
  }

  /**
   * Run full local AI analysis from user profile.
  * Returns only profile-derived metrics when Firestore analysis is unavailable.
   */
  function runLocalAnalysis(user) {
    const skills      = (user.skills || []).map(s => s.toLowerCase());
    const careerGoal  = user.careerGoal || '';
    const required    = [];

    const { matchPct: skillMatch, matchedSkills, missingSkills } = calculateSkillMatch(skills, required);

    // Resume score
    const resumeScore = estimateResumeScoreFromProfile(user);

    // Profile completion
    const profileCompletion = calculateProfileCompletion(user);

    // Career progress
    const roadmapChecked = (() => { try { return JSON.parse(localStorage.getItem('roadmapChecked') || '{}'); } catch { return {}; } })();
    const progressComponents = buildCareerProgressComponents(user, roadmapChecked);
    const careerProgress = calculateCareerProgress(progressComponents);

    // Skill gap
    const { gapPct: skillGapPct } = calculateSkillGap(skills, required);

    // Top career matches
    const topCareers = [];

    // Strengths
    const strengths = [];
    if (skills.length >= 5) strengths.push('Strong technical skill base');
    if ((user.projects?.length || 0) >= 1) strengths.push('Active project portfolio');
    if ((user.certifications?.length || 0) >= 1) strengths.push('Certified learner');
    if ((user.cgpa || 0) >= 7.5) strengths.push('Excellent academic performance');
    if (skills.includes('python') || skills.includes('machine learning')) strengths.push('AI/ML expertise');
    if (skills.includes('react') || skills.includes('javascript')) strengths.push('Modern web development skills');
    if (strengths.length === 0) strengths.push('Getting started — add more skills!');

    // Improvements
    const improvements = [];
    if (missingSkills.length > 0) improvements.push(`Learn: ${missingSkills.slice(0, 3).join(', ')}`);
    if (!user.projects?.length) improvements.push('Add portfolio projects');
    if (!user.certifications?.length) improvements.push('Earn free certifications');
    if (!user.linkedinUrl) improvements.push('Build LinkedIn profile');
    if ((user.cgpa || 0) < 7) improvements.push('Focus on academics');

    // Match distribution for top career
    const matchDist = calculateMatchDistribution(matchedSkills.length, required.length);

    return {
      resumeScore,
      skillMatch,          // alias
      skillMatchPercentage: skillMatch,
      skillGapPct,
      profileCompletion,
      profilePct: profileCompletion, // backwards compat
      careerProgress,
      progressComponents,
      matchDistribution: matchDist,
      missingSkills:      missingSkills.slice(0, 8),
      matchedSkills,
      requiredSkills:     required,
      recommendedCareers: topCareers.slice(0, 3).map(c => c.title),
      topCareers:         topCareers.slice(0, 3),
      strengths,
      improvements,
      lastAnalyzed: new Date().toISOString(),
    };
  }

  // ─── Exported API ──────────────────────────────────────────────────────────

  const SBCalc = {
    clampPercentage,
    normalizeSkill,
    normalizeSkills,
    calculateATSScore,
    calculateResumeScore,
    calculateExperienceScore,
    estimateATSComponentsFromProfile,
    estimateResumeScoreFromProfile,
    estimateResumeScoreFromProfile,
    calculateSkillMatch,
    calculateSkillAdded,
    calculateProfileCompletion,
    calculateCareerProgress,
    buildCareerProgressComponents,
    calculateOverallMatch,
    calculateOpportunityMatch,
    calculateATSImprovement,
    calculateSkillGap,
    calculateMatchDistribution,
    calculateSkillGapBreakdown,
    calculateLearningRoadmapProgress,
    calculateExpectedMatchAfterImprovement,
    calculateCareerMatch,
    runLocalAnalysis,
  };

  // Expose globally
  global.SBCalc = SBCalc;

  // Also expose runLocalAIAnalysis as the legacy function name for backwards compat
  global.runLocalAIAnalysis = function (user) {
    return SBCalc.runLocalAnalysis(user);
  };

}(typeof window !== 'undefined' ? window : this));
