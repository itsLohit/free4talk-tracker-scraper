const { chromium } = require('playwright');
const db = require('./db');
const SessionTracker = require('./tracker');
const config = require('./config');

const tracker = new SessionTracker();

async function startSmartScraper() {
    console.log('🚀 Starting Smart Network Interceptor...');

    const browser = await chromium.launch({ 
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox'] 
    });

    const context = await browser.newContext();
    const page = await context.newPage();

    await tracker.initialize();

    let latestGroups = null;

    page.on('response', async response => {
        const url = response.url();
        if (url.includes('/sync/get/free4talk/groups/')) {
            try {
                const json = await response.json();
                if (json.success && json.data) {
                    console.log(`⚡ INTERCEPTED: ${Object.keys(json.data).length} groups from network!`);
                    latestGroups = json.data;
                }
            } catch (err) {}
        }
    });

    console.log('🌐 Navigating to Free4Talk...');
    await page.goto('https://www.free4talk.com/', { waitUntil: 'networkidle' });

    async function loop() {
        console.log(`\n🔄 Cycle: ${new Date().toLocaleTimeString()}`);

        if (latestGroups) {
            console.log('💾 Processing captured data...');
            await processApiData(latestGroups);
            latestGroups = null;
        } else {
            console.log('⚠️ No new data yet. Waiting...');
        }

        await new Promise(r => setTimeout(r, config.scraper.interval || 10000));
        loop();
    }

    loop();
}

async function processApiData(apiGroups) {
    const processedRooms = [];

    // 🛠️ MAPPING FIX: Map API values to Database Allowed Values
    const skillMap = {
        'Beginner': 'Beginner',
        'Upper Beginner': 'Beginner',         // Map Upper Beginner -> Beginner
        'Intermediate': 'Intermediate',
        'Upper Intermediate': 'Intermediate', // Map Upper Intermediate -> Intermediate
        'Advanced': 'Advanced',
        'Upper Advanced': 'Advanced',         // Map Upper Advanced -> Advanced
        'Any Level': 'Any Level'
    };

    for (const [id, group] of Object.entries(apiGroups)) {
        try {
            // Apply the mapping!
            const cleanSkill = skillMap[group.level] || 'Any Level';

            const roomData = {
                room_id: group.id,
                language: group.language,
                topic: group.topic,
                skill_level: cleanSkill, // Use the CLEAN skill level
                is_active: true,
                max_capacity: group.maxPeople
            };

            await db.upsertRoom(roomData);

            const participants = group.clients.map((c, i) => ({
                user_id: c.id,
                username: c.name,
                position: i
            }));

            await tracker.processRoom({
                room_id: group.id,
                participants: participants
            });

            processedRooms.push(group.id);
        } catch(e) { 
            console.error(`❌ Error processing room ${group.id}:`, e.message); 
        }
    }
    console.log(`✅ Processed ${processedRooms.length} rooms`);
}

startSmartScraper();