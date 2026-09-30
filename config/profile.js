const path = require('path');
require('dotenv').config();

const profile = {
  candidateName: process.env.CANDIDATE_NAME || 'Mayuresh Tardekar',
  experienceYears: parseInt(process.env.EXPERIENCE_YEARS, 10) || 0,
  noticePeriodDays: parseInt(process.env.NOTICE_PERIOD_DAYS, 10) || 0, // 0 = Immediate joiner
  expectedCtcLakhs: parseFloat(process.env.EXPECTED_CTC_LAKHS) || 9.5, // 8-11 LPA target band
  currentCtcLakhs: parseFloat(process.env.CURRENT_CTC_LAKHS) || 0,
  primaryLocation: process.env.PRIMARY_LOCATION || 'Mumbai',
  willingToRelocate: true,

  targetLocations: [
    'Mumbai',
    'Navi Mumbai',
    'Pune',
    'Bangalore',
    'Bengaluru',
    'Hyderabad',
    'Remote',
  ],

  education: {
    degree: 'Master of Computer Applications (MCA)',
    institute: 'Sardar Patel Institute of Technology (SPIT)',
    graduationYear: 2027,
    undergradDegree: 'Bachelor of Science in Information Technology (B.Sc IT)',
    undergradInstitute: 'Thakur Ramnarayan College (TRCAC)',
  },

  skills: [
    'Java',
    'Spring Boot',
    'Python',
    'GenAI',
    'Generative AI',
    'RAG',
    'LLM',
    'Vector Search',
    'pgvector',
    'FastAPI',
    'Node.js',
    'Express.js',
    'TypeScript',
    'REST APIs',
    'PostgreSQL',
    'MySQL',
    'Supabase',
    'Redis',
    'Docker',
    'AWS',
    'Git',
    'Data Pipelines',
    'ETL',
  ],

  resumePath: path.resolve(__dirname, '..', process.env.RESUME_FILE_PATH || 'Resume.pdf'),
};

module.exports = Object.freeze(profile);
