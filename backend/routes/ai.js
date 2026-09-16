/**
 * SkillBridge – AI Routes
 *
 * All student data loaded from users/{UID} (Firebase Auth UID).
 * Reference data (careers, skills, jobs, etc.) loaded from Firestore collections.
 * All numerical scores computed by calculationService — never by AI.
 * API keys accessed only via secure environment variables.
 *
 * POST /api/ai/analyze-resume       → Gemini
 * POST /api/ai/career-guidance      → Gemini
 * POST /api/ai/roadmap              → Gemini
 * POST /api/ai/chat                 → Gemini
 * POST /api/ai/skill-gap            → Gemini
 * POST /api/ai/opportunities        → Gemini + Firestore
 * POST /api/ai/career-analysis      → Gemini + Firestore
 * POST /api/ai/explain-match        → Gemini
 * POST /api/ai/content              → Gemini
 * POST /api/ai/interview-questions  → Gemini
 * POST /api/ai/full-analysis        → Gemini services in parallel
 */

'use strict';

const express = require('express');
const router  = express.Router();
const { FieldValue } = require('firebase-admin/firestore');
const crypto  = require('crypto');
const auth    = require('../middleware/auth');
const db      = require('../services/firestoreService');
const geminiAi = require('../services/geminiAiService');
const gemini  = require('../services/geminiService');
const calc    = require('../services/calculationService');
const careerSkills = require('../services/careerSkillsService');
const { getKnowledgeContext } = require('../services/skillbridgeKnowledgeBase');

// ─── Helper: build profileData from student document ─────────────────────────
function buildProfile(student, overrides = {}) {
  return {
    name:           student.name,
    email:          student.email,
    branch:         student.branch,
    academicYear:   student.academicYear,
    college:        student.college,
    cgpa:           student.cgpa,
    skills:         student.skills          || [],
    projects:       student.projects        || [],
    certifications: student.certifications  || [],
    experience:     student.experience      || [],
    careerGoal:     student.careerGoal      || 'Software Engineer',
    linkedinUrl:    student.linkedinUrl,
    githubUrl:      student.githubUrl,
    bio:            student.bio,
    resumeUrl:      student.resumeUrl,
    ...overrides,
  };
}

// ─── Helper: fetch career + required skills from Firestore ────────────────────
async function fetchCareerData(student) {
  const result = await careerSkills.getCareerSkillResult(student);
  return {
    ...result,
    careerRecord: result.matchedCareer || {},
    normalizedCareerGoal: result.matchedCareer?.Career_Name || '',
  };
}

async function safeGetResume(uid) {
  try {
    return await db.getResume(uid);
  } catch (err) {
    console.error('[CHAT] getResume failed:', err.message);
    return null;
  }
}

function roadmapProfileHash({ careerGoal, userSkills, requiredSkills, matchedSkills, missingSkills }) {
  const normalize = values => [...new Set((values || []).map(calc.normalizeSkill).filter(Boolean))].sort();
  const profile = {
    careerGoal: calc.normalizeSkill(careerGoal),
    userSkills: normalize(userSkills),
    requiredSkills: normalize(requiredSkills),
    matchedSkills: normalize(matchedSkills),
    missingSkills: normalize(missingSkills),
  };
  return crypto.createHash('sha256').update(JSON.stringify(profile)).digest('hex');
}

function validateRoadmap(roadmap, missingSkills) {
  const missing = missingSkills || [];
  const weeks = Array.isArray(roadmap?.weeks) ? roadmap.weeks : [];
  if (weeks.length !== 6) throw new Error('Roadmap must contain exactly 6 weeks');

  const usedIds = new Set();
  let removedTopics = 0;
  const validatedWeeks = weeks.map((week, index) => {
    const topics = Array.isArray(week?.topics) ? week.topics : [];
    const validTopics = [];
    for (const original of topics) {
      const topic = { ...original };
      const remappedSkill = topic.skill || topic.tag;
      if (remappedSkill && missing.some(skill => calc.skillsRelated(remappedSkill, skill))) {
        topic.skill = missing.find(skill => calc.skillsRelated(remappedSkill, skill));
      }
      const valid = String(topic.id || '').trim() && String(topic.name || '').trim() && topic.skill && String(topic.resource || '').trim() &&
        Number.isFinite(Number(topic.hours)) && Number(topic.hours) > 0 &&
        missing.some(skill => calc.skillsRelated(topic.skill, skill)) && !usedIds.has(String(topic.id));
      if (!valid) {
        removedTopics += 1;
        continue;
      }
      usedIds.add(String(topic.id));
      validTopics.push({
        ...topic,
        id: String(topic.id),
        name: String(topic.name).trim(),
        skill: topic.skill,
        tag: topic.tag || topic.skill,
        hours: Number(topic.hours),
        resource: String(topic.resource).trim(),
        completed: false,
      });
    }
    return { ...week, week: Number(week.week) || index + 1, topics: validTopics };
  });

  const validatedTopics = validatedWeeks.reduce((count, week) => count + week.topics.length, 0);
  if (validatedTopics !== 18 || validatedWeeks.some(week => week.topics.length !== 3)) {
    throw new Error('Roadmap must contain exactly 18 valid topics, with 3 topics per week');
  }

  return {
    roadmap: { ...roadmap, totalWeeks: 6, weeks: validatedWeeks },
    removedTopics,
    validatedTopics,
  };
}

function detectChatIntent(message) {
  const text = String(message || '').toLowerCase();
  if (/what is skillbridge|what can skillbridge|skillbridge features|how does skillbridge|purpose of (the )?chatbot/.test(text)) return 'skillbridge_info';
  if (/free cert|certification/.test(text)) return 'certifications';
  if (/internship/.test(text)) return 'internships';
  if (/placement/.test(text)) return 'placements';
  if (/competition|hackathon/.test(text)) return 'competitions';
  if (/\bjobs?\b|job opportunities/.test(text)) return 'jobs';
  if (/missing skill|skill gap|what skills am i missing|which skills do i need|which skill do i need/.test(text)) return 'missing_skills';
  if (/what should i learn|learn first|learn next|roadmap|job ready|improve this skill|which skill/.test(text)) return 'learning';
  if (/resume score|ats score|resume improve|improve my resume|resume/.test(text)) return text.includes('score') || text.includes('ats') ? 'ats' : 'resume';
  if (/career match|suitable for my career|career fit/.test(text)) return 'career_match';
  if (/career goal|target career/.test(text)) return 'career_goal';
  if (/what skills do i have|my skills|current skills/.test(text)) return 'skills';
  if (/my branch|which branch/.test(text)) return 'branch';
  if (/\b(c\.?g\.?p\.?a|g\.?p\.?a|grade point|grade point average)\b/.test(text)) return 'cgpa';
  if (/what year am i in|which year am i in|my academic year/.test(text)) return 'academic_year';
  if (/my projects|projects do i have/.test(text)) return 'projects';
  if (/my experience|work experience|internships have i done/.test(text)) return 'experience';
  if (/general career|career advice|career guidance|interview/.test(text)) return 'general_career';
  return 'unknown';
}

function opportunityRequiredSkills(opportunity) {
  const value = opportunity.requiredSkills || opportunity.required_skills || opportunity.skillsCovered || opportunity.skills || [];
  const values = Array.isArray(value) ? value : [value];
  return values.flatMap(item => {
    if (item && typeof item === 'object') return [item.skillName || item.name || item.skill || item.title || ''];
    return [item];
  }).map(skill => String(skill || '').trim()).filter(Boolean);
}

function rankChatOpportunities(records, type, student, canonical) {
  return records.map(record => {
    const requiredSkills = opportunityRequiredSkills(record);
    const skillMatch = calc.calculateSkillMatch(canonical.userSkills, requiredSkills);
    const searchText = [record.title, record.name, record.role, record.description, record.domain, record.category, record.career, record.careerGoal, record.company]
      .filter(Boolean).join(' ').toLowerCase();
    const goal = String(canonical.normalizedCareerGoal || canonical.careerGoal || '').toLowerCase();
    const careerGoalMatch = Boolean(goal && searchText.includes(goal));
    const eligibilityMatch = student.cgpa === undefined || student.cgpa === null || Number(student.cgpa) >= Number(record.minCgpa || 0);
    const matchScore = calc.calculateOpportunityMatch({
      studentSkills: canonical.userSkills,
      requiredSkills,
      careerGoalMatch,
      eligibilityMatch,
      projectRelevance: Math.min(100, (student.projects || []).length * 20 + (student.certifications || []).length * 10),
      certRelevance: Math.min(100, (student.certifications || []).length * 25),
      academicRelevance: eligibilityMatch ? 100 : 0,
    });
    return {
      id: record.id,
      title: record.title || record.name || record.role || record.position || 'Opportunity',
      company: record.company || record.organization || record.organizer || record.provider || '',
      type,
      description: record.description || record.details || record.summary || '',
      requiredSkills,
      matchedSkills: skillMatch.matchedSkills,
      missingSkills: skillMatch.missingSkills,
      matchScore,
      deadline: record.deadline || record.applyBy || record.registrationDeadline || record.endDate || '',
      location: record.location || record.city || record.mode || '',
    };
  }).sort((left, right) => right.matchScore - left.matchScore).slice(0, 10);
}

function formatList(values, empty = 'No data is currently available.') {
  return Array.isArray(values) && values.length ? values.map(value => `• ${typeof value === 'object' ? (value.name || value.title || JSON.stringify(value)) : value}`).join('\n') : empty;
}

function usableCgpa(value) {
  if (value === undefined || value === null || String(value).trim() === '') return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? value : null;
}

function educationCgpa(education) {
  const records = Array.isArray(education) ? education : [education];
  for (const record of records) {
    if (!record || typeof record !== 'object') continue;
    const value = usableCgpa(record.cgpa ?? record.CGPA ?? record.gpa ?? record.GPA);
    if (value !== null) return value;
  }
  return null;
}

function resolveStudentCgpa(student, parsedResume) {
  const profileSources = [
    ['student.cgpa', student?.cgpa],
    ['student.CGPA', student?.CGPA],
    ['student.academic.cgpa', student?.academic?.cgpa],
    ['student.education.cgpa', educationCgpa(student?.education)],
  ];
  for (const [source, value] of profileSources) {
    const cgpa = usableCgpa(value);
    if (cgpa !== null) return { value: cgpa, source };
  }

  const resumeSources = [
    ['parsedResume.cgpa', parsedResume?.cgpa],
    ['parsedResume.CGPA', parsedResume?.CGPA],
    ['parsedResume.academic.cgpa', parsedResume?.academic?.cgpa],
    ['parsedResume.education.cgpa', educationCgpa(parsedResume?.education)],
  ];
  for (const [source, value] of resumeSources) {
    const cgpa = usableCgpa(value);
    if (cgpa !== null) return { value: cgpa, source };
  }
  return { value: null, source: 'unavailable' };
}

function deterministicChatReply(intent, student, canonical, knowledge, cgpa) {
  const analysis = student.aiAnalysis || {};
  switch (intent) {
    case 'skillbridge_info':
      return `${knowledge.description}\n\nFeatures include: ${knowledge.features.join(', ')}\n\n${knowledge.tagline}`;
    case 'career_goal':
      return student.careerGoal ? `Your current career goal is ${student.careerGoal}.` : 'Your career goal is not currently available in your SkillBridge profile.';
    case 'skills':
      return `Your current SkillBridge skills are:\n${formatList(canonical.userSkills)}`;
    case 'missing_skills':
      return canonical.missingSkills.length ? `Based on your ${canonical.normalizedCareerGoal || canonical.careerGoal || 'selected career'} path, your missing skills are:\n${formatList(canonical.missingSkills)}` : 'No missing skills are currently available from the canonical career dataset.';
    case 'career_match':
      return canonical.normalizedCareerGoal
        ? `Your matched career is ${canonical.normalizedCareerGoal}. Your current canonical skill match is ${canonical.skillMatchPercentage}%.`
        : 'A canonical career match is not currently available for your profile.';
    case 'ats':
      return Number.isFinite(Number(analysis.resumeScore)) ? `Your current SkillBridge resume score is ${analysis.resumeScore}/100.` : 'A resume score is not currently available in your SkillBridge analysis data.';
    case 'branch':
      return student.branch ? `Your branch is ${student.branch}.` : 'Your branch is not currently available in your SkillBridge profile.';
    case 'cgpa':
      return cgpa !== null ? `Your current CGPA is ${cgpa}.` : "I couldn't find your CGPA in your current SkillBridge profile or parsed resume.";
    case 'academic_year':
      return student.academicYear ? `You are currently in ${student.academicYear}.` : 'Your academic year is not currently available in your SkillBridge profile or parsed resume.';
    case 'projects':
      return `Your saved projects are:\n${formatList(student.projects)}`;
    case 'experience':
      return `Your saved experience is:\n${formatList([...(student.experience || []), ...(student.internships || [])])}`;
    default:
      return null;
  }
}

// ─── POST /api/ai/analyze-resume  (Gemini) ────────────────────────────────────
router.post('/analyze-resume', auth, async (req, res) => {
  try {
    const student = await db.getStudent(req.uid);
    const profile = buildProfile(student, req.body);
    const result  = await gemini.analyzeResume(profile);
    const canonical = await fetchCareerData(student);

    await db.saveAiAnalysis(req.uid, {
      resumeScore:   result.resumeScore,
      atsComponents: result.atsComponents,
      strengths:     result.strengths,
      improvements:  result.improvements,
      missingSkills: canonical.missingSkills,
      matchedSkills: canonical.matchedSkills,
      requiredSkills: canonical.requiredSkills,
      normalizedCareerGoal: canonical.normalizedCareerGoal,
      lastAnalyzed:  new Date(),
    });

    res.json({ success: true, analysis: { ...result, ...canonical }, provider: 'gemini' });
  } catch (err) {
    console.error('[AI/analyze-resume]', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─── POST /api/ai/career-guidance  (Gemini) ───────────────────────────────────
router.post('/career-guidance', auth, async (req, res) => {
  try {
    const student = await db.getStudent(req.uid);
    const profile = buildProfile(student, req.body);
    const result  = await geminiAi.getCareerGuidance(profile);
    const canonical = await fetchCareerData(student);

    await db.saveAiAnalysis(req.uid, {
      skillMatchPercentage:          calc.calculateSkillMatch(canonical.userSkills, canonical.requiredSkills).matchPct,
      overallCareerMatch:            result.overallMatchScore,
      recommendedCareers:            result.topCareers.map(c => c.title),
      topCareers:                    result.topCareers,
      missingSkills: canonical.missingSkills,
      requiredSkills: canonical.requiredSkills,
      normalizedCareerGoal: canonical.normalizedCareerGoal,
      aptitudeLevel:                 result.aptitudeLevel,
      expectedMatchAfterImprovement: result.expectedMatchAfterImprovement,
      lastAnalyzed:                  new Date(),
    });

    res.json({ success: true, guidance: result, provider: 'gemini' });
  } catch (err) {
    console.error('[AI/career-guidance]', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─── POST /api/ai/roadmap  (Gemini) ───────────────────────────────────────────
/**
 * Generate a personalized 6-week learning roadmap based on:
 * 1. Student's career goal
 * 2. Student's missing skills from Firestore
 * 3. Gemini API
 * 
 * Flow:
 * 1. Authenticate Firebase user (req.uid)
 * 2. Get student document from Firestore
 * 3. Get career + skill data from Firestore
 * 4. Validate career goal exists
 * 5. Check missing skills (don't call Gemini if empty)
 * 6. Implement caching (return saved roadmap if career/skills unchanged)
 * 7. Call Gemini to generate roadmap
 * 8. Save roadmapData + roadmapTopics to Firestore
 * 9. Return response
 */
router.post('/roadmap', auth, async (req, res) => {
  try {
    console.log(`[ROADMAP] UID: ${req.uid}`);

    // 1. Get student from Firestore
    const student = await db.getStudent(req.uid);
    if (!student) {
      return res.status(404).json({ success: false, message: 'Student not found' });
    }

    // 2. Get career + skill information from Firestore using careerSkillsService
    const canonical = await fetchCareerData(student);
    const {
      careerGoal,
      matchedCareer,
      userSkills,
      requiredSkills,
      matchedSkills,
      missingSkills,
    } = canonical;
    const profileHash = roadmapProfileHash({ careerGoal, userSkills, requiredSkills, matchedSkills, missingSkills });

    console.log(`[ROADMAP] Student Skills: ${JSON.stringify(userSkills)}`);
    console.log(`[ROADMAP] Career Goal: ${careerGoal}`);
    console.log(`[ROADMAP] Normalized Career: ${matchedCareer?.Career_Name || 'N/A'}`);
    console.log(`[ROADMAP] Required Skills: ${JSON.stringify(requiredSkills)}`);
    console.log(`[ROADMAP] Matched Skills: ${JSON.stringify(matchedSkills)}`);
    console.log(`[ROADMAP] Missing Skills: ${JSON.stringify(missingSkills)}`);
    console.log(`[ROADMAP] Profile Hash: ${profileHash}`);

    // 3. Validate career goal exists
    const normalizedCareerGoal = matchedCareer?.Career_Name || careerGoal;
    if (!careerGoal || careerGoal.trim() === '') {
      return res.status(400).json({
        success: false,
        message: 'Please add a career goal before generating your roadmap.',
      });
    }

    // 4. Check missing skills
    if (!missingSkills || missingSkills.length === 0) {
      console.log('[ROADMAP] Cached Roadmap Valid: false');
      console.log('[ROADMAP] Generating New Roadmap: false');
      await db.updateStudent(req.uid, {
        roadmapData: null,
        roadmapTopics: [],
        roadmapCareerGoal: normalizedCareerGoal,
        roadmapMissingSkills: [],
        roadmapUserSkills: userSkills,
        roadmapRequiredSkills: requiredSkills,
        roadmapMatchedSkills: matchedSkills,
        roadmapProfileHash: profileHash,
        roadmapCompletedTopics: 0,
        roadmapGeneratedAt: FieldValue.serverTimestamp(),
      });
      return res.json({
        success: true,
        roadmap: null,
        message: 'You already have all required skills for this career.',
        careerGoal: normalizedCareerGoal,
        missingSkills: [],
        totalTopics: 0,
        provider: 'none',
        roadmapProfileHash: profileHash,
      });
    }

    // 5. Implement caching: check if saved roadmap is still valid
    const cachedValid = Boolean(student.roadmapData && student.roadmapProfileHash === profileHash);
    console.log(`[ROADMAP] Cached Roadmap Valid: ${cachedValid}`);
    if (cachedValid) {
      console.log('[ROADMAP] Generating New Roadmap: false');
      const allTopics = (student.roadmapData.weeks || []).flatMap(w =>
        (w.topics || []).map(t => ({
          id: t.id,
          name: t.name,
          hours: t.hours,
          resource: t.resource,
          tag: t.tag,
          week: w.week,
          skill: t.skill,
          completed: Boolean(t.completed),
        }))
      );
      return res.json({
        success: true,
        roadmap: student.roadmapData,
        careerGoal: normalizedCareerGoal,
        missingSkills,
        totalTopics: allTopics.length,
        provider: 'cached',
        roadmapProfileHash: profileHash,
      });
    }

    // 6. Build Gemini input using canonical Firestore data
    const roadmapProfile = {
      name: student.name || 'Student',
      branch: student.branch || '',
      academicYear: student.academicYear || '',
      cgpa: student.cgpa || '',
      careerGoal,
      normalizedCareerGoal,
      userSkills,
      requiredSkills,
      matchedSkills,
      missingSkills,
      skillMatchPercentage: canonical.skillMatchPercentage,
    };

    // 7. Call Gemini to generate roadmap
    console.log('[ROADMAP] Generating New Roadmap: true');
    const geminiResult = await geminiAi.generateRoadmap(roadmapProfile);
    const validated = validateRoadmap(geminiResult, missingSkills);
    console.log(`[ROADMAP] Validated Topics: ${validated.validatedTopics}`);
    console.log(`[ROADMAP] Removed Invalid Topics: ${validated.removedTopics}`);
    const validatedRoadmap = validated.roadmap;

    // 8. Flatten topics for Firestore storage
    const allTopics = (validatedRoadmap.weeks || []).flatMap(week =>
      (week.topics || []).map(topic => ({
        id: topic.id,
        name: topic.name,
        hours: topic.hours || 0,
        resource: topic.resource || '',
        tag: topic.tag || '',
        skill: topic.skill || '',
        week: week.week,
        completed: Boolean(topic.completed),
      }))
    );

    console.log(`[ROADMAP] Total Topics: ${allTopics.length}`);

    // 9. Save roadmapData and roadmapTopics to Firestore
    await db.updateStudent(req.uid, {
      roadmapData: validatedRoadmap,
      roadmapTopics: allTopics,
      roadmapCompletedTopics: 0,
      roadmapCareerGoal: normalizedCareerGoal,
      roadmapMissingSkills: missingSkills,
      roadmapUserSkills: userSkills,
      roadmapRequiredSkills: requiredSkills,
      roadmapMatchedSkills: matchedSkills,
      roadmapProfileHash: profileHash,
      roadmapGeneratedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });

    // 10. Return response
    res.json({
      success: true,
      roadmap: validatedRoadmap,
      careerGoal: normalizedCareerGoal,
      missingSkills,
      totalTopics: allTopics.length,
      provider: 'gemini',
      roadmapProfileHash: profileHash,
    });

  } catch (err) {
    console.error('[AI/roadmap]', err.message);
    res.status(500).json({
      success: false,
      message: 'Unable to generate your personalized roadmap right now. Please try again.',
      error: err.message,
    });
  }
});

// ─── POST /api/ai/chat  (Gemini) ──────────────────────────────────────────────
router.post('/chat', auth, async (req, res) => {
  try {
    const { message, history = [] } = req.body;
    if (!message) return res.status(400).json({ message: 'message is required' });

    console.log(`[CHAT] UID: ${req.uid}`);
    const student = await db.getStudent(req.uid);
    if (!student) return res.status(404).json({ success: false, code: 'STUDENT_DATA_UNAVAILABLE', message: 'SkillBridge data is temporarily unavailable.' });
    console.log('[CHAT] Student found:', Boolean(student));
    const intent = detectChatIntent(message);
    console.log('[CHAT] Intent:', intent);

    if (intent === 'cgpa') {
      const resume = await safeGetResume(req.uid);
      const cgpaResult = resolveStudentCgpa(student, resume);
      console.log('[CHAT] Student CGPA:', student?.cgpa);
      console.log('[CHAT] Resume CGPA:', resume?.cgpa);
      console.log('[CHAT] Final CGPA:', cgpaResult.value);
      console.log('[CHAT] CGPA source:', cgpaResult.source);

      return res.json({
        success: true,
        reply: cgpaResult.value !== null
          ? `Your current CGPA is ${cgpaResult.value}.`
          : "I couldn't find your CGPA in your current SkillBridge profile or parsed resume.",
        provider: 'skillbridge-data',
        intent: 'cgpa',
      });
    }

    const [resume, canonical] = await Promise.all([
      safeGetResume(req.uid),
      fetchCareerData(student),
    ]);
    const cgpaResult = resolveStudentCgpa(student, resume);
    const chatbotContext = {
      name: student?.name || resume?.name || '',
      email: student?.email || resume?.email || '',
      branch: student?.branch || resume?.branch || '',
      academicYear: student?.academicYear || resume?.academicYear || '',
      college: student?.college || '',
      cgpa: cgpaResult.value,
      skills: student?.skills || resume?.skills || [],
      projects: student?.projects || resume?.projects || [],
      certifications: student?.certifications || resume?.certifications || [],
      experience: student?.experience || resume?.experience || [],
      internships: student?.internships || resume?.internships || [],
      achievements: student?.achievements || resume?.achievements || [],
      interests: student?.interests || resume?.interests || [],
      careerGoal: student?.careerGoal || '',
      bio: student?.bio || '',
      aiAnalysis: student?.aiAnalysis || {},
      roadmapData: student?.roadmapData || null,
      roadmapTopics: student?.roadmapTopics || [],
      roadmapCareerGoal: student?.roadmapCareerGoal || '',
      roadmapMissingSkills: student?.roadmapMissingSkills || [],
      roadmapUserSkills: student?.roadmapUserSkills || [],
      roadmapRequiredSkills: student?.roadmapRequiredSkills || [],
      roadmapMatchedSkills: student?.roadmapMatchedSkills || [],
      roadmapCompletedTopics: student?.roadmapCompletedTopics || 0,
    };
    console.log('[CHAT] Student found:', !!student);
    console.log('[CHAT] Parsed resume found:', !!resume);
    console.log('[CHAT] Career Goal:', chatbotContext.careerGoal);
    console.log('[CHAT] Skills:', chatbotContext.skills);
    console.log('[CHAT] Message:', message);
    console.log('[CHAT] Required skills:', JSON.stringify(canonical.requiredSkills));
    console.log('[CHAT] Missing skills:', JSON.stringify(canonical.missingSkills));

    const knowledge = getKnowledgeContext();
    const directReply = deterministicChatReply(intent, chatbotContext, canonical, knowledge, cgpaResult.value);
    if (directReply) return res.json({ success: true, reply: directReply, provider: 'skillbridge-data', intent });

    let opportunities = [];
    const collectionMap = {
      jobs: 'jobs', internships: 'internships', placements: 'placements',
      competitions: 'competitions', certifications: 'freeCertificates',
    };
    if (collectionMap[intent]) {
      const records = await db.getCollection(collectionMap[intent], { isActive: true });
      opportunities = rankChatOpportunities(records, intent, student, canonical);
      console.log(`[CHAT] Context sources: ${collectionMap[intent]} (${opportunities.length} records)`);
      if (!opportunities.length) {
        return res.json({ success: true, reply: `No matching ${intent === 'certifications' ? 'free certification' : intent} was found in the current SkillBridge database.`, provider: 'firestore+calc', intent });
      }
    }

    const chatContext = {
      knowledge,
      student: chatbotContext,
      resumeParsed: resume || null,
      canonicalCareer: {
        careerGoal: canonical.careerGoal, normalizedCareerGoal: canonical.normalizedCareerGoal,
        matchedCareer: canonical.matchedCareer || null, matchedCareerId: canonical.matchedCareerId || null,
        userSkills: canonical.userSkills, requiredSkills: canonical.requiredSkills,
        matchedSkills: canonical.matchedSkills, missingSkills: canonical.missingSkills,
        skillMatchPercentage: canonical.skillMatchPercentage,
      },
      opportunities,
    };

    console.log('[CHAT] Context sources: knowledge, student, resume, canonical career, analysis, roadmap' + (opportunities.length ? ', opportunities' : ''));
    console.log('[CHAT] Gemini request:', intent);
    const reply = await geminiAi.careerChat(message, history, chatContext);
    console.log('[CHAT] Gemini response generated: true');
    res.json({ success: true, reply, provider: 'gemini', intent });
  } catch (err) {
    console.error('[AI/chat]', err.message);
    res.status(503).json({ success: false, code: 'STUDENT_DATA_UNAVAILABLE', message: 'SkillBridge data is temporarily unavailable.' });
  }
});

// ─── POST /api/ai/skill-gap  (Gemini) ────────────────────────────────────────
router.post('/skill-gap', auth, async (req, res) => {
  try {
    const student = await db.getStudent(req.uid);
    const profile = buildProfile(student, req.body);

    // Fetch required skills from Firestore careers + skills collections
    const canonical = await fetchCareerData(student);

    // Gemini provides qualitative analysis; numbers are from calculationService
    const result  = await gemini.analyzeSkillGap(profile, canonical.requiredSkills);

    res.json({ success: true, skillGap: { ...result, ...canonical }, provider: 'gemini' });
  } catch (err) {
    console.error('[AI/skill-gap]', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─── POST /api/ai/opportunities  (Gemini + Firestore) ────────────────────────
router.post('/opportunities', auth, async (req, res) => {
  try {
    const { type = 'jobs' } = req.body;
    const student = await db.getStudent(req.uid);
    const profile = buildProfile(student, req.body);

    // Load from the correct Firestore reference collection
    const collectionMap = {
      jobs: 'jobs',
      internships: 'internships',
      placements: 'placements',
      competitions: 'competitions',
      freeCertificates: 'freeCertificates',
    };
    const collName = collectionMap[type];
    if (!collName) return res.status(400).json({ message: `Unknown type: ${type}` });

    const firestoreOpps = await db.getCollection(collName, { isActive: true });

    if (firestoreOpps.length === 0) {
      return res.json({ success: true, opportunities: [], type, provider: 'firestore' });
    }

    let opportunities;
    try {
      opportunities = await gemini.getOpportunityRecommendations(profile, firestoreOpps, type);
    } catch (aiError) {
      console.error('[AI/opportunities] Gemini unavailable:', aiError.message);
      opportunities = firestoreOpps.map(opportunity => {
        const requiredSkills = opportunity.requiredSkills || opportunity.skills || opportunity.skillsCovered || [];
        const { matchPct, matchedSkills, missingSkills } = calc.calculateSkillMatch(profile.skills, requiredSkills);
        return {
          ...opportunity,
          matchScore: matchPct,
          matchedSkills,
          missingSkills,
          matchComponents: { careerGoalMatch: false, eligibilityMatch: false, skillMatch: matchedSkills.length > 0 },
          reasons: matchedSkills.length ? [`${matchedSkills.slice(0, 3).join(', ')} match your listed skills.`] : [],
          whyThis: '',
          type,
        };
      });
    }

    res.json({ success: true, opportunities, type, provider: 'gemini+calc' });
  } catch (err) {
    console.error('[AI/opportunities]', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─── POST /api/ai/career-analysis  (Gemini + Firestore) ──────────────────────
router.post('/career-analysis', auth, async (req, res) => {
  try {
    const student = await db.getStudent(req.uid);
    const profile = buildProfile(student, req.body);

    // Fetch career reference data from Firestore careers + skills collections
    const canonical = await fetchCareerData(student);
    const { careerRecord, requiredSkills, normalizedCareerGoal } = canonical;

    let result = {};
    try {
      result = await gemini.getCareerAnalysis(profile, careerRecord, requiredSkills);
    } catch (aiError) {
      console.error('[AI/career-analysis] qualitative analysis unavailable:', aiError.message);
    }

    if (normalizedCareerGoal) {
      await db.updateStudent(req.uid, { normalizedCareerGoal });
    }

    await db.saveAiAnalysis(req.uid, {
      overallCareerMatch:            result.overallCareerMatch || 0,
      skillMatchPercentage:          result.skillMatchScore || calc.calculateSkillMatch(canonical.userSkills, requiredSkills).matchPct,
      expectedMatchAfterImprovement: result.expectedMatchAfterImprovement ?? result.overallCareerMatch ?? 0,
      aptitudeLevel:                 result.aptitudeLevel || 'Beginner',
      missingSkills:                 canonical.missingSkills,
      matchedSkills:                 canonical.matchedSkills,
      userSkills:                    canonical.userSkills,
      requiredSkills,
      normalizedCareerGoal,
      lastAnalyzed:                  new Date(),
    });

    res.json({ success: true, analysis: { ...result, ...canonical }, provider: result.overallCareerMatch ? 'gemini+calc' : 'firestore+calc' });
  } catch (err) {
    console.error('[AI/career-analysis]', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─── POST /api/ai/explain-match  (Gemini Explainable AI) ─────────────────────
router.post('/explain-match', auth, async (req, res) => {
  try {
    const { opportunityId, opportunityType = 'jobs' } = req.body;
    if (!opportunityId) return res.status(400).json({ message: 'opportunityId is required' });

    const student = await db.getStudent(req.uid);
    const profile = buildProfile(student);

    // Fetch the specific opportunity from Firestore reference collection
    const collectionMap = {
      jobs: 'jobs', internships: 'internships', placements: 'placements',
      competitions: 'competitions', freeCertificates: 'freeCertificates',
    };
    const collName = collectionMap[opportunityType];
    if (!collName) return res.status(400).json({ message: `Unknown opportunityType: ${opportunityType}` });

    const opportunity = await db.getDocById(collName, opportunityId);
    if (!opportunity) return res.status(404).json({ message: 'Opportunity not found' });

    const requiredSkills = opportunity.requiredSkills || opportunity.skills || [];
    const { matchPct: matchScore, matchedSkills, missingSkills } = calc.calculateSkillMatch(
      profile.skills, requiredSkills
    );

    const reasons = await gemini.explainMatch(profile, opportunity, matchScore, matchedSkills, missingSkills);

    res.json({ success: true, reasons, matchScore, matchedSkills, missingSkills });
  } catch (err) {
    console.error('[AI/explain-match]', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─── POST /api/ai/content  (Gemini) ──────────────────────────────────────────
router.post('/content', auth, async (req, res) => {
  try {
    const { type } = req.body;
    if (!type) return res.status(400).json({ message: 'type is required' });
    const student = await db.getStudent(req.uid);
    const profile = buildProfile(student, req.body);
    const content = await gemini.generateContent(type, profile);
    res.json({ success: true, content, type, provider: 'gemini' });
  } catch (err) {
    console.error('[AI/content]', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─── POST /api/ai/interview-questions  (Gemini) ───────────────────────────────
router.post('/interview-questions', auth, async (req, res) => {
  try {
    const student   = await db.getStudent(req.uid);
    const profile   = buildProfile(student, req.body);
    const questions = await gemini.generateInterviewQuestions(profile);
    res.json({ success: true, questions, provider: 'gemini' });
  } catch (err) {
    console.error('[AI/interview-questions]', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ─── POST /api/ai/full-analysis  (Gemini services in parallel) ──────────────
router.post('/full-analysis', auth, async (req, res) => {
  try {
    const student = await db.getStudent(req.uid);
    if (!student.skills || student.skills.length === 0) {
      return res.status(400).json({ message: 'Please add skills before running full analysis.' });
    }

    const profile = buildProfile(student, req.body);
    const canonical = await fetchCareerData(student);
    const { careerRecord, requiredSkills, normalizedCareerGoal } = canonical;

    // Run Gemini services in parallel
    const [resumeResult, guidanceResult, careerResult, suggResult] = await Promise.allSettled([
      geminiAi.analyzeResume(profile),
      geminiAi.getCareerGuidance(profile),
      gemini.getCareerAnalysis(profile, careerRecord, requiredSkills),
      geminiAi.getResumeSuggestions(profile),
    ]);

    const resume   = resumeResult.status   === 'fulfilled' ? resumeResult.value   : null;
    const guidance = guidanceResult.status === 'fulfilled' ? guidanceResult.value : null;
    const career   = careerResult.status   === 'fulfilled' ? careerResult.value   : null;
    const suggs    = suggResult.status     === 'fulfilled' ? suggResult.value     : [];

    const merged = {
      resumeScore:                   resume?.resumeScore || 0,
      atsComponents:                 resume?.atsComponents || {},
      skillMatchPercentage:          career?.skillMatchScore || 0,
      overallCareerMatch:            career?.overallCareerMatch || guidance?.overallMatchScore || 0,
      expectedMatchAfterImprovement: career?.expectedMatchAfterImprovement || guidance?.expectedMatchAfterImprovement || 0,
      recommendedCareers:            guidance?.topCareers?.map(c => c.title) || [],
      topCareers:                    guidance?.topCareers || [],
      requiredSkills,
      normalizedCareerGoal,
      careerGoal:                     canonical.careerGoal,
      matchedCareer:                  canonical.matchedCareer,
      userSkills:                     canonical.userSkills,
      matchedSkills:                  canonical.matchedSkills,
      missingSkills:                  canonical.missingSkills,
      strengths:                     resume?.strengths || [],
      improvements:                  resume?.improvements || [],
      suggestions:                   suggs || [],
      aptitudeLevel:                 guidance?.aptitudeLevel || career?.aptitudeLevel || 'Beginner',
      lastAnalyzed:                  new Date(),
    };

    await db.saveAiAnalysis(req.uid, merged);

    res.json({
      success:   true,
      analysis:  merged,
      raw:       { resume, guidance, career, suggestions: suggs },
      providers: { resume: 'gemini', guidance: 'gemini', career: 'gemini', calculations: 'calculationService' },
    });
  } catch (err) {
    console.error('[AI/full-analysis]', err.message);
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
