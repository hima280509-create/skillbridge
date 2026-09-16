/**
 * SkillBridge – Resume Routes
 *
 * POST /api/resume/upload         – Upload PDF, extract text, merge skills into users/{UID}
 * POST /api/resume/parse          – Full structured PDF parse → stored at resumes/{UID}/data/parsed
 * POST /api/resume/parse-manual   – Parse skills from manually entered text
 * GET  /api/resume/parsed         – Return stored parsed resume for the logged-in student
 */

'use strict';

const express    = require('express');
const router     = express.Router();
const { FieldValue } = require('firebase-admin/firestore');
const multer     = require('multer');
const path       = require('path');
const fs         = require('fs');
const auth       = require('../middleware/auth');
const db         = require('../services/firestoreService');
const pdfService = require('../services/pdfService');
const geminiAiService = require('../services/geminiAiService');

// ─── Multer storage (local temp) ──────────────────────────────────────────────
function makeStorage(prefix) {
  return multer.diskStorage({
    destination: (req, file, cb) => {
      const dir = path.join(__dirname, '../uploads');
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      cb(null, dir);
    },
    filename: (req, file, cb) => {
      cb(null, `${prefix}_${req.uid}_${Date.now()}${path.extname(file.originalname)}`);
    },
  });
}

const pdfFilter = (req, file, cb) => {
  const extension = path.extname(file.originalname || '').toLowerCase();
  if (file.mimetype === 'application/pdf' || extension === '.pdf') cb(null, true);
  else cb(new Error('Only PDF files are allowed'), false);
};

const upload      = multer({ storage: makeStorage('resume'), limits: { fileSize: 10 * 1024 * 1024 }, fileFilter: pdfFilter });
const uploadParse = multer({ storage: makeStorage('parse'),  limits: { fileSize: 10 * 1024 * 1024 }, fileFilter: pdfFilter });
const MIN_PDF_TEXT_LENGTH = 100;

function handleParseUpload(req, res, next) {
  uploadParse.single('resume')(req, res, err => {
    if (!err) return next();
    if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({ success: false, message: 'PDF file must be 10 MB or smaller.' });
    }
    if (err.message === 'Only PDF files are allowed') {
      return res.status(415).json({ success: false, message: 'Please upload a PDF file only.' });
    }
    return res.status(400).json({ success: false, message: 'The resume upload could not be processed.' });
  });
}

// ─── Skill list for basic extraction ─────────────────────────────────────────
const ALL_SKILLS = [
  'Python','JavaScript','Java','C++','C#','C','SQL','React','Node.js',
  'Angular','Vue.js','TypeScript','HTML','CSS','Bootstrap','MongoDB',
  'MySQL','PostgreSQL','Docker','Kubernetes','AWS','Azure','GCP',
  'Machine Learning','Deep Learning','TensorFlow','PyTorch','Scikit-learn',
  'Data Analysis','Pandas','NumPy','Matplotlib','Git','GitHub','Linux',
  'REST API','GraphQL','Flask','Django','Spring Boot','Express',
  'Flutter','Android','iOS','Swift','Kotlin','Dart',
  'Figma','Adobe XD','UI/UX','Photoshop',
  'Cybersecurity','Networking','Ethical Hacking','MATLAB','R',
  'Blockchain','Solidity','IoT','Arduino','Raspberry Pi',
  'Power BI','Tableau','Excel','NLP','Computer Vision','OpenCV',
  'Agile','Scrum','JIRA','CI/CD','DevOps','Microservices',
];

function extractSkillsFromText(text) {
  if (!text) return [];
  const upper = text.toUpperCase();
  return ALL_SKILLS.filter(skill => upper.includes(skill.toUpperCase()));
}

async function extractPdfText(filePath) {
  try {
    const pdfParse   = require('pdf-parse');
    const dataBuffer = fs.readFileSync(filePath);
    const data       = await pdfParse(dataBuffer);
    return data.text;
  } catch {
    return null;
  }
}

// ─── POST /api/resume/upload ──────────────────────────────────────────────────
router.post('/upload', auth, upload.single('resume'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ message: 'No resume file uploaded.' });

    const filePath  = req.file.path;
    const resumeUrl = `/uploads/${req.file.filename}`;

    const text         = await extractPdfText(filePath);
    const parsedSkills = extractSkillsFromText(text);

    const student = (await db.getStudent(req.uid)) || { uid: req.uid, skills: [] };
    const merged  = [...new Set([...(student.skills || []), ...parsedSkills])];

    await db.updateStudent(req.uid, {
      resumeUrl,
      resumeParsed: true,
      skills: merged,
      updatedAt: FieldValue.serverTimestamp(),
    });

    res.json({
      success:   true,
      message:   'Resume uploaded and parsed successfully',
      resumeUrl,
      parsed: { skills: parsedSkills },
    });
  } catch (err) {
    console.error('[resume/upload]', err);
    res.status(500).json({ message: 'Resume upload failed. Please try again.' });
  }
});

// ─── POST /api/resume/parse ───────────────────────────────────────────────────
router.post('/parse', auth, handleParseUpload, async (req, res) => {
  console.log('[RESUME] UID:', req.uid);
  console.log('[RESUME] File name:', req.file?.originalname);
  console.log('[RESUME] File size:', req.file?.size);
  console.log('[RESUME] MIME type:', req.file?.mimetype);
  if (!req.file) return res.status(400).json({ success: false, message: 'No PDF file uploaded.' });

  const filePath = req.file.path;

  try {
    const signature = fs.readFileSync(filePath).subarray(0, 5).toString();
    if (signature !== '%PDF-') {
      fs.unlink(filePath, () => {});
      return res.status(415).json({ success: false, message: 'The selected file is not a valid PDF.' });
    }

    console.log('[RESUME] Creating PDF buffer...');
    const pdfBuffer = fs.readFileSync(filePath);
    console.log('[RESUME] PDF buffer created:', pdfBuffer.length);
    console.log('[RESUME] Starting PDF extraction...');
    const pdfResult = await pdfService.parsePDF(pdfBuffer);
    const extractedStructure = pdfResult.parsed;
    let rawText = pdfResult.rawText || '';
    let extractionError = pdfResult.error;
    console.log('[RESUME] Extracted text length:', rawText?.length || 0);

    let ocrUsed = false;
    if (rawText.replace(/\s+/g, ' ').trim().length < MIN_PDF_TEXT_LENGTH) {
      ocrUsed = true;
      try {
        rawText = await geminiAiService.extractResumeTextFromPdf(pdfBuffer);
        console.log('[RESUME] OCR text length:', rawText?.length || 0);
        if (rawText.replace(/\s+/g, ' ').trim().length < MIN_PDF_TEXT_LENGTH) {
          throw new Error('No readable text detected after OCR');
        }

        extractionError = null;
      } catch (ocrError) {
        console.warn('[RESUME] OCR extraction failed:', ocrError.message);
        extractionError = 'Unable to extract text from this PDF. Please upload a text-based PDF resume.';
      }
    }

    fs.unlink(filePath, () => {});
    if (extractionError || !rawText.trim()) {
      await db.updateStudent(req.uid, {
        resumeUrl: '',
        resumePath: '',
        resumeParsed: false,
        updatedAt: FieldValue.serverTimestamp(),
      });
      return res.status(422).json({
        success: false,
        uploaded: true,
        resumeUrl: '',
        message: extractionError || 'Resume uploaded, but its text could not be extracted. Please use a text-based PDF.',
      });
    }

    let extracted = {};
    try {
      console.log('[RESUME] Starting AI parsing...');
      extracted = await geminiAiService.extractResumeData(rawText);
      console.log('[RESUME] AI parsing completed');
    } catch (aiError) {
      return res.status(422).json({ success: false, message: 'Resume text was extracted, but AI parsing failed.', error: aiError.message });
    }

    const aiParsed = {
      name: extracted.name || '',
      email: extracted.email || '',
      phone: extracted.phone || '',
      linkedin: extracted.linkedin || '',
      github: extracted.github || '',
      branch: extracted.branch || '',
      academicYear: extracted.academicYear || '',
      cgpa: extracted.cgpa || 0,
      education: Array.isArray(extracted.education) ? extracted.education : [],
      skills: Array.isArray(extracted.skills) ? extracted.skills : [],
      projects: Array.isArray(extracted.projects) ? extracted.projects : [],
      certifications: Array.isArray(extracted.certifications) ? extracted.certifications : [],
      experience: Array.isArray(extracted.experience) ? extracted.experience : [],
      internships: Array.isArray(extracted.internships) ? extracted.internships : [],
      achievements: Array.isArray(extracted.achievements) ? extracted.achievements : [],
      interests: Array.isArray(extracted.interests) ? extracted.interests : [],
      meta: extractedStructure?.meta || {
        wordCount: rawText.split(/\s+/).filter(Boolean).length,
        pageCount: 0,
        hasText: true,
        parsedAt: new Date().toISOString(),
      },
    };

    console.log('[RESUME] Saving parsed resume to Firestore...');
    // ── Store full parsed result at resumes/{UID}/data/parsed ─────────────
    await db.setResume(req.uid, {
      name:           aiParsed.name,
      email:          aiParsed.email,
      phone:          aiParsed.phone,
      linkedin:       aiParsed.linkedin,
      github:         aiParsed.github,
      cgpa:           aiParsed.cgpa,
      branch:         aiParsed.branch,
      academicYear:   aiParsed.academicYear,
      education:      aiParsed.education,
      skills:         aiParsed.skills,
      projects:       aiParsed.projects,
      experience:     aiParsed.experience,
      internships:    aiParsed.internships,
      certifications: aiParsed.certifications,
      achievements:   aiParsed.achievements,
      interests:      aiParsed.interests,
      meta:           aiParsed.meta,
    });

    // ── Promote key fields into users/{UID} (only when not already set) ──────
    const student = (await db.getStudent(req.uid)) || { uid: req.uid, skills: [] };
    const topLevel = {
      resumeUrl:    '',
      resumePath:   '',
      resumeParsed: true,
      updatedAt:    FieldValue.serverTimestamp(),
      phone:        aiParsed.phone,
      branch:       aiParsed.branch,
      academicYear: aiParsed.academicYear,
      cgpa:         aiParsed.cgpa,
      skills:       aiParsed.skills,
      projects:     aiParsed.projects,
      experience:   aiParsed.experience,
      internships:  aiParsed.internships,
      certifications: aiParsed.certifications,
      achievements: aiParsed.achievements,
    };

    await db.updateStudent(req.uid, topLevel);
    console.log('[RESUME] Student resume profile saved');

    res.json({
      success: true,
      message: 'Resume parsed and stored successfully.',
      parsed: {
        name:           aiParsed.name,
        email:          aiParsed.email,
        phone:          aiParsed.phone,
        linkedin:       aiParsed.linkedin,
        github:         aiParsed.github,
        branch:         aiParsed.branch,
        academicYear:   aiParsed.academicYear,
        cgpa:           aiParsed.cgpa,
        education:      aiParsed.education,
        skills:         aiParsed.skills,
        projects:       aiParsed.projects,
        experience:     aiParsed.experience,
        internships:    aiParsed.internships,
        certifications: aiParsed.certifications,
        achievements:   aiParsed.achievements,
        interests:      aiParsed.interests,
        meta:           aiParsed.meta,
      },
    });
  } catch (err) {
    fs.unlink(filePath, () => {});
    console.error('[RESUME ERROR]', err);
    res.status(500).json({ success: false, message: 'Resume processing failed', error: err.message });
  }
});

// ─── POST /api/resume/parse-manual ────────────────────────────────────────────
router.post('/parse-manual', auth, async (req, res) => {
  try {
    const { skillsText } = req.body;
    if (!skillsText) return res.status(400).json({ message: 'skillsText is required.' });
    const skills = extractSkillsFromText(skillsText);
    res.json({ success: true, skills });
  } catch (err) {
    res.status(500).json({ message: 'Parse failed', error: err.message });
  }
});

// ─── GET /api/resume/parsed ───────────────────────────────────────────────────
router.get('/parsed', auth, async (req, res) => {
  try {
    const student = await db.getStudent(req.uid);
    if (!student?.resumeParsed) {
      return res.status(404).json({ success: false, message: 'No parsed resume found. Please upload your resume first.' });
    }

    const parsed = await db.getResume(req.uid);
    if (!parsed || !parsed.meta?.hasText) {
      return res.status(404).json({ success: false, message: 'No parsed resume found. Please upload your resume first.' });
    }

    res.json({ success: true, resumeUrl: student.resumeUrl, parsed });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to retrieve parsed resume.', error: err.message });
  }
});

module.exports = router;
