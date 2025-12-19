const express = require('express');
const { chromium } = require('playwright');
const db = require('./db');
const { parseSnapshot } = require('./parser');
const { TARGET_URL, PORT } = require('./config');

const app = express();
const port = process.env.PORT || 5000;

// ==========================================
// 1. API SERVER (For your Frontend)
// ==========================================
app.use(express.json());

// Endpoint: Get All Active Rooms
app.get('/api/rooms', async (req, res) => {
    try {
        const result = await db.pool.query(`
            SELECT * FROM rooms WHERE is_active = true ORDER BY current_users_count DESC
        `);
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Endpoint: Get Active Users (The "Who is Online" list)
app.get('/api/users/active', async (req, res) => {
    try {
        const result = await db.pool.query(`SELECT * FROM active_users_view`);
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Endpoint: User Profile & History
app.get('/api/users/:username', async (req, res) => {
    try {
        const user = await db.pool.query('SELECT * FROM users WHERE username = $1', [req.params.username]);
        if (user.rows.length === 0) return res.status(404).json({ error: "User not found" });
        
        const history = await db.pool.query(`
            SELECT r.topic, s.joined_at, s.duration_seconds 
            FROM sessions s JOIN rooms r ON s.room_id = r.room_id 
            WHERE s.user_id = $1 ORDER BY s.joined_at DESC LIMIT 50
        `, [user.rows[0].user_id]);

        res.json({ profile: user.rows[0], recent_rooms: history.rows });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Start the Server
app.listen(port, () => {
    console.log(`🚀 API Server running on http://localhost:${port}`);
    startScraper(); // Start scraper alongside server
});


// ==========================================
// 2. ROBUST SCRAPER (Auto-Healing)
// ==========================================
async function startScraper() {
    let browser = null;
    
    while (true) { // Infinite Retry Loop
        try {
            console.log("🕸️ Launching Scraper...");
            browser = await chromium.launch({ 
                headless: true,
                args: ['--no-sandbox', '--disable-setuid-sandbox'] // Needed for hosting
            });
            
            const page = await browser.newPage();

            // Intercept API Traffic
            page.on('response', async (response) => {
                const url = response.url();
                if (url.includes('/api/v1/rooms') && response.status() === 200) {
                    try {
                        const json = await response.json();
                        const { rooms } = parseSnapshot(json);
                        
                        console.log(`📥 Syncing ${rooms.length} rooms...`);
                        
                        for (const room of rooms) {
                            await db.upsertRoom(room);
                            await db.syncRoomSessions(room.room_id, room.users);
                        }
                    } catch (err) {
                        console.error("⚠️ Parse Error:", err.message);
                    }
                }
            });

            await page.goto(TARGET_URL, { waitUntil: 'networkidle', timeout: 60000 });
            console.log("✅ Connected to Free4Talk Network Stream");

            // Keep alive check every minute
            await new Promise((resolve, reject) => {
                const check = setInterval(async () => {
                    if (browser.isConnected()) {
                        console.log("💓 Scraper Heartbeat: OK");
                        // Optional: Reload page every hour to prevent memory leaks
                    } else {
                        clearInterval(check);
                        reject(new Error("Browser disconnected"));
                    }
                }, 60000); 
            });

        } catch (err) {
            console.error("❌ Scraper Crash:", err.message);
            if (browser) await browser.close();
            console.log("🔄 Restarting in 10 seconds...");
            await new Promise(r => setTimeout(r, 10000));
        }
    }
}
