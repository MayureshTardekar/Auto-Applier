const formatTime = () => new Date().toLocaleTimeString('en-US', { hour12: false });

const logger = {
  info: (message, context = '') => {
    const ctx = context ? ` [${context}]` : '';
    console.log(`\x1b[36m[INFO ${formatTime()}]${ctx}\x1b[0m ${message}`);
  },

  success: (message, context = '') => {
    const ctx = context ? ` [${context}]` : '';
    console.log(`\x1b[32m[SUCCESS ${formatTime()}]${ctx}\x1b[0m ${message}`);
  },

  warn: (message, context = '') => {
    const ctx = context ? ` [${context}]` : '';
    console.log(`\x1b[33m[WARN ${formatTime()}]${ctx}\x1b[0m ${message}`);
  },

  error: (message, error = null, context = '') => {
    const ctx = context ? ` [${context}]` : '';
    const errDetails = error ? ` -> ${error.message || error}` : '';
    console.error(`\x1b[31m[ERROR ${formatTime()}]${ctx}\x1b[0m ${message}${errDetails}`);
  },

  skip: (reason, item = '') => {
    const itm = item ? ` (${item})` : '';
    console.log(`\x1b[90m[SKIP ${formatTime()}]\x1b[0m ${reason}${itm}`);
  },

  header: (title) => {
    console.log('\n' + '='.repeat(50));
    console.log(`  ${title.toUpperCase()}`);
    console.log('='.repeat(50) + '\n');
  },
};

module.exports = logger;
