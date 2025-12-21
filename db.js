const { chromium } = require('playwright');
const db = require('./db');
const SessionTracker = require('./tracker');
const config = require('./config');

const tracker = new SessionTracker();

async function startSmartScraper() {
  console.log('🚀 Starting Smart Network Interceptor...');
  console.log('📊 Features enabled:');
  console.log('  ✓ Auto user profile tracking');
  console.log('  ✓ Profile change history');
  console.log('  ✓ Room snapshots every 5 minutes');
  console.log('  ✓ Activity logging');
  console.log('  ✓ Daily analytics');
  console.log('  ✓ QUEUE-BASED DATA COLLECTION (No Data Loss!)');
  console.log('');

  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  const context = await browser.newContext();
  const page = await context.newPage();

  await tracker.initialize();

  // ✅ FIXED: Use a queue instead of single variable
  const dataQueue = [];
  let isProcessing = false;
  let cycleCount = 0;
  let interceptCount = 0;

  // Intercept network responses
  page.on('response', async response => {
    const url = response.url();
    
    // ✅ FIXED: Capture multiple API patterns
    if (url.includes('/sync/get/free4talk/groups/') || 
        url.includes('/api/groups') ||
        url.includes('/groups')) {
      try {
        const json = await response.json();
        
        if (json.success && json.data) {
          interceptCount++;
          const groupCount = Object.keys(json.data).length;
          
          // ✅ FIXED: Push to queue instead of overwriting
          dataQueue.push({
            timestamp: new Date(),
            data: json.data,
            count: groupCount
          });
          
          console.log(`⚡ INTERCEPTED #${interceptCount}: ${groupCount} groups (Queue: ${dataQueue.length})`);
        }
      } catch (err) {
        // Ignore parse errors
      }
    }
  });

  console.log('🌐 Navigating to Free4Talk...');
  await page.goto('https://www.free4talk.com/', { 
    waitUntil: 'domcontentloaded', // ✅ FIXED: Faster than networkidle
    timeout: 30000 
  });

  // ✅ FIXED: Continuous processing loop (no waiting)
  async function processQueue() {
    while (true) {
      if (dataQueue.length > 0 && !isProcessing) {
        isProcessing = true;
        cycleCount++;
        
        // Get all pending data
        const batchSize = dataQueue.length;
        const batch = dataQueue.splice(0, batchSize);
        
        console.log(`\n🔄 Cycle #${cycleCount}: Processing ${batchSize} batches`);
        
        // Merge all data (latest wins for duplicates)
        const mergedData = {};
        for (const item of batch) {
          Object.assign(mergedData, item.data);
        }
        
        console.log(`💾 Combined ${batchSize} batches into ${Object.keys(mergedData).length} unique rooms`);
        
        try {
          await processApiData(mergedData);
        } catch (error) {
          console.error('❌ Error processing batch:', error.message);
        }
        
        isProcessing = false;
        
        // Show tracker stats
        const stats = tracker.getStats();
        console.log(`📈 Tracker: ${stats.activeUsers} users, ${stats.activeSessions} sessions`);
        
        // Get database stats every 10 cycles
        if (cycleCount % 10 === 0) {
          try {
            const dbStats = await db.getStats();
            console.log('\n📊 Database Statistics:');
            console.log(`   Users: ${dbStats.total_users}`);
            console.log(`   Rooms: ${dbStats.total_rooms} (${dbStats.active_rooms} active)`);
            console.log(`   Sessions: ${dbStats.total_sessions} (${dbStats.active_sessions} active)`);
            console.log(`   Profile views (24h): ${dbStats.views_24h}`);
            console.log(`   Snapshots: ${dbStats.total_snapshots}`);
          } catch (error) {
            console.error('Error fetching stats:', error.message);
          }
        }
      }
      
      // ✅ FIXED: Short sleep to reduce CPU usage
      await new Promise(r => setTimeout(r, 100));
    }
  }

  // ✅ FIXED: Trigger page refresh to get fresh data periodically
  async function pageRefresher() {
    while (true) {
      await new Promise(r => setTimeout(r, 30000)); // Every 30 seconds
      
      try {
        console.log('🔄 Refreshing page to capture new data...');
        await page.reload({ waitUntil: 'domcontentloaded' });
      } catch (error) {
        console.error('Error refreshing page:', error.message);
      }
    }
  }

  // Start both loops
  processQueue();
  pageRefresher();
}

/**
 * ✅ FIXED: Process API data with parallel processing
 */
async function processApiData(apiGroups) {
  const processedRooms = [];
  const activeRoomIds = [];
  const errors = [];

  // Skill level mapping
  const skillMap = {
    'Beginner': 'Beginner',
    'Upper Beginner': 'Beginner',
    'Intermediate': 'Intermediate',
    'Upper Intermediate': 'Intermediate',
    'Advanced': 'Advanced',
    'Upper Advanced': 'Advanced',
    'Any Level': 'Any Level'
  };

  // ✅ FIXED: Process rooms in parallel batches
  const entries = Object.entries(apiGroups);
  const BATCH_SIZE = 10; // Process 10 rooms at a time
  
  for (let i = 0; i < entries.length; i += BATCH_SIZE) {
    const batch = entries.slice(i, i + BATCH_SIZE);
    
    await Promise.all(batch.map(async ([id, group]) => {
      try {
        // Extract creator information first
        let creatorData = null;
        if (group.creator) {
          creatorData = {
            creator_user_id: group.creator.id || group.userId,
            creator_name: group.creator.name,
            creator_avatar: group.creator.avatar,
            creator_is_verified: group.creator.isVerified || false
          };

          // Upsert creator as a user
          await db.upsertUser({
            user_id: creatorData.creator_user_id,
            username: creatorData.creator_name,
            user_avatar: creatorData.creator_avatar,
            verification_status: creatorData.creator_is_verified ? 'VERIFIED' : 'UNVERIFIED',
            followers_count: group.creator.followers || 0,
            following_count: group.creator.following || 0,
            friends_count: group.creator.friends || 0,
            supporter_level: group.creator.supporter || 0
          });
        }

        // Map skill level
        const cleanSkill = skillMap[group.level] || 'Any Level';

        // Build complete room data
        const roomData = {
          room_id: group.id,
          channel: group.channel || 'free4talk',
          platform: group.platform || 'Free4Talk',
          topic: group.topic || 'Anything',
          language: group.language || 'Unknown',
          second_language: group.secondLanguage || null,
          skill_level: cleanSkill,
          max_capacity: group.maxPeople || -1,
          allows_unlimited: (group.maxPeople === -1) || false,
          is_locked: group.settings?.isLocked || false,
          mic_allowed: !group.settings?.noMic,
          mic_required: false,
          al_mic: group.settings?.alMic || 0,
          no_mic: group.settings?.noMic || false,
          url: group.url || null,
          is_active: true,
          is_full: false,
          is_empty: !group.clients || group.clients.length === 0,
          current_users_count: group.clients ? group.clients.length : 0,
          ...creatorData
        };

        // Upsert room
        await db.upsertRoom(roomData);
        activeRoomIds.push(group.id);

        // Extract participants with full data
        const participants = (group.clients || []).map((client, index) => ({
          user_id: client.id,
          username: client.name,
          user_avatar: client.avatar || null,
          followers_count: client.followers || 0,
          following_count: client.following || 0,
          friends_count: client.friends || 0,
          supporter_level: client.supporter || 0,
          verification_status: client.isVerified ? 'VERIFIED' : 'UNVERIFIED',
          position: index + 1
        }));

        // Process room with tracker
        const { joined, left } = await tracker.processRoom({
          room_id: group.id,
          participants: participants
        });

        if (joined > 0 || left > 0) {
          console.log(`   📍 ${group.topic} (${group.language}): +${joined} -${left}`);
        }

        processedRooms.push(group.id);
      } catch (error) {
        errors.push({ room_id: group.id, error: error.message });
      }
    }));
  }

  // Mark rooms that are no longer active
  if (activeRoomIds.length > 0) {
    const inactiveRooms = await db.markInactiveRooms(activeRoomIds);
    if (inactiveRooms && inactiveRooms.length > 0) {
      console.log(`🔴 Marked ${inactiveRooms.length} rooms as inactive`);
    }
  }

  console.log(`✅ Processed ${processedRooms.length} rooms`);
  if (errors.length > 0) {
    console.log(`⚠️  ${errors.length} errors occurred`);
  }
}

// Start the scraper
startSmartScraper().catch(error => {
  console.error('💥 Fatal error:', error);
  process.exit(1);
});

