require('dotenv').config();

/**
 * Parse DATABASE_URL with proper SSL support for cloud databases
 */
function parseDatabaseUrl(url) {
  if (!url) {
    // Fallback for local development
    return {
      host: process.env.DB_HOST || 'localhost',
      port: parseInt(process.env.DB_PORT || '5432'),
      database: process.env.DB_NAME || 'free4talk_tracker',
      user: process.env.DB_USER || 'lohit',
      password: process.env.DB_PASSWORD || '',
    };
  }

  // Remove query parameters before parsing
  const [baseUrl, queryString] = url.split('?');
  
  const match = baseUrl.match(/postgres:\/\/([^:]+):([^@]+)@([^:]+):(\d+)\/(.+)/);
  if (match) {
    return {
      user: match[1],
      password: match[2],
      host: match[3],
      port: parseInt(match[4]),
      database: match[5],
      // SSL configuration for cloud databases (Aiven, etc.)
      ssl: {
        rejectUnauthorized: false
      }
    };
  }

  throw new Error('Invalid DATABASE_URL format');
}

module.exports = {
  db: parseDatabaseUrl(process.env.DATABASE_URL),
  scraper: {
    url: 'https://free4talk.com/',
    interval: 3000, // 3 seconds between cycles (optimized)
    scrollWait: 200, // milliseconds to wait after each scroll
    initialWait: 300, // milliseconds to wait for initial page load
    maxScrolls: 50, // maximum number of scrolls
    scrollsWithoutNew: 3, // stop after N scrolls with no new rooms
    batchSize: 30, // process N rooms in parallel
  },
};
