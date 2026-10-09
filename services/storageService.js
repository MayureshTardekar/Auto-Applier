const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');

const DATA_DIR = path.resolve(__dirname, '..', 'data');

class StorageService {
  constructor(platform = 'naukri') {
    this.platform = platform.toLowerCase();
    this._ensureDataDir();

    // Support legacy applied_jobs.json for naukri, or partitioned names
    if (this.platform === 'naukri' && fs.existsSync(path.join(DATA_DIR, 'applied_jobs.json'))) {
      this.appliedFile = path.join(DATA_DIR, 'applied_jobs.json');
      this.skippedFile = path.join(DATA_DIR, 'skipped_jobs.json');
    } else {
      this.appliedFile = path.join(DATA_DIR, `applied_${this.platform}.json`);
      this.skippedFile = path.join(DATA_DIR, `skipped_${this.platform}.json`);
    }

    this.appliedJobs = this._loadJson(this.appliedFile);
    this.skippedJobs = this._loadJson(this.skippedFile);
  }

  _ensureDataDir() {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
  }

  _loadJson(filePath) {
    try {
      if (fs.existsSync(filePath)) {
        const raw = fs.readFileSync(filePath, 'utf8');
        return JSON.parse(raw);
      }
    } catch (err) {
      logger.error(`Failed to load ${path.basename(filePath)}, starting with empty cache`, err);
    }
    return {};
  }

  _saveJson(filePath, data) {
    try {
      fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
    } catch (err) {
      logger.error(`Failed to write ${path.basename(filePath)}`, err);
    }
  }

  extractJobId(urlOrId) {
    if (!urlOrId) return null;
    const str = String(urlOrId);
    const match = str.match(/-(\d{8,})\?/i) || str.match(/-(\d{8,})$/i) || str.match(/jobId=(\d+)/i) || str.match(/(\d{6,})/);
    return match ? match[1] : str.replace(/[^a-zA-Z0-9_-]/g, '_');
  }

  hasApplied(jobId) {
    if (!jobId) return false;
    return Boolean(this.appliedJobs[jobId]);
  }

  hasSkipped(jobId) {
    if (!jobId) return false;
    return Boolean(this.skippedJobs[jobId]);
  }

  recordApplied(jobId, jobDetails) {
    if (!jobId) return;
    this.appliedJobs[jobId] = {
      ...jobDetails,
      platform: this.platform,
      appliedAt: new Date().toISOString(),
    };
    this._saveJson(this.appliedFile, this.appliedJobs);
  }

  recordSkipped(jobId, jobDetails, reason) {
    if (!jobId) return;
    this.skippedJobs[jobId] = {
      ...jobDetails,
      platform: this.platform,
      reason,
      skippedAt: new Date().toISOString(),
    };
    this._saveJson(this.skippedFile, this.skippedJobs);
  }

  /**
   * Removes skipped entries matching the predicate so they are retried on the next run.
   * @param {(entry: object) => boolean} shouldClear
   * @returns {number} number of entries removed
   */
  clearSkipped(shouldClear) {
    let removed = 0;
    for (const [jobId, entry] of Object.entries(this.skippedJobs)) {
      if (shouldClear(entry)) {
        delete this.skippedJobs[jobId];
        removed++;
      }
    }
    if (removed > 0) this._saveJson(this.skippedFile, this.skippedJobs);
    return removed;
  }

  getTodayApplicationCount() {
    const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
    return Object.values(this.appliedJobs).filter((entry) => {
      const timestamp = new Date(entry.appliedAt).getTime();
      return timestamp > oneDayAgo;
    }).length;
  }

  canApplyToday(maxDailyLimit) {
    const count = this.getTodayApplicationCount();
    return count < maxDailyLimit;
  }
}

// Default export is pre-bound to 'naukri' for backwards compatibility
const defaultInstance = new StorageService('naukri');
defaultInstance.getStorage = (platform) => new StorageService(platform);
defaultInstance.StorageService = StorageService;

module.exports = defaultInstance;
