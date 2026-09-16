/**
 * SkillBridge – PDF Resume Parser Service
 *
 * Pipeline:
 *   PDF file/buffer  →  raw text (pdf-parse)
 *               →  section splitter
 *               →  per-section extractors
 *               →  structured JSON
 *
 * Sections extracted:
 *   name, email, phone, linkedin, github,
 *   education   : [{ degree, institution, year, cgpa }]
 *   skills      : [string]
 *   projects    : [{ title, description, technologies }]
 *   experience  : [{ title, company, duration, description }]
 *   certifications: [{ name, provider, date }]
 *   achievements  : [string]
 *
 * Handles scanned/image PDFs gracefully (empty text → error message).
 * No data is ever hardcoded from sample resumes.
 */

'use strict';

const pdfParse = require('pdf-parse');
const fs       = require('fs');
const calc     = require('./calculationService');

// ─── Skill dictionary (canonical casing) ─────────────────────────────────────
const SKILL_DICTIONARY = [
  // Languages
  'Python','JavaScript','TypeScript','Java','C++','C#','C','Go','Rust','PHP',
  'Ruby','Swift','Kotlin','Dart','R','MATLAB','Scala','Perl','Bash','Shell',
  // Web Frontend
  'React','Angular','Vue.js','Next.js','Nuxt.js','HTML','CSS','HTML/CSS',
  'Bootstrap','Tailwind CSS','Redux','jQuery','Webpack','Vite','Sass','SCSS',
  // Web Backend
  'Node.js','Express','Django','Flask','FastAPI','Spring Boot','Laravel',
  'Ruby on Rails','ASP.NET','Nest.js','Hapi.js',
  // Databases
  'MySQL','PostgreSQL','MongoDB','SQLite','Redis','Oracle','Cassandra',
  'DynamoDB','SQL','NoSQL','Firebase','Firestore','Supabase','CockroachDB',
  // AI/ML
  'Machine Learning','Deep Learning','TensorFlow','PyTorch','Scikit-learn',
  'Keras','OpenCV','NLP','Computer Vision','BERT','Transformers','Hugging Face',
  'Pandas','NumPy','Matplotlib','Seaborn','SciPy','XGBoost','LightGBM',
  // Cloud & DevOps
  'AWS','Azure','GCP','Google Cloud','Docker','Kubernetes','Linux','CI/CD',
  'Git','GitHub','GitLab','Bitbucket','Terraform','Ansible','Jenkins',
  'Nginx','Apache','Heroku','Vercel','Netlify','Railway',
  // Mobile
  'Flutter','Android','iOS','React Native','Kotlin','Swift','Firebase',
  // Data & Analytics
  'Power BI','Tableau','Excel','Data Analysis','Statistics','Hadoop',
  'Spark','Kafka','Airflow','dbt','Looker',
  // Security
  'Cybersecurity','Ethical Hacking','Networking','Kali Linux',
  'Penetration Testing','Burp Suite','Wireshark',
  // Design
  'Figma','Adobe XD','UI/UX','Photoshop','Illustrator','Canva','Sketch',
  // Other
  'REST API','GraphQL','gRPC','Microservices','Blockchain','Solidity',
  'Web3','IoT','Arduino','Raspberry Pi','Agile','Scrum','JIRA','Confluence',
  'Postman','Swagger','OpenAPI',
];

// ─── Section heading patterns ─────────────────────────────────────────────────
// Maps a canonical section key to a list of heading regex patterns.
const SECTION_PATTERNS = {
  education:      [/\beducation\b/i, /\bacademic\s*(background|qualification|details|history)?\b/i, /\bqualification[s]?\b/i],
  skills:         [/\b(technical\s+)?skills?\b/i, /\bcore\s+competencies?\b/i, /\btechnologies?\b/i, /\btool\s*&?\s*technologies?\b/i],
  projects:       [/\bprojects?\b/i, /\bacademic\s+projects?\b/i, /\bpersonal\s+projects?\b/i, /\bproject\s+work\b/i],
  experience:     [/\b(work\s+)?experience\b/i, /\binternship[s]?\b/i, /\bprofessional\s+experience\b/i, /\bemployment\s*history\b/i, /\btraining\b/i],
  certifications: [/\bcertification[s]?\b/i, /\bcertificate[s]?\b/i, /\bcourse[s]?\b/i, /\baccomplishment[s]?\b/i, /\blicen[sc]e[s]?\b/i],
  achievements:   [/\bachievement[s]?\b/i, /\baward[s]?\b/i, /\bhonor[s]?\b/i, /\bhonour[s]?\b/i, /\brecognition[s]?\b/i, /\bextra.?curricular\b/i, /\bactivit(y|ies)\b/i],
};

// ─── 1. Text extraction ───────────────────────────────────────────────────────
async function extractTextFromPDF(input) {
  let buffer;
  if (Buffer.isBuffer(input)) {
    buffer = input;
  } else if (typeof input === 'string') {
    if (!fs.existsSync(input)) throw new Error(`File not found: ${input}`);
    buffer = fs.readFileSync(input);
  } else {
    throw new Error('extractTextFromPDF: input must be a Buffer or file path string');
  }

  if (buffer.length < 5 || buffer.subarray(0, 5).toString() !== '%PDF-') {
    throw new Error('The uploaded file is not a valid PDF document');
  }

  const data = await pdfParse(buffer, {
    // preserve layout so section headings stay on their own lines
    pagerender: undefined,
  });

  return data.text || '';
}

// ─── 2. Section splitter ──────────────────────────────────────────────────────
/**
 * Splits resume text into named sections.
 * Returns { header: string, education: string, skills: string, ... }
 * "header" is the text before any recognised section heading.
 */
function splitIntoSections(text) {
  const lines = text.split('\n');
  const sections = { header: [] };
  let currentSection = 'header';

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) { sections[currentSection]?.push(''); continue; }

    // Check if this line is a section heading
    let matched = false;
    for (const [sectionKey, patterns] of Object.entries(SECTION_PATTERNS)) {
      if (patterns.some(p => p.test(line)) && line.length < 60) {
        currentSection = sectionKey;
        if (!sections[currentSection]) sections[currentSection] = [];
        matched = true;
        break;
      }
    }
    if (!matched) {
      if (!sections[currentSection]) sections[currentSection] = [];
      sections[currentSection].push(rawLine);
    }
  }

  // Join each section back to a string
  const result = {};
  for (const [key, arr] of Object.entries(sections)) {
    result[key] = arr.join('\n');
  }
  return result;
}

// ─── 3. Contact / header extractors ──────────────────────────────────────────
function extractName(headerText) {
  const lines = headerText.split('\n').map(l => l.trim()).filter(Boolean);
  for (const line of lines.slice(0, 8)) {
    // Name: 2-5 words, only letters/spaces/dots, not an email, not a URL, not all-caps acronym
    if (
      line.length >= 3 && line.length <= 60 &&
      /^[A-Za-z][A-Za-z\s.''-]{1,59}$/.test(line) &&
      !/[@./\\0-9]/.test(line) &&
      !/\b(resume|curriculum|vitae|profile|contact|email|phone)\b/i.test(line) &&
      line.split(/\s+/).length <= 6
    ) {
      return line.replace(/\s+/g, ' ').trim();
    }
  }
  return '';
}

function extractEmail(text) {
  const m = text.match(/[\w.+%-]+@[\w.-]+\.[a-zA-Z]{2,}/);
  return m ? m[0].toLowerCase() : '';
}

function extractPhone(text) {
  // India mobile: +91 optional, then 10-digit starting 6-9
  const m = text.match(/(\+91[\s\-.]?)?\b[6-9]\d{9}\b/);
  if (m) return m[0].replace(/[^\d+]/g, '').slice(-10);
  // International fallback
  const m2 = text.match(/\+?[\d][\d\s\-().]{8,15}[\d]/);
  return m2 ? m2[0].replace(/\s+/g, '') : '';
}

function extractLinkedIn(text) {
  const m = text.match(/(?:https?:\/\/)?(?:www\.)?linkedin\.com\/in\/([\w-]+)/i);
  return m ? `https://www.linkedin.com/in/${m[1]}` : '';
}

function extractGitHub(text) {
  const m = text.match(/(?:https?:\/\/)?(?:www\.)?github\.com\/([\w-]+)/i);
  return m ? `https://github.com/${m[1]}` : '';
}

// ─── 4. Education extractor ───────────────────────────────────────────────────
function extractEducation(sectionText) {
  if (!sectionText) return [];
  const entries = [];
  const blocks = sectionText.split(/\n{2,}/).map(b => b.trim()).filter(Boolean);

  for (const block of blocks) {
    const lines = block.split('\n').map(l => l.trim()).filter(Boolean);
    if (!lines.length) continue;

    // CGPA / percentage
    const cgpaMatch = block.match(/(?:cgpa|gpa|grade point|percentage|marks)[:\s]*([0-9]+\.?[0-9]*)\s*(?:\/\s*(?:10|4|100))?/i);
    let cgpa = cgpaMatch ? parseFloat(cgpaMatch[1]) : null;
    if (cgpa !== null && cgpa > 10) cgpa = parseFloat((cgpa / 10).toFixed(1)); // % → /10

    // Year range
    const yearMatch = block.match(/\b(19|20)\d{2}\s*[-–—to]+\s*((?:19|20)\d{2}|present|current|ongoing)\b/i) ||
                      block.match(/\b(19|20)\d{2}\b/);
    const year = yearMatch ? yearMatch[0] : '';

    // Degree keywords
    const degreeMatch = block.match(
      /\b(b\.?tech|be|b\.?e\.?|m\.?tech|me|m\.?e\.?|bsc|b\.sc|msc|m\.sc|bca|mca|diploma|phd|bachelor|master|associate|higher secondary|secondary|12th|10th|ssc|hsc|cbse|icse)\b[^,\n]*/i
    );
    const degree = degreeMatch ? degreeMatch[0].trim() : lines[0];

    // Institution heuristic: longest line that has "college|university|institute|school|academy"
    const instLine = lines.find(l =>
      /college|university|institute|school|academy|vidyalaya|iit|nit|bits|iiit/i.test(l)
    ) || '';

    entries.push({
      degree:      degree,
      institution: instLine,
      year:        year,
      cgpa:        cgpa,
    });
  }
  return entries.slice(0, 5); // cap at 5
}

// ─── 5. Skills extractor ─────────────────────────────────────────────────────
function extractSkills(sectionText, fullText) {
  const searchText = (sectionText || '') + '\n' + (fullText || '');
  const upper = searchText.toUpperCase();
  const found = SKILL_DICTIONARY.filter(skill => {
    const pattern = skill.toUpperCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`\\b${pattern}\\b`, 'i').test(upper);
  });
  return [...new Set(found)];
}

// ─── 6. Projects extractor ───────────────────────────────────────────────────
function extractProjects(sectionText) {
  if (!sectionText) return [];
  const projects = [];
  // Split on blank lines or bullet/numbered list patterns
  const blocks = sectionText.split(/\n{2,}|\n(?=[•\-*▪◦✦➤\d+[\.\)])/);

  for (const block of blocks) {
    const lines = block.split('\n').map(l => l.trim()).filter(Boolean);
    if (!lines.length) continue;

    // Title: first non-trivially short line
    const titleLine = lines.find(l => l.length > 3) || '';
    if (!titleLine) continue;

    // Remove bullet prefix from title
    const title = titleLine.replace(/^[•\-*▪◦✦➤\d+[\.\)]\s*]+/, '').trim();
    if (!title || title.length < 3) continue;

    // Description: remaining lines joined
    const desc = lines.slice(1).join(' ').replace(/\s+/g, ' ').trim();

    // Technologies: scan entire block for known skills
    const blockUpper = block.toUpperCase();
    const techs = SKILL_DICTIONARY.filter(s => blockUpper.includes(s.toUpperCase()));

    // Also pick up tech listed after "tech stack:", "technologies:", "tools:" etc.
    const techLineMatch = block.match(/(?:tech(?:nolog(?:y|ies))?(?:\s*stack)?|tools?)[:\s]+([^\n]+)/i);
    if (techLineMatch) {
      const inline = techLineMatch[1].split(/[,|/]+/).map(t => t.trim()).filter(Boolean);
      inline.forEach(t => { if (!techs.includes(t)) techs.push(t); });
    }

    projects.push({ title, description: desc, technologies: [...new Set(techs)] });
  }

  return projects.slice(0, 8); // cap at 8
}

// ─── 7. Experience extractor ─────────────────────────────────────────────────
function extractExperience(sectionText) {
  if (!sectionText) return [];
  const entries = [];
  const blocks = sectionText.split(/\n{2,}/).map(b => b.trim()).filter(Boolean);

  for (const block of blocks) {
    const lines = block.split('\n').map(l => l.trim()).filter(Boolean);
    if (!lines.length) continue;

    const titleLine = lines[0].replace(/^[•\-*▪◦✦➤\s]+/, '').trim();
    if (!titleLine || titleLine.length < 3) continue;

    // Duration: look for date range pattern
    const durationMatch = block.match(
      /\b(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)[.,\s]*(?:19|20)?\d{2}\s*[-–—to]+\s*(?:(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)[.,\s]*(?:19|20)?\d{2}|present|current|ongoing)/i
    );
    const duration = durationMatch ? durationMatch[0].trim() : '';

    // Company: second line or text after "at|@|–|—" in title
    const atMatch = titleLine.match(/(?:\bat\b|@|–|—)\s*(.+)/i);
    const company = atMatch ? atMatch[1].trim() : (lines[1] || '');

    // Role: text before "at|@|–|—" in title, or the full titleLine if no delimiter
    const role = atMatch ? titleLine.split(/(?:\bat\b|@|–|—)/i)[0].trim() : titleLine;

    const desc = lines.slice(1).join(' ').replace(/\s+/g, ' ').trim();

    entries.push({ title: role, company, duration, description: desc });
  }

  return entries.slice(0, 6);
}

// ─── 8. Certifications extractor ─────────────────────────────────────────────
function extractCertifications(sectionText) {
  if (!sectionText) return [];
  const certs = [];
  const lines = sectionText.split('\n').map(l => l.trim()).filter(Boolean);

  for (const line of lines) {
    const clean = line.replace(/^[•\-*▪◦✦➤\d+[\.\)]\s*]+/, '').trim();
    if (!clean || clean.length < 4) continue;

    // Provider: common cert issuers
    const providerMatch = clean.match(
      /\b(google|coursera|udemy|edx|nptel|microsoft|aws|amazon|oracle|cisco|ibm|adobe|meta|linkedin|harvard|mit|simplilearn|great\s*learning|infosys|wipro)\b/i
    );
    const provider = providerMatch ? providerMatch[1] : '';

    // Date: month/year or just year
    const dateMatch = clean.match(/\b(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)?[,\s]*(?:20)\d{2}\b/i);
    const date = dateMatch ? dateMatch[0].trim() : '';

    // Title: remove provider + date from the line
    const title = clean.replace(providerMatch ? providerMatch[0] : '', '').replace(date, '').replace(/[-–—|,]+$/, '').trim();

    if (title.length >= 4) {
      certs.push({ name: title, provider, date });
    }
  }

  return certs.slice(0, 10);
}

// ─── 9. Achievements extractor ───────────────────────────────────────────────
function extractAchievements(sectionText) {
  if (!sectionText) return [];
  const lines = sectionText.split('\n').map(l => l.trim()).filter(Boolean);
  return lines
    .map(l => l.replace(/^[•\-*▪◦✦➤\d+[\.\)]\s*]+/, '').trim())
    .filter(l => l.length >= 6)
    .slice(0, 10);
}

// ─── 10. Branch / department detector ────────────────────────────────────────
const BRANCH_MAP = {
  'Computer Engineering':         ['computer engineering','computer science','cse','cs dept','b.e. computer'],
  'Information Technology':       ['information technology','it dept','information tech','b.e. it'],
  'Electronics & Communication':  ['electronics','ece','e&c','electronics and communication','ecom'],
  'Electrical Engineering':       ['electrical engineering','eee','ee dept','electrical and electronics'],
  'Mechanical Engineering':       ['mechanical engineering','mech','me dept','b.e. mech'],
  'Civil Engineering':            ['civil engineering','civil dept','b.e. civil'],
  'Chemical Engineering':         ['chemical engineering','chem engg'],
  'Automobile Engineering':       ['automobile engineering','auto engg'],
};

function detectBranch(text) {
  const lower = text.toLowerCase();
  for (const [branch, keywords] of Object.entries(BRANCH_MAP)) {
    if (keywords.some(kw => lower.includes(kw))) return branch;
  }
  return '';
}

// ─── 11. Academic year detector ──────────────────────────────────────────────
function detectAcademicYear(text) {
  if (/\b(1st|first)\s*year\b/i.test(text))  return '1st Year';
  if (/\b(2nd|second)\s*year\b/i.test(text)) return '2nd Year';
  if (/\b(3rd|third)\s*year\b/i.test(text))  return '3rd Year';
  if (/\b(4th|fourth|final)\s*year\b/i.test(text)) return '4th Year';
  if (/\bdiploma\b/i.test(text))              return 'Diploma';
  return '';
}

// ─── 12. CGPA extractor (global fallback) ────────────────────────────────────
function extractCGPA(text) {
  const m = text.match(/(?:cgpa|gpa|grade point)[:\s]*([0-9]+\.?[0-9]*)\s*(?:\/\s*(?:10|4))?/i);
  if (!m) return 0;
  let v = parseFloat(m[1]);
  if (v > 10) v = parseFloat((v / 10).toFixed(1)); // percentage → /10 scale
  return v;
}

// ─── 13. Main parse pipeline ──────────────────────────────────────────────────
/**
 * Full PDF → structured JSON pipeline.
 *
 * @param {Buffer|string} pdfInput  Buffer or absolute file path
 * @returns {object}  { parsed, rawText, error? }
 *
 * parsed shape:
 * {
 *   name, email, phone, linkedin, github,
 *   branch, academicYear, cgpa,
 *   education:      [{ degree, institution, year, cgpa }],
 *   skills:         [string],
 *   projects:       [{ title, description, technologies }],
 *   experience:     [{ title, company, duration, description }],
 *   certifications: [{ name, provider, date }],
 *   achievements:   [string],
 *   meta: { wordCount, pageCount, hasText, parsedAt }
 * }
 */
async function parsePDF(pdfInput) {
  // ── Extract raw text ──────────────────────────────────────────────────────
  let rawText = '';
  try {
    rawText = await extractTextFromPDF(pdfInput);
  } catch (err) {
    return {
      parsed: null,
      rawText: '',
      error: `PDF extraction failed: ${err.message}`,
    };
  }

  // ── Handle scanned / empty PDFs ───────────────────────────────────────────
  const cleaned = rawText.replace(/\s+/g, ' ').trim();
  if (!cleaned) {
    return {
      parsed: null,
      rawText,
      error: 'This PDF has no selectable text. Please upload a text-based PDF instead of a scanned image.',
    };
  }

  // ── Split into sections ───────────────────────────────────────────────────
  const sections = splitIntoSections(rawText);

  // ── Run all extractors ────────────────────────────────────────────────────
  const name    = extractName(sections.header || '');
  const email   = extractEmail(rawText);
  const phone   = extractPhone(rawText);
  const linkedin = extractLinkedIn(rawText);
  const github   = extractGitHub(rawText);
  const branch       = detectBranch(rawText);
  const academicYear = detectAcademicYear(rawText);
  const cgpa         = extractCGPA(rawText);

  const education      = extractEducation(sections.education || '');
  const skills         = extractSkills(sections.skills || '', rawText);
  const projects       = extractProjects(sections.projects || '');
  const experience     = extractExperience(sections.experience || '');
  const certifications = extractCertifications(sections.certifications || '');
  const achievements   = extractAchievements(sections.achievements || '');

  const wordCount = rawText.split(/\s+/).length;
  const pageCount = Math.ceil(rawText.length / 2500);

  const parsed = {
    name,
    email,
    phone,
    linkedin,
    github,
    branch,
    academicYear,
    cgpa,
    education,
    skills,
    projects,
    experience,
    certifications,
    achievements,
    meta: {
      wordCount,
      pageCount,
      hasText: true,
      parsedAt: new Date().toISOString(),
    },
  };

  return { parsed, rawText, error: null };
}

// ─── Legacy score helper (used by existing /upload route) ────────────────────
function calculateResumeScore(parsedData) {
  return calc.estimateResumeScoreFromProfile(parsedData);
}

// ─── Backwards-compat: simple text parse (used by existing /upload route) ─────
function parseResumeText(text) {
  if (!text || !text.trim()) return { skills: [], email: '', phone: '' };
  const sections = splitIntoSections(text);
  return {
    name:    extractName(sections.header || ''),
    email:   extractEmail(text),
    phone:   extractPhone(text),
    linkedin: extractLinkedIn(text),
    github:   extractGitHub(text),
    branch:   detectBranch(text),
    academicYear: detectAcademicYear(text),
    cgpa:     extractCGPA(text),
    skills:   extractSkills(sections.skills || '', text),
    projectCount:       extractProjects(sections.projects || '').length,
    certificationCount: extractCertifications(sections.certifications || '').length,
    hasExperience:      extractExperience(sections.experience || '').length > 0,
    textLength: text.length,
  };
}

module.exports = {
  parsePDF,
  extractTextFromPDF,
  parseResumeText,
  calculateResumeScore,
  SKILL_DICTIONARY,
};
