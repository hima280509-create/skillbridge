'use strict';

const knowledgeBase = {
  name: 'SkillBridge',
  tagline: 'Right Skill • Right Guidance • Right Opportunity.',
  description: 'SkillBridge is an AI-powered career and opportunity navigator for students.',
  features: [
    'Dashboard',
    'AI Resume Analysis',
    'Career Analysis',
    'Skill Gap Analysis',
    'Personalized Learning Roadmap',
    'Jobs',
    'Internships',
    'Placements',
    'Competitions',
    'Free Certifications',
    'AI Career Chatbot',
    'Profile',
    'Deadline and opportunity tracking',
  ],
  explanations: {
    resume: 'AI Resume Analysis evaluates resume structure and career relevance using the profile and uploaded resume data. Final ATS scores are calculated by SkillBridge.',
    skillGap: 'Skill Gap Analysis compares the student skills with the canonical skills required for the selected career.',
    roadmap: 'The personalized roadmap is generated from the student career goal and canonical missing skills, then saved to the student profile.',
    opportunities: 'Opportunity recommendations come from the current SkillBridge Firestore datasets and are ranked against the student profile.',
    chatbot: 'The chatbot answers SkillBridge and career questions using the authenticated student profile, canonical career data, saved analysis, roadmap, and current opportunity data.',
  },
};

function getKnowledgeContext() {
  return knowledgeBase;
}

module.exports = { knowledgeBase, getKnowledgeContext };
