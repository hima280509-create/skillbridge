'use strict';

const db = require('./firestoreService');
const calc = require('./calculationService');
const gemini = require('./geminiService');

const CAREER_NAME_FIELDS = ['Career_Name', 'careerName', 'careerTitle', 'Career', 'name'];
const SKILL_CAREER_FIELDS = ['Career_Name', 'careerName', 'careerTitle', 'Career', 'career'];
const REQUIRED_SKILL_FIELDS = ['Skill_Name', 'requiredSkills', 'Required_Skills', 'skills', 'skill'];

function firstField(record, fields) {
  if (!record || typeof record !== 'object') return '';
  return fields.map(field => record[field]).find(value => value !== undefined && value !== null && value !== '');
}

function careerName(career) {
  return firstField(career, CAREER_NAME_FIELDS) || '';
}

function normalizeCareerName(value) {
  return (value || '')
    .toString()
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

  const normalizeCareerText = normalizeCareerName;

function sameSkill(left, right) {
  return calc.normalizeSkill(left) === calc.normalizeSkill(right) || calc.skillsRelated(left, right);
}

function skillValues(value) {
  if (!Array.isArray(value)) return value ? [value] : [];
  return value.flatMap(item => {
    if (typeof item === 'string') return [item];
    if (!item || typeof item !== 'object') return [];
    return [item.name, item.skill, item.title].filter(Boolean);
  });
}

function cleanSkillValues(values) {
  return [...new Map(skillValues(values)
    .filter(value => typeof value === 'string' || typeof value === 'number')
    .map(value => String(value).trim())
    .filter(Boolean)
    .map(skill => [calc.normalizeSkill(skill), skill]))
    .values()];
}

async function resolveCareer(careerGoal, careers) {
  const goal = String(careerGoal || '').trim();
  if (!goal) return null;

  const normalizedGoal = normalizeCareerText(goal);
  const candidates = careers.filter(Boolean);

  const exact = candidates.find(career => {
    const name = careerName(career);
    return normalizeCareerText(name) === normalizedGoal || normalizeCareerText(name).includes(normalizedGoal) || normalizedGoal.includes(normalizeCareerText(name));
  });
  if (exact) return exact;

  const aliasMatch = candidates.find(career => {
    const aliases = [careerName(career), career?.aliases, career?.alias, career?.keywords, career?.relatedCareers]
      .flatMap(item => Array.isArray(item) ? item : (item ? [item] : []))
      .map(normalizeCareerText)
      .filter(Boolean);
    return aliases.some(alias => alias === normalizedGoal || alias.includes(normalizedGoal) || normalizedGoal.includes(alias));
  });
  if (aliasMatch) return aliasMatch;

  const semantic = await gemini.resolveCareerGoal(careerGoal, candidates).catch(() => null);
  return semantic ? candidates.find(career => String(career.id) === String(semantic.id) || normalizeCareerText(careerName(career)) === normalizeCareerText(semantic.name || semantic.careerName || '')) || null : null;
}

async function getCareerSkillResult(student) {
  const careerGoal = String(student?.careerGoal || '').trim();
  const resume = student?.uid ? await db.getResume(student.uid) : null;
  const userSkills = [
    ...skillValues(student?.skills),
    ...skillValues(student?.resumeSkills),
    ...skillValues(student?.resume?.skills),
    ...skillValues(resume?.skills),
    ...skillValues(resume?.resumeSkills),
  ];
  const uniqueUserSkills = [...new Map(userSkills
    .filter(Boolean)
    .map(skill => [calc.normalizeSkill(skill), String(skill).trim()]))
    .values()];

  if (!careerGoal) {
    return { careerGoal, matchedCareer: null, requiredSkills: [], userSkills: uniqueUserSkills, matchedSkills: [], missingSkills: [], skillMatchPercentage: 0 };
  }

  const careers = await db.getCollection('careers', { isActive: true });
  console.log('[CareerSkills] Loaded career dataset:', {
    careerRecordsLoaded: careers.length,
    careerNameField: CAREER_NAME_FIELDS.join(', '),
  });
  let matchedCareer = null;

  if (student?.matchedCareerId) {
    matchedCareer = careers.find(career => String(career.id) === String(student.matchedCareerId)) || null;
  }

  if (!matchedCareer && student?.normalizedCareerGoal) {
    matchedCareer = careers.find(career => {
      const name = careerName(career);
      return normalizeCareerText(name) === normalizeCareerText(student.normalizedCareerGoal) || normalizeCareerText(name).includes(normalizeCareerText(student.normalizedCareerGoal));
    }) || null;
  }

  if (!matchedCareer) {
    matchedCareer = await resolveCareer(careerGoal, careers);
  }

  if (!matchedCareer) {
    console.error('[CareerSkills] Career lookup failed:', {
      selectedCareerName: careerGoal,
      careerNameField: CAREER_NAME_FIELDS.join(', '),
      careerRecordsLoaded: careers.length,
      availableCareerNames: careers.map(careerName).filter(Boolean),
    });
    return { careerGoal, matchedCareer: null, requiredSkills: [], userSkills: uniqueUserSkills, matchedSkills: [], missingSkills: [], skillMatchPercentage: 0 };
  }

  const name = careerName(matchedCareer);
  const skills = await db.getCollection('skills', { isActive: true });
  const linkedSkills = skills
    .filter(skill => normalizeCareerName(firstField(skill, SKILL_CAREER_FIELDS)) === normalizeCareerName(name))
    .flatMap(skill => skillValues(firstField(skill, REQUIRED_SKILL_FIELDS)));
  const careerRecordSkills = REQUIRED_SKILL_FIELDS.flatMap(field => skillValues(matchedCareer[field]));
  const distinctRequiredSkills = cleanSkillValues([...linkedSkills, ...careerRecordSkills]);

  if (distinctRequiredSkills.length === 0) {
    console.error('[CareerSkills] Career has no required skills:', {
      selectedCareerName: careerGoal,
      matchedCareerName: name,
      careerNameField: CAREER_NAME_FIELDS.join(', '),
      careerRecordsLoaded: careers.length,
      skillRecordsLoaded: skills.length,
      skillCareerNameField: SKILL_CAREER_FIELDS.join(', '),
      requiredSkillField: REQUIRED_SKILL_FIELDS.join(', '),
    });
  }
  console.log('[CareerSkills] Matched career record:', {
    selectedCareerName: careerGoal,
    matchedCareerName: name,
    requiredSkills: distinctRequiredSkills,
  });
  const skillMatch = calc.calculateSkillMatch(uniqueUserSkills, distinctRequiredSkills);
  const matchedSkills = distinctRequiredSkills.filter(required => skillMatch.matchedSkills.some(matched => sameSkill(matched, required)));
  const missingSkills = distinctRequiredSkills.filter(required => !matchedSkills.some(matched => sameSkill(matched, required)));

  const normalizedCareerGoal = name || student.normalizedCareerGoal || careerGoal;

  return {
    careerGoal,
    normalizedCareerGoal,
    matchedCareer,
    matchedCareerId: matchedCareer.id,
    requiredSkills: distinctRequiredSkills,
    userSkills: uniqueUserSkills,
    matchedSkills,
    missingSkills,
    skillMatchPercentage: skillMatch.skillMatchPercentage,
  };
}

module.exports = { getCareerSkillResult, resolveCareer, normalizeCareerName };