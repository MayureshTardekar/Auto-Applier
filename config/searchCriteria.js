const profile = require('./profile');

const searchCriteria = {
  // Primary search keywords for Naukri (broad keywords paired with experience=0 filter)
  queries: [
    'software engineer',
    'java developer',
    'spring boot developer',
    'backend developer',
    'python developer',
    'data analyst',
    'junior data analyst',
    'business intelligence analyst',
    'sql developer',
    'data engineer',
    'ai engineer',
    'machine learning engineer',
    'genai engineer',
    'graduate engineer trainee',
    'associate software engineer',
    'full stack developer',
  ],

  // Geographic filter parameters
  locations: profile.targetLocations,

  // Title must match at least one whitelist token to qualify for application
  titleWhitelist: [
    'software',
    'engineer',
    'developer',
    'trainee',
    'associate',
    'sde',
    'backend',
    'frontend',
    'full stack',
    'java',
    'spring',
    'python',
    'ai',
    'ml',
    'genai',
    'data',
    'analyst',
    'analytics',
    'bi',
    'sql',
    'tableau',
    'power bi',
    'etl',
    'graduate',
    'fresher',
    'intern',
    'programmer',
    'consultant',
  ],

  // Listings with any of these keywords in the title are immediately skipped
  titleBlacklist: [
    'senior',
    'sr.',
    'lead',
    'architect',
    'manager',
    'director',
    'principal',
    'staff',
    'sales',
    'bpo',
    'telecaller',
    'telecalling',
    'business development',
    'bde',
    'content writer',
    'unpaid',
    'accountant',
    'recruiter',
    'hr',
    'marketing executive',
    'php',
    'wordpress',
    'drupal',
    'salesforce',
    'seo',
  ],

  // Job freshness filter in days (e.g., 14 days for broad active openings)
  freshnessDays: 14,

  // Maximum experience to consider (years)
  maxExperienceYears: 1,
};

module.exports = Object.freeze(searchCriteria);
