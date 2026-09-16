/**
 * SkillBridge - Gemini AI service
 * Responsibilities: resume parsing, resume analysis, career guidance,
 * personalized learning roadmap, resume suggestions, and AI chat.
 *
 * Gemini returns qualitative data and component scores only. Final ATS and
 * career-match percentages remain calculated by calculationService.
 */

const { GoogleGenAI } = require('@google/genai');
const calc = require('./calculationService');

let _client = null;
function getClient() {
  if (!_client) {
    if (!process.env.GEMINI_API_KEY) throw new Error('Gemini API request failed: GEMINI_API_KEY is not configured');
    _client = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
    console.log('[Gemini] client initialized; API key configured: true');
  }
  return _client;
}

const MODEL = process.env.GEMINI_MODEL || 'gemini-3.6-flash';

function getConfigurationStatus() {
  return {
    apiKeyConfigured: Boolean(process.env.GEMINI_API_KEY),
    clientInitialized: Boolean(_client),
    model: MODEL,
  };
}

function normalizeGeminiError(error) {
  const message = String(error?.message || '').toLowerCase();
  const status = Number(error?.status || error?.code || 0);
  if (status === 429 || message.includes('quota') || message.includes('resource exhausted')) {
    return new Error('Gemini API request failed: quota or rate limit exceeded');
  }
  if (status === 401 || status === 403 || message.includes('api key') || message.includes('permission')) {
    return new Error('Gemini API request failed: authentication or permission error');
  }
  if (status === 400) return new Error('Gemini API request failed: invalid request');
  if (message.includes('timeout') || message.includes('timed out')) return new Error('Gemini API request failed: request timed out');
  return new Error('Gemini API request failed');
}

// ─── Helper: safe JSON parse from Gemini output ──────────────────────────────
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

// ─── Helper: call Gemini generateContent ─────────────────────────────────────
async function chat(systemPrompt, userPrompt, temperature = 0.4) {
  try {
    const response = await getClient().models.generateContent({
      model: MODEL,
      contents: `${systemPrompt}\n\n${userPrompt}`,
      config: { temperature },
    });
    const text = response.text;
    if (!text || !String(text).trim()) throw new Error('empty Gemini response');
    return String(text).trim();
  } catch (error) {
    throw normalizeGeminiError(error);
  }
}

async function extractResumeData(resumeText) {
  const system = `You extract resume data. Return ONLY valid JSON. Use only information explicitly present in the resume. Never infer, invent, or reclassify content. Projects must come from a clearly labelled projects section; certifications from certifications/courses; experience from experience/internship sections. Use empty strings or arrays when unsupported.`;
  const user = `Extract this resume into exactly this shape:
{
  "name":"", "email":"", "phone":"", "branch":"", "academicYear":"", "cgpa":0,
  "education":[], "skills":[], "projects":[], "certifications":[], "experience":[], "internships":[], "achievements":[], "interests":[]
}
Projects should be objects with title, description, technologies. Certifications should be objects with name, provider, date. Experience and internships should be objects with title, company, duration, description. Keep skills as names only.

RESUME TEXT:
${String(resumeText || '').slice(0, 30000)}`;
  const parsed = safeParseJSON(await chat(system, user, 0.1));
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Gemini returned invalid resume extraction JSON');
  return parsed;
}

// ─── 1. Resume Analysis ───────────────────────────────────────────────────────
/**
 * Parse and analyse a student's resume/profile.
 * Returns ATS component scores (0-100 each).
 * The FINAL ATS score is calculated by calculationService.calculateATSScore().
 *
 * @param {object} profileData
 * @returns {object} { atsComponents, matchedSkills, missingSkills, strengths,
 *                     improvements, keywords, overallFeedback,
 *                     resumeScore (calculated here), grade }
 */
async function analyzeResume(profileData) {
  const system = `You are an expert ATS resume evaluator for engineering students.
Respond with ONLY valid JSON. Do NOT calculate a final score — return component scores only.`;

  const user = `Analyse this engineering student profile and return ATS component scores.

STUDENT PROFILE:
${JSON.stringify(profileData, null, 2)}

Return EXACTLY this JSON (all component scores 0-100, based on the actual student data):
{
  "atsComponents": {
    "structureScore": <0-100 — how well the resume is structured: sections, formatting, clarity>,
    "skillsRelevanceScore": <0-100 — relevance of listed skills to career goal>,
    "keywordScore": <0-100 — presence of ATS-relevant industry keywords>,
    "projectScore": <0-100 — quality and relevance of projects>,
    "certificationScore": <0-100 — relevant certifications present>,
    "experienceScore": <0-100 — relevant work/internship experience>,
    "industryRelevanceScore": <0-100 — overall alignment with the target industry>
  },
  "matchedSkills": ["skill1", "skill2"],
  "missingSkills": ["skill1", "skill2"],
  "keywords": ["keyword1", "keyword2"],
  "strengths": ["strength1", "strength2", "strength3"],
  "improvements": ["improvement1", "improvement2", "improvement3", "improvement4"],
  "overallFeedback": "<2-sentence personalised summary based on actual data>"
}`;

  const raw    = await chat(system, user);
  const parsed = safeParseJSON(raw);
  if (!parsed || !parsed.atsComponents) throw new Error('Gemini returned invalid JSON for resume analysis');

  // Calculate final ATS/Resume score via centralized service
    parsed.atsComponents.experienceScore = calc.calculateExperienceScore(
      profileData.experience,
      profileData.careerGoal || profileData.normalizedCareerGoal
    );
    const resumeScore = calc.calculateATSScore(parsed.atsComponents);

  // Derive grade from calculated score
  const grade =
    resumeScore >= 80 ? 'Excellent' :
    resumeScore >= 60 ? 'Good'      :
    resumeScore >= 40 ? 'Average'   : 'Needs Work';

  return {
    ...parsed,
    resumeScore,
    grade,
  };
}

// ─── 2. Career Guidance ───────────────────────────────────────────────────────
/**
 * Career recommendations based on student profile.
 * Returns component scores for the top career.
 * Final Overall Match is calculated by calculationService.calculateOverallMatch().
 *
 * @param {object} profileData
 * @returns {object}
 */
async function getCareerGuidance(profileData) {
  const system = `You are a senior career counsellor for engineering students.
Respond with ONLY valid JSON. Do NOT return a final percentage — return component scores.`;

  const user = `Provide career guidance for this student.

STUDENT PROFILE:
${JSON.stringify(profileData, null, 2)}

Return EXACTLY this JSON (all scores 0-100, based on actual student data):
{
  "topCareers": [
    {
      "title": "<role>",
      "domain": "<domain>",
      "reasoning": "<why — reference actual skills/projects>",
      "avgSalary": "<range>",
      "growthRate": "<percent>%",
      "matchComponents": {
        "skillMatchScore": <0-100>,
        "resumeSkillRelevance": <0-100>,
        "projectRelevance": <0-100>,
        "branchRelevance": <0-100>,
        "experienceRelevance": <0-100>,
        "academicRelevance": <0-100>
      }
    },
    { "title": "<role>", "domain": "<domain>", "reasoning": "<why>", "avgSalary": "<range>", "growthRate": "<percent>%",
      "matchComponents": { "skillMatchScore": <0-100>, "resumeSkillRelevance": <0-100>, "projectRelevance": <0-100>, "branchRelevance": <0-100>, "experienceRelevance": <0-100>, "academicRelevance": <0-100> } },
    { "title": "<role>", "domain": "<domain>", "reasoning": "<why>", "avgSalary": "<range>", "growthRate": "<percent>%",
      "matchComponents": { "skillMatchScore": <0-100>, "resumeSkillRelevance": <0-100>, "projectRelevance": <0-100>, "branchRelevance": <0-100>, "experienceRelevance": <0-100>, "academicRelevance": <0-100> } }
  ],
  "aptitudeLevel": "<Beginner|Medium|Advanced>",
  "requiredSkillsForTopCareer": ["skill1", "skill2", "skill3", "skill4", "skill5"],
  "missingSkills": ["skill1", "skill2", "skill3"],
  "skillGapSummary": "<1-sentence personalised gap analysis>",
  "nextSteps": ["step1", "step2", "step3"],
  "futureMatchComponents": {
    "skillMatchScore": <0-100 — expected after completing nextSteps>,
    "resumeSkillRelevance": <0-100>,
    "projectRelevance": <0-100>,
    "branchRelevance": <0-100>,
    "experienceRelevance": <0-100>,
    "academicRelevance": <0-100>
  }
}`;

  const raw    = await chat(system, user);
  const parsed = safeParseJSON(raw);
  if (!parsed || !parsed.topCareers) throw new Error('Gemini returned invalid JSON for career guidance');

  // Calculate match scores via centralized service
  const topCareers = parsed.topCareers.map(c => ({
    ...c,
    matchScore: calc.calculateOverallMatch(c.matchComponents || {}),
  }));

  // Sort by calculated match score
  topCareers.sort((a, b) => b.matchScore - a.matchScore);

  const overallMatchScore = topCareers[0]?.matchScore || 0;

  // Expected match after improvement
  const expectedMatchAfterImprovement = parsed.futureMatchComponents
    ? calc.calculateExpectedMatchAfterImprovement(parsed.futureMatchComponents)
    : overallMatchScore;

  return {
    ...parsed,
    topCareers,
    overallMatchScore,
    expectedMatchAfterImprovement,
  };
}

// ─── 3. Personalized Learning Roadmap ────────────────────────────────────────
/**
 * Generate a 6-week personalised learning roadmap based on MISSING SKILLS.
 * Focus ONLY on skills the student lacks.
 * Gemini generates topics; JS tracks and calculates completion.
 *
 * @param {object} profileData - must include: careerGoal, normalizedCareerGoal, missingSkills, userSkills, matchedSkills, requiredSkills
 * @returns {object}
 */
async function generateRoadmap(profileData) {
  const system = `You are an expert learning-roadmap designer for engineering students.

Create a practical, personalized 6-week learning roadmap whose sequence and difficulty are derived from this student's current skills.

CRITICAL RULES:
- The roadmap MUST be based ONLY on the student's MISSING SKILLS.
- Do NOT teach skills that the student already has unless they are necessary prerequisites for a missing skill.
- Do NOT generate generic career preparation topics that are not in the missing skills list.
- Do NOT generate unrelated technologies or skills.
- Prioritize missing skills from basic/foundation concepts to advanced concepts.
- If the student already knows a foundation, skip beginner material and start at the next useful level.
- If the student has few relevant skills, include the necessary fundamentals for the missing skills.
- Use the student's branch, academic year, career goal, and existing projects to make exercises relevant.
- Every exercise or project must practice one or more missing skills.
- The student should be able to follow the roadmap step by step.
- Every topic must help the student learn or practice one of the MISSING SKILLS.
- Use simple language.
- Prefer practical learning and small projects/examples.
- Return ONLY valid JSON. Do NOT add any text outside JSON.`;

  const user = `Create a 6-week learning roadmap for this engineering student. Do not use a fixed week template: choose the sequence, depth, and project timing from the actual profile.

STUDENT NAME:
${profileData.name || 'Student'}

BRANCH:
${profileData.branch || 'Not provided'}

ACADEMIC YEAR:
${profileData.academicYear || 'Not provided'}

CAREER GOAL:
${profileData.normalizedCareerGoal || profileData.careerGoal}

STUDENT'S CURRENT SKILLS:
${JSON.stringify(profileData.userSkills || [])}

SKILLS ALREADY MATCHED:
${JSON.stringify(profileData.matchedSkills || [])}

REQUIRED SKILLS FOR THIS CAREER:
${JSON.stringify(profileData.requiredSkills || [])}

MISSING SKILLS (PRIMARY INPUT - THE ROADMAP MUST TEACH THESE):
${JSON.stringify(profileData.missingSkills || [])}

IMPORTANT:
- The missing skills are the PRIMARY input to this roadmap.
- Generate exactly 6 weeks.
- Each week must contain exactly 3 topics.
- Total topics = 18.
- Do not create topics unrelated to the missing skills.
- Every topic must directly relate to learning or practicing one of the missing skills.
- Do not spend a main topic on a current skill. A prerequisite is allowed only when it directly supports a listed missing skill.

Return EXACTLY this JSON structure (all 6 weeks, exactly 3 topics per week, 18 topics total):
{
  "careerGoal": "${profileData.normalizedCareerGoal || profileData.careerGoal}",
  "totalWeeks": 6,
  "estimatedHours": 120,
  "weeks": [
    {
      "week": 1,
      "title": "Foundation & Core Concepts",
      "subtitle": "Build the fundamental understanding of missing skills.",
      "topics": [
        { "id": "w1t1", "name": "Topic Name", "hours": 2, "resource": "Free Resource Name or URL", "tag": "Skill Name", "skill": "Skill Name", "completed": false },
        { "id": "w1t2", "name": "Topic Name", "hours": 2, "resource": "Free Resource Name or URL", "tag": "Skill Name", "skill": "Skill Name", "completed": false },
        { "id": "w1t3", "name": "Topic Name", "hours": 3, "resource": "Free Resource Name or URL", "tag": "Skill Name", "skill": "Skill Name", "completed": false }
      ]
    },
    {
      "week": 2,
      "title": "Intermediate Skills & Practice",
      "subtitle": "Deepen understanding with practical exercises.",
      "topics": [
        { "id": "w2t1", "name": "Topic Name", "hours": 2, "resource": "Free Resource Name or URL", "tag": "Skill Name", "skill": "Skill Name", "completed": false },
        { "id": "w2t2", "name": "Topic Name", "hours": 2, "resource": "Free Resource Name or URL", "tag": "Skill Name", "skill": "Skill Name", "completed": false },
        { "id": "w2t3", "name": "Topic Name", "hours": 3, "resource": "Free Resource Name or URL", "tag": "Skill Name", "skill": "Skill Name", "completed": false }
      ]
    },
    {
      "week": 3,
      "title": "Hands-On Projects",
      "subtitle": "Apply skills to real-world scenarios.",
      "topics": [
        { "id": "w3t1", "name": "Topic Name", "hours": 2, "resource": "Free Resource Name or URL", "tag": "Skill Name", "skill": "Skill Name", "completed": false },
        { "id": "w3t2", "name": "Topic Name", "hours": 2, "resource": "Free Resource Name or URL", "tag": "Skill Name", "skill": "Skill Name", "completed": false },
        { "id": "w3t3", "name": "Topic Name", "hours": 4, "resource": "Free Resource Name or URL", "tag": "Skill Name", "skill": "Skill Name", "completed": false }
      ]
    },
    {
      "week": 4,
      "title": "Advanced Techniques",
      "subtitle": "Master advanced concepts and optimizations.",
      "topics": [
        { "id": "w4t1", "name": "Topic Name", "hours": 2, "resource": "Free Resource Name or URL", "tag": "Skill Name", "skill": "Skill Name", "completed": false },
        { "id": "w4t2", "name": "Topic Name", "hours": 3, "resource": "Free Resource Name or URL", "tag": "Skill Name", "skill": "Skill Name", "completed": false },
        { "id": "w4t3", "name": "Topic Name", "hours": 2, "resource": "Free Resource Name or URL", "tag": "Skill Name", "skill": "Skill Name", "completed": false }
      ]
    },
    {
      "week": 5,
      "title": "Portfolio & Integration",
      "subtitle": "Build a portfolio project using missing skills.",
      "topics": [
        { "id": "w5t1", "name": "Topic Name", "hours": 3, "resource": "Free Resource Name or URL", "tag": "Skill Name", "skill": "Skill Name", "completed": false },
        { "id": "w5t2", "name": "Topic Name", "hours": 3, "resource": "Free Resource Name or URL", "tag": "Skill Name", "skill": "Skill Name", "completed": false },
        { "id": "w5t3", "name": "Topic Name", "hours": 2, "resource": "Free Resource Name or URL", "tag": "Skill Name", "skill": "Skill Name", "completed": false }
      ]
    },
    {
      "week": 6,
      "title": "Final Preparation & Mastery",
      "subtitle": "Polish skills and prepare for professional use.",
      "topics": [
        { "id": "w6t1", "name": "Topic Name", "hours": 2, "resource": "Free Resource Name or URL", "tag": "Skill Name", "skill": "Skill Name", "completed": false },
        { "id": "w6t2", "name": "Topic Name", "hours": 2, "resource": "Free Resource Name or URL", "tag": "Skill Name", "skill": "Skill Name", "completed": false },
        { "id": "w6t3", "name": "Topic Name", "hours": 3, "resource": "Free Resource Name or URL", "tag": "Skill Name", "skill": "Skill Name", "completed": false }
      ]
    }
  ],
  "milestones": [
    "Complete foundation concepts for missing skills",
    "Build a practical project using the learned skills",
    "Master all missing skills and prepare for employment"
  ],
  "certificationRecommendation": "A relevant free certification from Coursera, Microsoft Learn, Cisco Academy, or NPTEL"
}`;

  const raw    = await chat(system, user, 0.5);
  const parsed = safeParseJSON(raw);
  if (!parsed) throw new Error('Gemini returned non-JSON for roadmap');
  return parsed;
}

// ─── 4. AI Chat Assistant ─────────────────────────────────────────────────────
/**
 * Career advisor chatbot with conversation history.
 * @param {string} userMessage
 * @param {Array}  history
 * @param {object} userContext
 * @returns {string}
 */
async function careerChat(userMessage, history = [], userContext = {}) {
  const systemPrompt = `You are SkillBridge AI – a friendly, expert career advisor for engineering students in India.
You help students with career guidance, resume tips, skill development, internship advice, and learning roadmaps.
Student context: Name=${userContext.name || 'Student'}, Branch=${userContext.branch || 'Engineering'}, Career Goal=${userContext.careerGoal || 'Software Engineer'}, Skills=${(userContext.skills || []).join(', ')}.
Keep responses concise (max 150 words), actionable, and encouraging.`;

  const conversation = history.slice(-10)
    .map(item => `${item.role || 'user'}: ${item.content || ''}`)
    .join('\n');
  return chat(systemPrompt, `${conversation}\nuser: ${userMessage}`, 0.6);
}

// ─── 5. Resume Improvement Suggestions ───────────────────────────────────────
/**
 * Generate resume improvement suggestions with point-impact estimates.
 * @param {object} profileData
 * @returns {Array<{title, desc, impactPoints}>}
 */
async function getResumeSuggestions(profileData) {
  const system = `You are an expert resume writer for engineering students.
Respond with ONLY valid JSON.`;

  const user = `Analyse this student's profile and give 6 specific, actionable resume improvement suggestions.
For each suggestion estimate the ATS score point impact (integer 5-20).

STUDENT PROFILE:
${JSON.stringify(profileData, null, 2)}

Return EXACTLY a JSON array of 6 objects:
[
  { "title": "<specific action>", "desc": "<why it helps — reference student's actual data>", "impactPoints": <5-20> }
]
Each suggestion must be specific to this student's actual profile, not generic.`;

  const raw    = await chat(system, user);
  const parsed = safeParseJSON(raw);
  if (!parsed || !Array.isArray(parsed)) throw new Error('Gemini returned non-array for suggestions');
  return parsed;
}

module.exports = {
  extractResumeData,
  analyzeResume,
  getConfigurationStatus,
  getCareerGuidance,
  generateRoadmap,
  careerChat,
  getResumeSuggestions,
};
