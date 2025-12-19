const express = require('express');
const cron = require('node-cron');
const { Pool } = require('pg');
const Free4TalkAPI = require('./apiDirectScraper');
const config = require('./config');

const app = express();
const PORT = process.env.PORT || 3000;

// Database connection (Aiven)
const pool = new Pool({
  connectionString: config.database.connectionString,
  ssl: { rejectUnauthorized: false }
});

// Test database connection
pool.query('SELECT NOW()', (err, res) => {
  if (err) {
    console.error('❌ Database connection failed:', err);
  } else {
    console.log('✅ Database connected:', res.rows[0].now);
  }
});

// API Scraper instance
const scraper = new Free4TalkAPI();

// Save to database function
async function saveToDatabase(groups) {
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');
    
    let savedCount = 0;
    
    for (const group of groups) {
      // Save group
      await client.query(`
        INSERT INTO groups (group_id, topic, language, level, client_count, scraped_at)
        VALUES ($1, $2, $3, $4, $5, NOW())
        ON CONFLICT (group_id) 
        DO UPDATE SET 
          topic = $2,
          language = $3,
          level = $4,
          client_count = $5,
          scraped_at = NOW()
      `, [
        group.groupId,
        group.topic,
        group.language,
        group.level,
        group.clients.length
      ]);

      // Save users
      for (const client of group.clients) {
        await pool.query(`
          INSERT INTO users (user_id, username, followers, scraped_at)
          VALUES ($1, $2, $3, NOW())
          ON CONFLICT (user_id)
          DO UPDATE SET
            username = $2,
            followers = $3,
            scraped_at = NOW()
        `, [client.id, client.username, client.followers]);
      }

      savedCount++;
    }
    
    await client.query('COMMIT');
    console.log(`✅ Saved ${savedCount} groups to database`);
    
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('❌ Database error:', error);
    throw error;
  } finally {
    client.release();
  }
}

// Main scraping function
async function runScraper() {
  console.log('\n🚀 Starting scrape at:', new Date().toISOString());
  
  try {
    // Fetch from API
    const rawData = await scraper.fetchGroups();
    
    // Parse data
    const { groups, userIds } = scraper.parseGroups(rawData);
    
    console.log(`📊 Found ${groups.length} groups, ${userIds.length} users`);
    
    // Save to database
    await saveToDatabase(groups);
    
    console.log('✅ Scrape completed successfully!\n');
    
  } catch (error) {
    console.error('❌ Scrape failed:', error.message);
  }
}

// Schedule scraping every 5 minutes
cron.schedule('*/5 * * * *', () => {
  console.log('⏰ Cron job triggered');
  runScraper();
});

// Run once on startup
runScraper();

// API Routes
app.get('/', (req, res) => {
  res.json({ 
    status: 'running',
    message: 'Free4Talk Scraper Active',
    time: new Date().toISOString()
  });
});

app.get('/api/groups', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM groups ORDER BY scraped_at DESC LIMIT 50');
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/users', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM users ORDER BY scraped_at DESC LIMIT 50');
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
