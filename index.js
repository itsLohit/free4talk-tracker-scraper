const express = require('express');
const { chromium } = require('playwright');
const db = require('./db');
const { parseSnapshot } = require('./parser');
const { TARGET_URL, PORT } = require('./config');

const app = express();
const port = process.env.PORT || 8080;

app.get('/', (req, res) => res.send('Scraper is running in DEBUG mode. Check logs.'));
app.listen(port, () => console.log(`🚀 Server running on port ${port}`));

async function startScraper() {
    let browser = null;
    while (true) {
        try {
            console.log("🕸️ Launching DEBUG Scraper...");
            browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
            const page = await browser.newPage();

            // DEBUG: Log EVERY request to find the hidden API
            page.on('request', request => {
                const url = request.url();
                // Filter out boring stuff like images/fonts to keep logs clean
                if (!url.match(/\.(png|jpg|jpeg|gif|css|woff|woff2|svg)$/)) {
                    console.log("🔍 REQUEST:", url); 
                }
            });

            // Keep the original listener too, just in case
            page.on('response', async (response) => {
                const url = response.url();
                // Check for ANY likely API keywords
                if (url.includes('api') || url.includes('rooms') || url.includes('json')) {
                    console.log("🎯 POTENTIAL MATCH:", url); // Log matches
                    
                    if (url.includes('/api/v1/rooms') && response.status() === 200) {
                         try {
                            const json = await response.json();
                            const { rooms } = parseSnapshot(json);
                            console.log(`✅ FOUND DATA! Syncing ${rooms.length} rooms...`);
                            for (const room of rooms) {
                                await db.upsertRoom(room);
                                await db.syncRoomSessions(room.room_id, room.users);
                            }
                        } catch (err) {
                            console.error("⚠️ Parse Error:", err.message);
                        }
                    }
                }
            });

            await page.goto(TARGET_URL, { waitUntil: 'networkidle', timeout: 60000 });
            console.log("✅ Page Loaded. Waiting for traffic...");

            // Wait 5 minutes then restart (for testing)
            await new Promise(r => setTimeout(r, 300000));

        } catch (err) {
            console.error("❌ Crash:", err.message);
            if (browser) await browser.close();
            await new Promise(r => setTimeout(r, 10000));
        }
    }
}

startScraper();
