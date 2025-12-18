require('dotenv').config();

// Parse DATABASE_URL from Render or use individual env vars
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

  // Handle both postgres:// and postgresql:// formats
  const urlPattern = /^postgres(?:ql)?:\/\/([^:]+):([^@]+)@([^:\/]+)(?::(\d+))?\/(.+?)(?:\?.*)?$/;
  const match = url.match(urlPattern);
  
  if (match) {
    return {
      user: decodeURIComponent(match[1]),
      password: decodeURIComponent(match[2]),
      host: match[3],
      port: parseInt(match[4] || '5432'),
      database: match[5].split('?')[0], // Remove query params
      ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
    };
  }

  console.error('DATABASE_URL format not recognized:', url);
  throw new Error('Invalid DATABASE_URL format');
}

module.exports = {
  db: parseDatabaseUrl(process.env.DATABASE_URL),
  scraper: {
    url: 'https://free4talk.com/',
    interval: 30000, // 30 seconds
  },
};
