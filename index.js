// index.js - FIXED VERSION
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const { chromium } = require('playwright');
const Database = require('./db');
const Free4TalkTracker = require('./tracker');
const { parseHomepage } = require('./parser');
const config = require('./config');

class Free4TalkScraper {
  constructor() {
    this.browser = null;
    this.page = null;
    this.db = null;
    this.tracker = null;
  }

  async initialize() {
    console.log('🚀 Initializing Free4Talk Tracker...');

    // Initialize database
    this.db = new Database();
    await this.db.connect();

    // Launch browser
    const browser = await chromium.launch({
      headless: config.HEADLESS,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--disable-gpu'
      ]
    });

    this.page = await this.browser.newPage();

    // Set viewport
    await this.page.setViewport({ width: 1920, height: 1080 });

    // Set user agent
    await this.page.setUserAgent(
      'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    );

    // Initialize tracker
    this.tracker = new Free4TalkTracker(this.page, this.db);

    console.log('✅ Initialization complete');
  }

  /**
   * FIXED: Multi-level discovery strategy
   */
  async startTracking() {
    console.log('\n' + '='.repeat(80));
    console.log('🚀 STARTING FREE4TALK COMPREHENSIVE TRACKING');
    console.log('='.repeat(80));

    let iteration = 0;

    while (true) {
      try {
        iteration++;
        const startTime = Date.now();

        console.log('\n' + '━'.repeat(80));
        console.log(`📊 ITERATION ${iteration} - ${new Date().toISOString()}`);
        console.log('━'.repeat(80));

        // Reset tracking sets for new iteration
        this.tracker.resetTracking();

        // LEVEL 1: Scrape homepage for initial discovery
        console.log('\n📍 LEVEL 1: Homepage Discovery');
        console.log('-'.repeat(80));
        const homepageUsers = await this.scrapeHomepage();
        console.log(`✅ Discovered ${homepageUsers.length} users from homepage`);

        // LEVEL 2: Discover users from rooms
        console.log('\n📍 LEVEL 2: Room Participant Discovery');
        console.log('-'.repeat(80));
        const roomUsers = await this.tracker.discoverUsersFromRooms();
        console.log(`✅ Discovered ${roomUsers.length} users from rooms`);

        // Combine all discovered users
        const allDiscoveredUsers = new Set([...homepageUsers, ...roomUsers]);
        console.log(`\n📊 Total unique users discovered: ${allDiscoveredUsers.size}`);

        // LEVEL 3: Deep profile tracking
        console.log('\n📍 LEVEL 3: Deep Profile Tracking');
        console.log('-'.repeat(80));

        let tracked = 0;
        let failed = 0;

        for (const username of allDiscoveredUsers) {
          try {
            // Track profile with deep=true for first 20 users (to get relationships)
            const deep = tracked < 20;
            const user = await this.tracker.trackUserProfile(username, deep);

            if (user) {
              tracked++;
              console.log(`  [${tracked}/${allDiscoveredUsers.size}] ✅ ${username}`);
            } else {
              failed++;
              console.log(`  [${tracked + failed}/${allDiscoveredUsers.size}] ❌ ${username}`);
            }

            // Rate limiting
            await this.sleep(config.RATE_LIMIT_MS || 2000);

          } catch (error) {
            failed++;
            console.error(`  [${tracked + failed}/${allDiscoveredUsers.size}] ❌ ${username}: ${error.message}`);
          }
        }

        // Get statistics
        const stats = await this.db.getStats();
        const elapsed = ((Date.now() - startTime) / 1000 / 60).toFixed(2);

        console.log('\n' + '━'.repeat(80));
        console.log('📊 ITERATION SUMMARY');
        console.log('━'.repeat(80));
        console.log(`✅ Successfully tracked: ${tracked} users`);
        console.log(`❌ Failed: ${failed} users`);
        console.log(`⏱️  Time elapsed: ${elapsed} minutes`);
        console.log('\n📈 DATABASE STATISTICS:');
        console.log(`   👤 Total users: ${stats.user_count}`);
        console.log(`   🏠 Total rooms: ${stats.room_count}`);
        console.log(`   📝 Total sessions: ${stats.session_count}`);
        console.log(`   🔗 Total relationships: ${stats.relationship_count}`);
        console.log(`   👥 Active participants: ${stats.active_participant_count}`);
        console.log('━'.repeat(80));

        // Wait before next iteration
        console.log(`\n⏳ Waiting ${config.SCRAPE_INTERVAL / 1000 / 60} minutes until next iteration...`);
        await this.sleep(config.SCRAPE_INTERVAL);

      } catch (error) {
        console.error('\n❌ ERROR IN TRACKING LOOP:', error);
        console.error(error.stack);

        // Wait before retrying
        console.log('⏳ Waiting 60 seconds before retry...');
        await this.sleep(60000);
      }
    }
  }

  /**
   * Scrape homepage for initial user discovery
   */
  async scrapeHomepage() {
    try {
      console.log('  🌐 Navigating to Free4Talk homepage...');

      await this.page.goto('https://free4talk.com', {
        waitUntil: 'networkidle2',
        timeout: 30000
      });

      await this.sleep(2000);

      // Get page HTML
      const html = await this.page.content();

      // Parse homepage
      const { users, rooms } = parseHomepage(html);

      console.log(`  📊 Parsed: ${users.length} users, ${rooms.length} rooms`);

      // Store basic user info from homepage
      for (const user of users) {
        await this.db.upsertUser({
          username: user.username,
          displayName: user.displayName,
          avatarUrl: user.avatarUrl,
          followerCount: 0,
          followingCount: 0,
          friendsCount: 0
        });
      }

      // Store rooms from homepage
      for (const room of rooms) {
        await this.db.upsertRoom({
          roomId: room.roomId,
          roomName: room.roomName,
          topic: room.topic,
          language: room.language,
          isPublic: room.isPublic,
          participantCount: room.participantCount
        });
      }

      return users.map(u => u.username);

    } catch (error) {
      console.error('  ❌ Error scraping homepage:', error.message);
      return [];
    }
  }

  /**
   * Helper: Sleep for ms
   */
  async sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Graceful shutdown
   */
  async shutdown() {
    console.log('\n🛑 Shutting down...');

    if (this.browser) {
      await this.browser.close();
      console.log('✅ Browser closed');
    }

    if (this.db) {
      await this.db.close();
      console.log('✅ Database connection closed');
    }

    console.log('👋 Goodbye!');
    process.exit(0);
  }
}

// Main execution
(async () => {
  const scraper = new Free4TalkScraper();

  // Handle shutdown signals
  process.on('SIGINT', () => scraper.shutdown());
  process.on('SIGTERM', () => scraper.shutdown());

  try {
    await scraper.initialize();
    await scraper.startTracking();
  } catch (error) {
    console.error('\n💥 FATAL ERROR:', error);
    console.error(error.stack);
    await scraper.shutdown();
  }
})();