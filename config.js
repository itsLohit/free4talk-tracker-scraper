require('dotenv').config();

// Parse DATABASE_URL properly with SSL support
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
      // Always use SSL for cloud databases
      ssl: {
        rejectUnauthorized: false  // Aiven uses self-signed certs
      }
    };
  }

  throw new Error('Invalid DATABASE_URL format');
}

module.exports = {
  db: parseDatabaseUrl(process.env.DATABASE_URL),
  scraper: {
    url: 'https://free4talk.com/',
    interval: 5000, // 60 seconds (optimized for Railway)
  },
};
