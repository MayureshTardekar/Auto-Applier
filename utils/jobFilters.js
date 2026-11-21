const searchCriteria = require('../config/searchCriteria');

function escapeRegex(str) {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Token match that respects word boundaries, so short tokens like "hr" or
 * "bi" do not match inside words such as "Thrive" or "Mobile".
 */
function hasToken(text, token) {
  const escaped = escapeRegex(String(token).trim());
  if (!escaped) return false;
  const re = new RegExp(`(?<![a-z0-9])${escaped}(?![a-z0-9])`, 'i');
  return re.test(String(text || ''));
}

function isTitleRelevant(title) {
  const lower = String(title || '').toLowerCase();
  if (searchCriteria.titleBlacklist.some((bad) => hasToken(lower, bad))) return false;
  return searchCriteria.titleWhitelist.some((good) => hasToken(lower, good));
}

function isCompanyBlacklisted(company) {
  const lower = String(company || '').toLowerCase();
  if (!lower) return false;
  return (searchCriteria.companyBlacklist || []).some((bad) => lower.includes(bad));
}

/**
 * Minimum years required by an experience string such as "0-1 Yrs" or "2-5 Yrs".
 * Returns null when unknown (do not filter).
 */
function parseMinExperienceYears(text) {
  const lower = String(text || '').toLowerCase();
  if (!lower.trim() || lower.includes('fresher')) return 0;
  const nums = lower.match(/\d+(?:\.\d+)?/g);
  if (!nums) return null;
  return Math.min(...nums.map(Number));
}

/** Converts a posting-age string ("3 days ago", "2 weeks ago") to days. */
function parsePostedDaysAgo(text) {
  const lower = String(text || '').toLowerCase();
  if (!lower.trim()) return null;
  if (lower.includes('today') || lower.includes('just now') || /\b\d+\s*hour/.test(lower)) return 0;
  const day = lower.match(/(\d+)\s*day/);
  if (day) return Number(day[1]);
  const week = lower.match(/(\d+)\s*week/);
  if (week) return Number(week[1]) * 7;
  const month = lower.match(/(\d+)\s*month/);
  if (month) return Number(month[1]) * 30;
  return null;
}

function isLocationRelevant(location) {
  const lower = String(location || '').toLowerCase();
  if (!lower.trim()) return true;
  if (/work from home|remote|anywhere|multiple location/.test(lower)) return true;
  return searchCriteria.locations.some((loc) => lower.includes(loc.toLowerCase()));
}

function isStale(postedText, freshnessDays = searchCriteria.freshnessDays) {
  const days = parsePostedDaysAgo(postedText);
  return days !== null && days > freshnessDays;
}

function passesExperience(text, maxYears = searchCriteria.maxExperienceYears) {
  const min = parseMinExperienceYears(text);
  return min === null || min <= maxYears;
}

module.exports = {
  escapeRegex,
  hasToken,
  isTitleRelevant,
  isCompanyBlacklisted,
  parseMinExperienceYears,
  parsePostedDaysAgo,
  isLocationRelevant,
  isStale,
  passesExperience,
};
