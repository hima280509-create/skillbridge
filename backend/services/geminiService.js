/**
 * SkillBridge – Google Gemini Service
 * Responsibilities: Skill Analysis, Skill Gap Analysis, Opportunity Recommendations,
 *                   Career Analysis, Explainable AI, Qualitative reasoning,
 *                   Future improvement analysis
 *
 * IMPORTANT: Gemini returns component scores and qualitative analysis only.
 * Final numerical scores are calculated by calculationService.
 * Gemini must NEVER return an arbitrary final percentage.
 */

const { GoogleGenAI } = require('@google/genai');
const calc = require('./calculationService');

let _genAI = null;
function getClient() {
  if (!_genAI) {
    if (!process.env.GEMINI_API_KEY) throw new Error('GEMINI_API_KEY not set in environment');
    _genAI = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  }
  return _genAI;
}

const MODEL_NAME = process.env.GEMINI_MODEL || 'gemini-3.6-flash';

function normalizeGeminiError(error) {
  const message = String(error?.message || '').toLowerCase();
  const status = Number(error?.status || error?.code || 0);
  if (status === 429 || message.includes('quota') || message.includes('resource exhausted')) return new Error('Gemini API request failed: quota or rate limit exceeded');
  if (status === 401 || status === 403 || message.includes('api key') || message.includes('permission')) return new Error('Gemini API request failed: authentication or permission error');
  if (status === 400) return new Error('Gemini API request failed: invalid request');
  if (message.includes('timeout') || message.includes('timed out')) return new Error('Gemini API request failed: request timed out');
  return new Error('Gemini API request failed');
}

function safeParseJSON(text) {
  try {
    const clean = text.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
    return JSON.parse(clean);
  } catch {
    const match = text.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
    if (match) { try { return JSON.parse(match[0]); } catch { return null; } }
    return null;
  }
}

async function generate(prompt) {
  try {
    const result = await getClient().models.generateContent({
      model: MODEL_NAME,
      contents: prompt,
    });
    const text = result.text;
    if (!text || !String(text).trim()) throw new Error('empty response');
    return String(text).trim();
  } catch (error) {
    throw normalizeGeminiError(error);
  }
}

function is429Error(error) {
  return Boolean(error && (
    error.status === 429 ||
    error.code === 429 ||
    error.message?.includes('429') ||
    error.message?.toLowerCase().includes('resource exhausted') ||
    error.message?.toLowerCase().includes('quota')
  ));
}

async function resolveCareerGoal(careerGoal, careers = []) {
  if (!careerGoal || !careers.length) return null;
  const options = careers.map(c => ({
    id: c.id,
    name: c.careerTitle || c.Career_Name || c.careerName || c.name || '',
  })).filter(c => c.name);
  const prompt = `Match the student's free-text career goal to the single most semantically relevant career from this Firestore list. Never invent a career. Return ONLY JSON: {"careerId":"", "careerName":""}. If no reasonable match exists, return empty values.
Student goal: ${careerGoal}
Firestore careers:
${JSON.stringify(options)}`;

  try {
    const parsed = safeParseJSON(await generate(prompt));
    if (!parsed?.careerId && !parsed?.careerName) return null;
    return options.find(c => String(c.id) === String(parsed.careerId) || c.name.toLowerCase() === String(parsed.careerName || '').toLowerCase()) || null;
  } catch (error) {
    if (is429Error(error)) {
      console.warn('[AI GEMINI CALL] Career-goal resolution failed with 429; falling back to Firestore-only resolution.');
    }
    return null;
  }
}

async function generateBundledAnalysis({ profileData, careerRecord = {}, requiredSkills = [], selectedSections = ['resumeAnalysis', 'careerAnalysis', 'skillGapAnalysis'] } = {}) {
  const requestedSections = Array.isArray(selectedSections) && selectedSections.length ? selectedSections : ['resumeAnalysis', 'careerAnalysis', 'skillGapAnalysis'];
  const sections = new Set(requestedSections);
  const prompt = `You are SkillBridge's qualitative analysis engine. Return only valid JSON matching the requested sections. Do not compute final numerical scores. All final percentages are computed by calculationService in the app. Use only the actual provided student and Firestore data.

STUDENT PROFILE:
${JSON.stringify(profileData, null, 2)}

TARGET CAREER (Firestore):
${JSON.stringify(careerRecord, null, 2)}

REQUIRED SKILLS:
${(requiredSkills || []).join(', ') || 'none'}

Return JSON object with only these keys if requested: ${[...sections].join(', ')}

Each section should contain only qualitative data. Example structure:
{
  "resumeAnalysis": {
    "atsComponents": {"structureScore": 80, "skillsRelevanceScore": 75, "keywordScore": 78, "projectScore": 70, "certificationScore": 65, "experienceScore": 60, "industryRelevanceScore": 72},
    "strengths": ["..."],
    "improvements": ["..."],
    "keywords": ["..."],
    "overallFeedback": "..."
  },
  "careerAnalysis": {
    "matchComponents": {"resumeSkillRelevance": 80, "projectRelevance": 75, "branchRelevance": 85, "experienceRelevance": 60, "academicRelevance": 82},
    "futureMatchComponents": {"skillMatchScore": 85, "resumeSkillRelevance": 80, "projectRelevance": 75, "branchRelevance": 85, "experienceRelevance": 60, "academicRelevance": 82},
    "aptitudeLevel": "Medium",
    "industryTrends": "...",
    "actionPlan": {"immediate": ["..."], "shortTerm": ["..."], "longTerm": ["..."]},
    "topCompanies": ["..."],
    "avgSalary": "INR 8-15 LPA",
    "timeToJobReady": "4-6 months",
    "careerPathExplanation": "..."
  },
  "skillGapAnalysis": {
    "currentSkillLevel": "Intermediate",
    "strongSkills": [{"skill": "Python", "level": "Intermediate", "marketDemand": "High"}],
    "missingCriticalSkills": [{"skill": "SQL", "importance": "Critical", "learnIn": "2 weeks", "freeResource": "https://example.com"}],
    "skillsByCategory": {"Programming": {"have": ["Python"], "missing": ["SQL"]}},
    "timeToClose": "6 weeks",
    "priorityLearningPath": ["SQL", "System Design"],
    "explanation": "..."
  }
}

Return ONLY valid JSON, no markdown, no extra text.`;

  try {
    const raw = await generate(prompt);
    const parsed = safeParseJSON(raw);
    if (!parsed || typeof parsed !== 'object') return {};
    const result = {};
    for (const key of sections) {
      if (parsed[key]) result[key] = parsed[key];
    }
    return result;
  } catch (error) {
    if (is429Error(error)) {
      console.warn('[AI 429 FALLBACK] Bundled analysis unavailable; returning deterministic results only.');
    }
    return {};
  }
}

// ─── 1. Opportunity Recommendations ──────────────────────────────────────────
/**
 * Recommend opportunities from Firestore data with match score components.
 * Final matchScore is calculated by calculationService.calculateOpportunityMatch().
 *
 * @param {object} profileData
 * @param {Array}  firestoreOpportunities  array of records from the relevant Firestore collection
 * @param {string} type  'jobs' | 'internships' | 'placements' | 'competitions' | 'freeCertificates'
 * @returns {Array}
 */
async function getOpportunityRecommendations(profileData, firestoreOpportunities = [], type = 'jobs') {
  // If Firestore data available, rank them; otherwise ask Gemini to describe reasons only
  const prompt = `You are an AI career advisor for engineering students in India.
You must NOT invent the final match percentage. You will receive opportunity data and return component scores only.
The final match score will be calculated by the application.

STUDENT PROFILE:
Name: ${profileData.name}
Branch: ${profileData.branch}
Year: ${profileData.academicYear}
CGPA: ${profileData.cgpa}
Skills: ${(profileData.skills || []).join(', ')}
Career Goal: ${profileData.careerGoal}
Projects: ${(profileData.projects || []).map(p => p.title || p.name).join(', ')}
Certifications: ${(profileData.certifications || []).map(c => c.name).join(', ')}

OPPORTUNITIES (from ${type} collection):
${JSON.stringify(firestoreOpportunities.slice(0, 20), null, 2)}

For EACH opportunity above, return a JSON array with ONLY:
{
  "opportunityId": "<_id or title>",
  "matchComponents": {
    "careerGoalMatch": <true|false — does it align with the student's career goal?>,
    "eligibilityMatch": <true|false — does student meet eligibility requirements?>,
    "projectRelevance": <0-100>,
    "certRelevance": <0-100>,
    "academicRelevance": <0-100>
  },
  "reasons": ["<specific reason referencing actual student data>", "<reason2>", "<reason3>"],
  "whyThis": "<1 sentence personalised explanation>"
}

Return ONLY a valid JSON array of objects with the same length as the input opportunities.`;

  const raw     = await generate(prompt);
  const aiRanks = safeParseJSON(raw);
  const aiById = new Map((Array.isArray(aiRanks) ? aiRanks : []).map(item => [String(item.opportunityId || ''), item]));

  // Build final results by merging Firestore data + AI components + calculated score
  const results = firestoreOpportunities.slice(0, 20).map((opp, idx) => {
    const aiData = aiById.get(String(opp.id || opp._id || opp.title || '')) || (Array.isArray(aiRanks) ? (aiRanks[idx] || {}) : {});
    const components = aiData.matchComponents || {};
    const requiredSkills = opp.requiredSkills || opp.skills || [];

    const matchScore = calc.calculateOpportunityMatch({
      studentSkills:    profileData.skills || [],
      requiredSkills,
      careerGoalMatch:  components.careerGoalMatch  === true,
      eligibilityMatch: components.eligibilityMatch === true,
      projectRelevance:  components.projectRelevance  || 0,
      certRelevance:     components.certRelevance     || 0,
      academicRelevance: components.academicRelevance || 0,
    });

    const { matchedSkills, missingSkills } = calc.calculateSkillMatch(
      profileData.skills || [],
      requiredSkills
    );

    const fallbackReasons = [];
    if (matchedSkills.length) fallbackReasons.push(`${matchedSkills.slice(0, 3).join(', ')} match your listed skills.`);
    if (missingSkills.length) fallbackReasons.push(`${missingSkills.slice(0, 3).join(', ')} are not yet in your profile.`);
    if (components.careerGoalMatch === true) fallbackReasons.push('This opportunity aligns with your career goal.');
    if (components.eligibilityMatch === true) fallbackReasons.push('Your academic profile meets the available eligibility information.');

    return {
      ...opp,
      matchScore,
      matchComponents: {
        careerGoalMatch: components.careerGoalMatch === true,
        eligibilityMatch: components.eligibilityMatch === true,
        skillMatch: matchedSkills.length > 0,
      },
      matchedSkills,
      missingSkills,
      reasons:   Array.isArray(aiData.reasons) && aiData.reasons.length ? aiData.reasons : fallbackReasons,
      whyThis:   aiData.whyThis  || '',
      type,
    };
  });

  // Sort by calculated match score descending
  results.sort((a, b) => b.matchScore - a.matchScore);
  return results;
}

// ─── 2. Skill Gap Analysis ────────────────────────────────────────────────────
/**
 * Qualitative skill gap analysis using Gemini.
 * Returns component data; numerical skill gap % is calculated by calculationService.
 *
 * @param {object} profileData
 * @param {string[]} requiredSkills  from Firestore skills collection for career goal
 * @returns {object}
 */
async function analyzeSkillGap(profileData, requiredSkills = []) {
  // Calculate numerical gap first (no AI needed for the numbers)
  const { gapPct, matchPct, matchedSkills, missingSkills } = calc.calculateSkillGap(
    profileData.skills || [],
    requiredSkills
  );

  const skillsByCategory = {};
  // Category breakdown can be passed in from the Firestore query

  const prompt = `You are a technical skill assessor for engineering careers.
Provide qualitative skill gap analysis — do NOT invent numerical scores.

STUDENT PROFILE:
${JSON.stringify(profileData, null, 2)}

CAREER GOAL REQUIRED SKILLS: ${requiredSkills.join(', ')}
SKILLS STUDENT HAS: ${matchedSkills.join(', ') || 'none'}
SKILLS STUDENT IS MISSING: ${missingSkills.join(', ') || 'none'}

Return ONLY valid JSON:
{
  "currentSkillLevel": "<Beginner|Intermediate|Advanced>",
  "strongSkills": [{"skill": "<name>", "level": "<Beginner|Intermediate|Advanced>", "marketDemand": "<High|Medium|Low>"}],
  "missingCriticalSkills": [{"skill": "<name>", "importance": "<Critical|Important|Nice-to-have>", "learnIn": "<estimate>", "freeResource": "<url>"}],
  "skillsByCategory": {
    "<category>": {"have": ["<skill>"], "missing": ["<skill>"]}
  },
  "timeToClose": "<estimated time>",
  "priorityLearningPath": ["<skill1 — most critical>", "<skill2>", "<skill3>"],
  "explanation": "<2-3 sentences explaining the gap using only the actual missing/present skills>"
}`;

  try {
    const raw    = await generate(prompt);
    const parsed = safeParseJSON(raw);
    if (!parsed) throw new Error('Gemini returned non-JSON for skill gap');

    return {
      ...parsed,
      gapPct,
      matchPct,
      matchedSkills,
      missingSkills,
      requiredSkills,
    };
  } catch (error) {
    if (is429Error(error)) {
      console.warn('[AI 429 FALLBACK] Skill gap analysis unavailable; using deterministic calculation only.');
    }
    return {
      gapPct,
      matchPct,
      matchedSkills,
      missingSkills,
      requiredSkills,
      explanation: 'Skill gap computed deterministically from your current profile and the required Firestore skills.',
    };
  }
}

// ─── Resume Analysis ─────────────────────────────────────────────────────────
async function analyzeResume(profileData) {
  const prompt = `You are an expert ATS resume evaluator for engineering students.
Respond with ONLY valid JSON. Return component scores only; do not calculate a final score.

STUDENT PROFILE:
${JSON.stringify(profileData, null, 2)}

Return exactly this JSON. Base every value on the supplied student data:
{
  "atsComponents": {
    "structureScore": 0,
    "skillsRelevanceScore": 0,
    "keywordScore": 0,
    "projectScore": 0,
    "certificationScore": 0,
    "experienceScore": 0,
    "industryRelevanceScore": 0
  },
  "strengths": [],
  "improvements": [],
  "keywords": [],
  "overallFeedback": ""
}
Use integer scores from 0 to 100. Do not invent resume content or required skills.`;

  try {
    const parsed = safeParseJSON(await generate(prompt));
    if (!parsed || !parsed.atsComponents) throw new Error('Gemini returned invalid JSON for resume analysis');

    parsed.atsComponents.experienceScore = calc.calculateExperienceScore(
      profileData.experience,
      profileData.careerGoal || profileData.normalizedCareerGoal
    );
    const resumeScore = calc.calculateATSScore(parsed.atsComponents);
    return {
      ...parsed,
      resumeScore,
      grade: resumeScore >= 80 ? 'Excellent' : resumeScore >= 60 ? 'Good' : resumeScore >= 40 ? 'Average' : 'Needs Work',
    };
  } catch (error) {
    if (is429Error(error)) {
      console.warn('[AI 429 FALLBACK] Resume analysis unavailable; using Firestore-only calculations.');
    }
    const atsComponents = calc.estimateATSComponentsFromProfile(profileData);
    const fallback = calc.calculateATSScore(atsComponents);
    return {
      atsComponents,
      strengths: ['Technical profile is present and well organized.'],
      improvements: ['Add more measurable project outcomes and certifications.'],
      keywords: profileData.skills || [],
      overallFeedback: 'Profile is complete enough for deterministic scoring while Gemini remains unavailable.',
      resumeScore: fallback,
      grade: fallback >= 80 ? 'Excellent' : fallback >= 60 ? 'Good' : fallback >= 40 ? 'Average' : 'Needs Work',
    };
  }
}

// ─── 3. Career Analysis ───────────────────────────────────────────────────────
/**
 * Deep career analysis. Returns component scores.
 * Final Overall Career Match is calculated by calculationService.calculateOverallMatch().
 *
 * @param {object} profileData
 * @param {object} careerRecord  from Firestore careers collection
 * @param {string[]} requiredSkills  from Firestore skills collection
 * @returns {object}
 */
async function getCareerAnalysis(profileData, careerRecord = {}, requiredSkills = []) {
  const { matchPct: skillMatchScore, matchedSkills, missingSkills } = calc.calculateSkillMatch(
    profileData.skills || [],
    requiredSkills
  );

  const prompt = `You are a senior career counsellor for engineering students in India.
Provide detailed career analysis. Do NOT invent final percentages — return component scores only.

STUDENT PROFILE:
${JSON.stringify(profileData, null, 2)}

TARGET CAREER (from Firestore):
${JSON.stringify(careerRecord, null, 2)}

REQUIRED SKILLS FOR THIS CAREER: ${requiredSkills.join(', ')}
SKILLS STUDENT HAS: ${matchedSkills.join(', ') || 'none'}
SKILLS STUDENT IS MISSING: ${missingSkills.join(', ') || 'none'}

Return ONLY valid JSON with component scores (0-100 each):
{
  "matchComponents": {
    "resumeSkillRelevance": <0-100 — how relevant the student's skills are for resume>,
    "projectRelevance": <0-100 — how relevant student's projects are>,
    "branchRelevance": <0-100 — how well student's branch aligns>,
    "experienceRelevance": <0-100 — how relevant work experience is>,
    "academicRelevance": <0-100 — how well academic background matches>
  },
  "futureMatchComponents": {
    "skillMatchScore": <0-100 — expected skill match after learning missing skills>,
    "resumeSkillRelevance": <0-100>,
    "projectRelevance": <0-100>,
    "branchRelevance": <0-100>,
    "experienceRelevance": <0-100>,
    "academicRelevance": <0-100>
  },
  "aptitudeLevel": "<Beginner|Medium|Advanced>",
  "industryTrends": "<2-sentence current market insight>",
  "actionPlan": {
    "immediate": ["<action this week>", "<action2>"],
    "shortTerm": ["<action this month>", "<action2>"],
    "longTerm": ["<action 3-6 months>", "<action2>"]
  },
  "topCompanies": ["<company1>", "<company2>", "<company3>"],
  "avgSalary": "<INR range>",
  "timeToJobReady": "<months>",
  "careerPathExplanation": "<2-3 sentences explaining match using actual data>"
}`;

  try {
    const raw    = await generate(prompt);
    const parsed = safeParseJSON(raw);
    if (!parsed) throw new Error('Gemini returned non-JSON for career analysis');

    const overallCareerMatch = calc.calculateOverallMatch({
      skillMatchScore,
      ...( parsed.matchComponents || {} ),
    });

    const expectedMatchAfterImprovement = parsed.futureMatchComponents
      ? calc.calculateExpectedMatchAfterImprovement({
          skillMatchScore: parsed.futureMatchComponents.skillMatchScore || skillMatchScore,
          ...parsed.futureMatchComponents,
        })
      : overallCareerMatch;

    return {
      ...parsed,
      overallCareerMatch,
      expectedMatchAfterImprovement,
      skillMatchScore,
      matchedSkills,
      missingSkills,
      requiredSkills,
    };
  } catch (error) {
    if (is429Error(error)) {
      console.warn('[AI 429 FALLBACK] Career analysis unavailable; using deterministic scores only.');
    }
    const overallCareerMatch = calc.calculateOverallMatch({
      skillMatchScore,
      resumeSkillRelevance: skillMatchScore,
      projectRelevance: 60,
      branchRelevance: 70,
      experienceRelevance: 50,
      academicRelevance: 60,
    });
    return {
      matchComponents: {
        resumeSkillRelevance: skillMatchScore,
        projectRelevance: 60,
        branchRelevance: 70,
        experienceRelevance: 50,
        academicRelevance: 60,
      },
      futureMatchComponents: {
        skillMatchScore,
        resumeSkillRelevance: skillMatchScore,
        projectRelevance: 60,
        branchRelevance: 70,
        experienceRelevance: 50,
        academicRelevance: 60,
      },
      aptitudeLevel: skillMatchScore >= 70 ? 'Medium' : 'Beginner',
      industryTrends: 'Market demand remains strong for students with hands-on project and technical skill depth.',
      actionPlan: {
        immediate: ['Polish your profile and add one project.'],
        shortTerm: ['Focus on the most-missing required skills.'],
        longTerm: ['Track progress and apply to relevant openings.'],
      },
      topCompanies: ['Targeted companies will appear once your profile is scored.'],
      avgSalary: 'INR 8-15 LPA',
      timeToJobReady: '3-6 months',
      careerPathExplanation: 'This result uses your current Firestore skill match and profile data while AI remains unavailable.',
      overallCareerMatch,
      expectedMatchAfterImprovement: overallCareerMatch,
      skillMatchScore,
      matchedSkills,
      missingSkills,
      requiredSkills,
    };
  }
}

// ─── 4. Explainable AI ────────────────────────────────────────────────────────
/**
 * "Why this?" explanation based ONLY on actual calculated data.
 * @param {object} profileData
 * @param {object} opportunity  Firestore record
 * @param {number} matchScore  Calculated by calculationService
 * @param {string[]} matchedSkills  Calculated by calculateSkillMatch
 * @param {string[]} missingSkills  Calculated by calculateSkillMatch
 * @returns {string[]} reasons
 */
async function explainMatch(profileData, opportunity, matchScore, matchedSkills, missingSkills) {
  const prompt = `You are SkillBridge's explainable AI.
The student wants to know why this opportunity was recommended.
Generate reasons using ONLY the actual data provided. Do NOT invent skills or eligibility.

ACTUAL MATCH SCORE (calculated): ${matchScore}%
SKILLS STUDENT HAS THAT MATCH: ${matchedSkills.join(', ') || 'none'}
SKILLS STUDENT IS MISSING: ${missingSkills.join(', ') || 'none'}
STUDENT CAREER GOAL: ${profileData.careerGoal || 'Not set'}
OPPORTUNITY TITLE: ${opportunity.title || opportunity.name}
OPPORTUNITY REQUIRED SKILLS: ${(opportunity.requiredSkills || opportunity.skills || []).join(', ')}
STUDENT BRANCH: ${profileData.branch}
OPPORTUNITY ELIGIBILITY: ${opportunity.eligibility || 'Not specified'}

Return ONLY a valid JSON array of 3-5 specific reason strings.
Each reason must use actual data above. Examples:
["Your Python skill matches the requirement.", "SQL is required but missing from your profile.", "Your career goal matches this role.", "Your branch satisfies the eligibility requirement."]`;

  const raw    = await generate(prompt);
  const parsed = safeParseJSON(raw);
  if (!parsed || !Array.isArray(parsed)) {
    // Fallback: build reasons from calculated data
    return buildFallbackReasons(profileData, opportunity, matchedSkills, missingSkills);
  }
  return parsed;
}

function buildFallbackReasons(profileData, opportunity, matchedSkills, missingSkills) {
  const reasons = [];
  if (matchedSkills.length > 0) {
    reasons.push(`${matchedSkills.slice(0,3).join(', ')} match${matchedSkills.length === 1 ? 'es' : ''} the requirement.`);
  }
  if (missingSkills.length > 0) {
    reasons.push(`${missingSkills.slice(0,2).join(', ')} ${missingSkills.length === 1 ? 'is' : 'are'} currently missing.`);
  }
  if (profileData.careerGoal && (opportunity.title || '').toLowerCase().includes(profileData.careerGoal.toLowerCase().split(' ')[0])) {
    reasons.push('Your career goal aligns with this opportunity.');
  }
  if (reasons.length === 0) reasons.push('Based on your current skills and career goal.');
  return reasons;
}

// ─── 5. Content Generation ────────────────────────────────────────────────────
async function generateContent(type, profileData) {
  const prompts = {
    bio: `Write a professional 3-sentence student bio for ${profileData.name}, a ${profileData.academicYear} ${profileData.branch} student at ${profileData.college || 'their college'} with skills in ${(profileData.skills || []).slice(0, 4).join(', ')} targeting ${profileData.careerGoal}. Return ONLY the bio text.`,
    coverLetter: `Write a compelling 150-word cover letter opening paragraph for ${profileData.name} applying for a ${profileData.careerGoal} role. Skills: ${(profileData.skills || []).slice(0, 5).join(', ')}. Make it specific, energetic, and professional. Return ONLY the paragraph.`,
    linkedin: `Write a professional LinkedIn summary (120 words) for ${profileData.name}, ${profileData.academicYear} ${profileData.branch} student targeting ${profileData.careerGoal}. Skills: ${(profileData.skills || []).slice(0, 6).join(', ')}. Return ONLY the summary.`,
    projectDescription: `Given these projects: ${JSON.stringify(profileData.projects || [])}, write improved 1-line descriptions for each that highlight impact and technical detail. Return ONLY a JSON array of strings.`,
  };
  const prompt = prompts[type];
  if (!prompt) throw new Error(`Unknown content type: ${type}`);
  return await generate(prompt);
}

// ─── 6. Interview Question Generator ─────────────────────────────────────────
async function generateInterviewQuestions(profileData) {
  const prompt = `Generate 8 technical interview questions for a student targeting ${profileData.careerGoal}.
Student skills: ${(profileData.skills || []).join(', ')}
Mix: 4 technical, 2 project-based, 2 HR/behavioural.

Return ONLY valid JSON array:
[
  { "type": "Technical|Project|HR", "question": "<question>", "hint": "<brief answer hint>" }
]`;

  const raw    = await generate(prompt);
  const parsed = safeParseJSON(raw);
  if (!parsed) throw new Error('Gemini returned non-JSON for interview questions');
  return parsed;
}

module.exports = {
  analyzeResume,
  resolveCareerGoal,
  getOpportunityRecommendations,
  analyzeSkillGap,
  getCareerAnalysis,
  explainMatch,
  generateContent,
  generateInterviewQuestions,
};
