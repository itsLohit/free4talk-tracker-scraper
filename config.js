require('dotenv').config();

module.exports = {
    // Database
    DB_CONNECTION_STRING: process.env.DATABASE_URL,
    
    // Scraper Settings
    // Fallback to free4talk.com if ENV variable is missing
    TARGET_URL: process.env.TARGET_URL || 'https://www.free4talk.com',
    API_URL_PATTERN: 'https://www.free4talk.com/api/v1/rooms',
    
    // Server
    PORT: process.env.PORT || 8080
};
