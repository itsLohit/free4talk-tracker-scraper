const { chromium } = require('playwright');
const config = require('./config');
const SessionTracker = require('./tracker');
const db = require('./db');
const http = require('http');
const cheerio = require('cheerio');

// Health check server for Railway
const server = http.createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('OK');
  }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Health check server running on port ${PORT}`);
});

// Global instances (reused across cycles)
const tracker = new SessionTracker();
let globalBrowser = null;
let globalContext = null;
let globalPage = null;

/**
 * Helper: Wait for specified milliseconds
 */
function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Get or create browser instance (reused for performance)
 */
async function getBrowser() {
  try {
    if (!globalBrowser || !globalBrowser.isConnected()) {
      console.log('🌐 Launching browser...');
      globalBrowser = await chromium.launch({
        headless: true,
        args: [
          '--disable-blink-features=AutomationControlled',
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-gpu'
        ]
      });

      globalContext = await globalBrowser.newContext({
        viewport: { width: 1920, height: 1080 },
        userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      });

      globalPage = await globalContext.newPage();
    }
    return { browser: globalBrowser, page: globalPage };
  } catch (error) {
    // Reset on error
    globalBrowser = null;
    globalContext = null;
    globalPage = null;
    throw error;
  }
}

/**
 * Fetch and collect all room data (PHASE 1: Fast Scrolling)
 */
async function fetchAndProcessRooms() {
  try {
    const { page } = await getBrowser();

    console.log(`🌐 Navigating to ${config.scraper.url}...`);
    await page.goto(config.scraper.url, {
      waitUntil: 'domcontentloaded',
      timeout: 30000
    });

    console.log('⏳ Waiting for content to load...');
    await page.waitForSelector('.group-list', { timeout: 15000 });
    await wait(config.scraper.initialWait);

    console.log('📜 Scrolling and collecting rooms...\n');

    const processedRoomIds = new Set();
    let scrollsWithoutNewRooms = 0;
    const allRoomsData = [];

    // PHASE 1: Fast scrolling - collect HTML only (no DB operations)
    for (let i = 0; i < config.scraper.maxScrolls; i++) {
      // Extract room HTML from page
      const roomsHtml = await page.evaluate(() => {
        const rooms = [];
        document.querySelectorAll('.group-item:not(.fake)').forEach(roomEl => {
          const idElement = roomEl.querySelector('[id^="group-"]');
          const roomId = idElement ? idElement.id.replace('group-', '') : null;
          if (roomId && !roomId.includes('fake')) {
            rooms.push({
              id: roomId,
              html: roomEl.outerHTML
            });
          }
        });
        return rooms;
      });

      let newRoomsCount = 0;

      // Parse HTML and collect room data
      for (const { id, html } of roomsHtml) {
        if (!processedRoomIds.has(id)) {
          processedRoomIds.add(id);
          
          const $ = cheerio.load(html);
          const $room = $('.group-item').first();

          const language = $room.find('.sc-kvZOFW').text().trim() || 'Unknown';
          const rawSkillLevel = $room.find('.sc-hqyNC').text().trim() || 'Any Level';
          const topic = $room.find('.sc-jbKcbu .notranslate').text().trim() || 'Anything';

          const participants = [];
          $room.find('.client-item').each((idx, clientEl) => {
            const $client = $(clientEl);
            const isEmptySlot = $client.find('.blind').text().includes('Empty Slot') ||
              $client.find('button[disabled]').length > 0;

            if (isEmptySlot) return;

            const username = $client.find('button[aria-label]').attr('aria-label');
            if (!username || username === 'Empty Slot') return;

            const followerText = $client.find('.followers-btn').text().trim();
            const followerMatch = followerText.match(/(\d+)/);
            const followers = followerMatch ? parseInt(followerMatch[1]) : 0;

            participants.push({
              username,
              followers,
              position: idx + 1
            });
          });

          allRoomsData.push({
            room_id: id,
            language,
            skill_level: rawSkillLevel,
            topic,
            participants
          });

          newRoomsCount++;
        }
      }

      const statusIcon = newRoomsCount > 0 ? '✅' : '⏸️';
      console.log(`  ${statusIcon} Scroll ${i + 1}: ${processedRoomIds.size} total rooms (+${newRoomsCount} new)`);

      // Check if we should stop
      if (newRoomsCount === 0) {
        scrollsWithoutNewRooms++;
        if (scrollsWithoutNewRooms >= config.scraper.scrollsWithoutNew) {
          console.log(`\n✅ Collected all ${processedRoomIds.size} rooms\n`);
          break;
        }
      } else {
        scrollsWithoutNewRooms = 0;
      }

      // Scroll to load more rooms
      await page.evaluate(() => window.scrollBy(0, window.innerHeight * 1.5));
      await wait(config.scraper.scrollWait);
    }

    // PHASE 2: Process all collected data in batches
    console.log('💾 Processing data...');
    const { totalJoins, totalLeaves } = await processBatchRooms(allRoomsData);

    return {
      roomCount: processedRoomIds.size,
      totalJoins,
      totalLeaves
    };

  } catch (error) {
    console.error('❌ Error in fetchAndProcessRooms:', error.message);
    // Reset browser on error
    if (globalBrowser) {
      try { await globalBrowser.close(); } catch (e) {}
      globalBrowser = null;
      globalContext = null;
      globalPage = null;
    }
    throw error;
  }
}

/**
 * Process all rooms in batches (PHASE 2: Database Operations)
 */
async function processBatchRooms(allRoomsData) {
  console.log(`  Processing ${allRoomsData.length} rooms in batches...\n`);
  
  let totalJoins = 0;
  let totalLeaves = 0;

  const batchSize = config.scraper.batchSize;
  
  for (let i = 0; i < allRoomsData.length; i += batchSize) {
    const batch = allRoomsData.slice(i, i + batchSize);
    const batchNum = Math.floor(i / batchSize) + 1;
    
    try {
      // Process batch in parallel
      const results = await Promise.all(
        batch.map(async (roomData) => {
          try {
            // Normalize skill level
            const skillLevelMap = {
              'beginner': 'Beginner',
              'intermediate': 'Intermediate',
              'upper intermediate': 'Advanced',
              'advanced': 'Advanced',
              'upper advanced': 'Upper Advanced',
              'any level': 'Any Level',
              'all levels': 'Any Level',
            };
            const skill_level = skillLevelMap[roomData.skill_level.toLowerCase().trim()] || 'Any Level';

            // Upsert room
            await db.upsertRoom({
              room_id: roomData.room_id,
              language: roomData.language,
              skill_level,
              topic: roomData.topic,
              max_capacity: -1,
              is_active: true,
              is_full: false,
              is_empty: roomData.participants.length === 0,
              allows_unlimited: true,
              mic_allowed: true,
              mic_required: false,
            });

            // Process participants
            const participantsData = roomData.participants.map(p => ({
              user_id: p.username.toLowerCase().replace(/[^a-z0-9]/g, '-'),
              username: p.username,
              user_avatar: null,
              followers_count: p.followers,
              verification_status: 'UNVERIFIED',
              position: p.position,
            }));
            roomData.participants = participantsData;

            // Track sessions
            const { joined, left } = await tracker.processRoom(roomData);
            return { joined, left, success: true };

          } catch (error) {
            console.error(`  ⚠️  Error processing room ${roomData.room_id}:`, error.message);
            return { joined: 0, left: 0, success: false };
          }
        })
      );

      // Sum up results
      const batchJoins = results.reduce((sum, r) => sum + r.joined, 0);
      const batchLeaves = results.reduce((sum, r) => sum + r.left, 0);
      totalJoins += batchJoins;
      totalLeaves += batchLeaves;

      console.log(`  ✅ Batch ${batchNum}: +${batchJoins} joins, -${batchLeaves} leaves`);

    } catch (error) {
      console.error(`  ❌ Batch ${batchNum} failed:`, error.message);
    }
  }

  return { totalJoins, totalLeaves };
}

/**
 * Main scraping loop
 */
async function scrapeLoop() {
  console.log('🚀 Starting Free4Talk Tracker Scraper...\n');

  // Initialize tracker
  await tracker.initialize();

  // Check for one-time run flag
  const runOnce = process.argv.includes('--once');
  let cycleCount = 0;

  async function cycle() {
    cycleCount++;
    console.log(`\n${'='.repeat(60)}`);
    console.log(`🔄 Cycle #${cycleCount} - ${new Date().toLocaleString()}`);
    console.log('='.repeat(60));

    try {
      const { roomCount, totalJoins, totalLeaves } = await fetchAndProcessRooms();
      const stats = await db.getStats();

      console.log('📈 Cycle Summary:');
      console.log(`  Rooms Processed: ${roomCount}`);
      console.log(`  User Activity: +${totalJoins} joins, -${totalLeaves} leaves`);
      console.log(`\n💾 Database Stats:`);
      console.log(`  Total Users: ${stats.total_users}`);
      console.log(`  Total Rooms: ${stats.total_rooms}`);
      console.log(`  Active Sessions: ${stats.active_sessions}`);
      console.log(`  Total Sessions: ${stats.total_sessions}`);
      console.log('\n✅ Cycle completed successfully');

    } catch (error) {
      console.error('❌ Error in scrape cycle:', error.message);
      console.error('Stack:', error.stack);
    }

    // Schedule next cycle or exit
    if (!runOnce) {
      console.log(`\n⏳ Next cycle in ${config.scraper.interval / 1000} seconds...\n`);
      setTimeout(cycle, config.scraper.interval);
    } else {
      console.log('\n✅ Single run completed. Exiting...');
      await cleanup();
      process.exit(0);
    }
  }

  // Start first cycle
  await cycle();
}

/**
 * Cleanup function
 */
async function cleanup() {
  console.log('\n🛑 Shutting down gracefully...');
  
  if (globalBrowser) {
    try {
      await globalBrowser.close();
      console.log('✅ Browser closed');
    } catch (error) {
      console.error('Error closing browser:', error.message);
    }
  }
  
  try {
    await db.pool.end();
    console.log('✅ Database connections closed');
  } catch (error) {
    console.error('Error closing database:', error.message);
  }
}

/**
 * Graceful shutdown handlers
 */
process.on('SIGINT', async () => {
  await cleanup();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  await cleanup();
  process.exit(0);
});

process.on('uncaughtException', async (error) => {
  console.error('💥 Uncaught Exception:', error);
  await cleanup();
  process.exit(1);
});

process.on('unhandledRejection', async (reason, promise) => {
  console.error('💥 Unhandled Rejection at:', promise, 'reason:', reason);
  await cleanup();
  process.exit(1);
});

// Start the scraper
scrapeLoop().catch(async (error) => {
  console.error('Fatal error:', error);
  await cleanup();
  process.exit(1);
});
