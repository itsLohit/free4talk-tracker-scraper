require('dotenv').config();

// Parse DATABASE_URL from Render (format: postgres://user:pass@host:port/dbname)
function parseDatabaseUrl(url) {
  if (!url) {
    // Fallback to individual env vars for local development
    return {
      host: process.env.DB_HOST || 'localhost',
      port: parseInt(process.env.DB_PORT || '5432'),
      database: process.env.DB_NAME || 'free4talk_tracker',
      user: process.env.DB_USER || 'lohit',
      password: process.env.DB_PASSWORD || '',
    };
  }

  const match = url.match(/postgres:\/\/([^:]+):([^@]+)@([^:]+):(\d+)\/(.+)/);
  if (match) {
    return {
      user: match[1],
      password: match[2],
      host: match[3],
      port: parseInt(match[4]),
      database: match[5],
    };
  }

  throw new Error('Invalid DATABASE_URL format');
}

module.exports = {
  db: parseDatabaseUrl(process.env.DATABASE_URL),
  scraper: {
    url: 'https://free4talk.com/',
    interval: 30000, // 30 seconds
  },
};
