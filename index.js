const express = require('express');
const { chromium } = require('playwright');
const db = require('./db');
const { parseSnapshot } = require('./parser');
const { TARGET_URL, PORT } = require('./config');

const app = express();
const port = process.env.PORT || 8080;

// === API Server (Keep this, it's good!) ===
app.get('/api/rooms', async (req, res) => {
    try {
        const result = await db.pool.query('SELECT * FROM rooms WHERE is_active = true ORDER BY peak_concurrent_users DESC');
        res.json(result.rows);
    } catch (e) { res.status(500).json({error: e.message}); }
});

app.listen(port, () => console.log(`🚀 API Server running on port ${port}`));


// === The Scraper (Fixed URL) ===
async function startScraper() {
    let browser = null;
    while (true) {
        try {
            console.log("🕸️ Launching Scraper...");
            browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
            const page = await browser.newPage();

            // Intercept the CORRECT Network Request
            page.on('response', async (response) => {
                const url = response.url();
                
                // ✅ THIS WAS THE FIX: The correct API URL
                if (url.includes('/sync/get/free4talk/groups/') && response.status() === 200) {
                    try {
                        const json = await response.json();
                        // Free4Talk wraps data in { success: true, data: { ... } }
                        if (json.success && json.data) {
                            console.log(`⚡ Intercepted Data! Syncing...`);
                            
                            const { rooms } = parseSnapshot(json.data); // Pass the inner 'data' object
                            
                            // Save to DB
                            for (const room of rooms) {
                                await db.upsertRoom(room);
                                await db.syncRoomSessions(room.room_id, room.users);
                            }
                            console.log(`✅ Synced ${rooms.length} active rooms.`);
                        }
                    } catch (err) {
                        console.error("⚠️ Parse Error:", err.message);
                    }
                }
            });

            await page.goto(TARGET_URL, { waitUntil: 'networkidle', timeout: 60000 });
            console.log("✅ Connected. Waiting for data stream...");

            // Keep browser open forever
            await new Promise(() => {});

        } catch (err) {
            console.error("❌ Scraper Crash:", err.message);
            if (browser) await browser.close();
            console.log("🔄 Restarting in 10s...");
            await new Promise(r => setTimeout(r, 10000));
        }
    }
}

startScraper();
