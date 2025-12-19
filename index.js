const { chromium } = require('playwright');
const config = require('./config');
const { parseRooms, parseLanguageStats } = require('./parser');
const SessionTracker = require('./tracker');
const db = require('./db');

const http = require('http');

// Health check endpoint to keep Render awake
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


// Global tracker instance
const tracker = new SessionTracker();

/**
 * Helper: Wait for specified milliseconds
 */
function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Fetch and process rooms while scrolling (memory efficient)
 */
async function fetchAndProcessRooms() {
  const { chromium } = require('playwright');
  const cheerio = require('cheerio');
  let browser;
  
  try {
    browser = await chromium.launch({
      headless: true,
      args: [
        '--disable-blink-features=AutomationControlled',
        '--no-sandbox',              // ✅ Required for Docker
        '--disable-setuid-sandbox',  // ✅ Required for Docker
        '--disable-dev-shm-usage',   // ✅ Prevents memory issues
        '--disable-gpu'              // ✅ Not needed in cloud
      ]
    });
    

    const context = await browser.newContext({
      viewport: { width: 1920, height: 1080 },
      userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    });

    const page = await context.newPage();
    
    console.log(`🌐 Navigating to ${config.scraper.url}...`);
    
    await page.goto(config.scraper.url, { 
      waitUntil: 'networkidle',
      timeout: 60000 
    });

    console.log('⏳ Waiting for content to load...');
    await page.waitForSelector('.group-list', { timeout: 15000 });
    await wait(500);

    console.log('📜 Scrolling and processing rooms...\n');
    
    const processedRoomIds = new Set();
    let scrollsWithoutNewRooms = 0;
    const maxScrollsWithoutNew = 3;
    let totalJoins = 0;
    let totalLeaves = 0;
    
    for (let i = 0; i < 50; i++) {
      // Extract HTML of visible rooms
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

      // Parse and process NEW rooms only
      let newRoomsCount = 0;
      const roomsToProcess = [];
      
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
          
          roomsToProcess.push({
            room_id: id,
            language,
            skill_level: rawSkillLevel,
            topic,
            participants
          });
          
          newRoomsCount++;
        }
      }

      // Process new rooms and get join/leave counts
      let batchJoins = 0;
      let batchLeaves = 0;
      
      if (roomsToProcess.length > 0) {
        const { joinCount, leaveCount } = await processRoomsData(roomsToProcess);
        batchJoins = joinCount;
        batchLeaves = leaveCount;
        totalJoins += joinCount;
        totalLeaves += leaveCount;
      }

      // Clean logging: only show summary
      const statusIcon = newRoomsCount > 0 ? '✅' : '⏸️';
      console.log(`   ${statusIcon} Scroll ${i + 1}: ${processedRoomIds.size} total rooms (+${newRoomsCount} new) | +${batchJoins} joins, -${batchLeaves} leaves`);

      // Check if done
      if (newRoomsCount === 0) {
        scrollsWithoutNewRooms++;
        if (scrollsWithoutNewRooms >= maxScrollsWithoutNew) {
          console.log(`\n✅ Completed scrolling. Total: ${processedRoomIds.size} rooms\n`);
          break;
        }
      } else {
        scrollsWithoutNewRooms = 0;
      }

      // Scroll
      await page.evaluate(() => window.scrollBy(0, window.innerHeight * 1.5));
      await wait(500);
    }

    await browser.close();
    
    return {
      roomCount: processedRoomIds.size,
      totalJoins,
      totalLeaves
    };

  } catch (error) {
    if (browser) await browser.close();
    throw error;
  }
}


/**
 * Process room data (called for each batch while scrolling)
 * Returns join/leave counts without individual logs
 */
async function processRoomsData(rooms) {
  let joinCount = 0;
  let leaveCount = 0;
  
  for (const roomData of rooms) {
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

      // Track sessions (WITHOUT LOGGING EACH ONE)
      const { joined, left } = await tracker.processRoom(roomData);
      joinCount += joined;
      leaveCount += left;

    } catch (error) {
      console.error(`   ❌ Error processing room ${roomData.room_id}:`, error.message);
    }
  }
  
  return { joinCount, leaveCount };
}


/**
 * Process room data (called for each batch while scrolling)
 */
async function processRoomsData(rooms) {
  let joinCount = 0;
  let leaveCount = 0;
  
  for (const roomData of rooms) {
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
      joinCount += joined;
      leaveCount += left;

    } catch (error) {
      console.error(`   ❌ Error processing room ${roomData.room_id}:`, error.message);
    }
  }
  
  return { joinCount, leaveCount };
}
 



/**
 * Process scraped data
 */
async function processData(html) {
  console.log('📊 Parsing rooms...');
  const rooms = parseRooms(html);
  if (rooms.length > 0) {
    const sampleRoom = rooms[0];
    console.log('\n📋 Sample Room:');
    console.log(`   ID: ${sampleRoom.room_id}`);
    console.log(`   Language: ${sampleRoom.language}`);
    console.log(`   Participants: ${sampleRoom.participants.length}`);
    if (sampleRoom.participants.length > 0) {
      console.log(`   First User: ${sampleRoom.participants[0].username} (${sampleRoom.participants[0].followers_count} followers)`);
    }
  }

  
  const stats = parseLanguageStats(html);

  console.log(`Found ${rooms.length} rooms`);

  let totalJoins = 0;
  let totalLeaves = 0;

  // Process each room
  for (const roomData of rooms) {
    try {
      // Upsert room
      await db.upsertRoom(roomData);

      // Track sessions
      const { joined, left } = await tracker.processRoom(roomData);
      totalJoins += joined;
      totalLeaves += left;

    } catch (error) {
      console.error(`Error processing room ${roomData.room_id}:`, error);
    }
  }

  // Get overall stats
  const dbStats = await db.getStats();

  console.log('\n📈 Statistics:');
  console.log(`  Total Users: ${dbStats.total_users}`);
  console.log(`  Total Rooms: ${dbStats.total_rooms}`);
  console.log(`  Active Sessions: ${dbStats.active_sessions}`);
  console.log(`  Total Sessions: ${dbStats.total_sessions}`);
  console.log(`  This Cycle: +${totalJoins} joins, -${totalLeaves} leaves\n`);

  return { rooms: rooms.length, joins: totalJoins, leaves: totalLeaves };
}



/**
 * Main scraping loop
 */
async function scrapeLoop() {
  console.log('🚀 Starting Free4Talk Tracker Scraper...\n');

  // Initialize tracker
  await tracker.initialize();

  // Run once if --once flag is provided
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
  }

  if (!runOnce) {
    console.log(`\n⏳ Next cycle in ${config.scraper.interval / 1000} seconds...\n`);
    setTimeout(cycle, config.scraper.interval);
  } else {
    console.log('\n✅ Single run completed. Exiting...');
    process.exit(0);
  }
}

  // Start first cycle
  await cycle();
}

/**
 * Graceful shutdown
 */
process.on('SIGINT', async () => {
  console.log('\n\n🛑 Shutting down gracefully...');
  await db.pool.end();
  process.exit(0);
});

// Start the scraper
scrapeLoop().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
