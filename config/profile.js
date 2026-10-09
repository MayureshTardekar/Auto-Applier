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
    'Remote',
    'Bangalore',
    'Bengaluru',
    'Hyderabad',
    'Pune',
    'Mumbai',
    'Navi Mumbai',
    'Thane',
    'Chennai',
    'Kochi',
    'Coimbatore',
    'Trivandrum',
    'Ahmedabad',
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

  // Answers used for employer screening questions (Indeed Apply forms, etc.)
  screeningAnswers: {
    // Used for open-ended textareas ("what interests you", "why should we hire you", cover note...)
    coverNote:
      process.env.COVER_NOTE ||
      'I am an MCA graduate from SPIT with hands-on project experience in Java, Spring Boot, Python, FastAPI, Node.js, ' +
        'PostgreSQL and Redis, and I have built GenAI applications using RAG, LLMs and vector search. I enjoy building ' +
        'reliable backend systems and APIs, I learn quickly, and I can join immediately. I would be glad to contribute ' +
        'to your development team and grow with it.',
    startDate: process.env.START_DATE_ANSWER || 'Immediately',
    // Yes/No questions matching these patterns get "Yes"
    yesQuestionPattern:
      'relocat|commute|willing|authori[sz]ed|legally|available|comfortable|immediate|english|communicat|language|' +
      'fresher|bachelor|master|degree|graduat|reliabl|background check|onsite|on-site|office|hybrid|shift|start',
    // Yes/No questions matching these patterns get "No"
    noQuestionPattern: 'sponsor|visa|convict|criminal|disabilit|non-compete|bond',
    // For any other required Yes/No question, answer "Yes" (set DEFAULT_YES_FOR_UNKNOWN=false to skip such jobs instead)
    defaultYesForUnknown: process.env.DEFAULT_YES_FOR_UNKNOWN !== 'false',
  },

  resumePath: path.resolve(__dirname, '..', process.env.RESUME_FILE_PATH || 'Resume.pdf'),
};

module.exports = Object.freeze(profile);
