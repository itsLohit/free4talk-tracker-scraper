const { Pool } = require('pg');
const { DB_CONNECTION_STRING } = require('./config');

const pool = new Pool({
  connectionString: DB_CONNECTION_STRING,
  ssl: { rejectUnauthorized: false },
  max: 20, // Max clients in pool
  idleTimeoutMillis: 30000
});

pool.on('error', (err) => {
  console.error('❌ Unexpected DB Client Error', err);
  // Don't exit process, just log it. Pool will reconnect.
});

// 1. Save/Update User
async function upsertUser(user) {
  if (!user.user_id) return; // Skip invalid users

  const query = `
    INSERT INTO users (
      user_id, username, user_avatar, is_verified, 
      followers_count, following_count, friends_count, 
      last_seen_at, is_online
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    ON CONFLICT (user_id) DO UPDATE SET
      username = EXCLUDED.username,
      user_avatar = EXCLUDED.user_avatar,
      followers_count = GREATEST(users.followers_count, EXCLUDED.followers_count),
      last_seen_at = EXCLUDED.last_seen_at,
      is_online = EXCLUDED.is_online;
  `;
  try {
      await pool.query(query, [
        user.user_id, user.username, user.user_avatar, user.is_verified,
        user.followers_count, user.following_count, user.friends_count,
        user.last_seen_at, user.is_online
      ]);
  } catch(e) { console.error("Upsert User Failed:", e.message); }
}

// 2. Save/Update Room
async function upsertRoom(room) {
  if (!room.room_id) return;

  const query = `
    INSERT INTO rooms (
      room_id, creator_id, topic, language, skill_level, 
      max_capacity, room_url, mic_allowed, is_locked, 
      created_at, is_active
    )
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
    ON CONFLICT (room_id) DO UPDATE SET
      topic = EXCLUDED.topic,
      is_active = EXCLUDED.is_active,
      peak_concurrent_users = GREATEST(rooms.peak_concurrent_users, EXCLUDED.peak_concurrent_users);
  `;
  try {
      await pool.query(query, [
        room.room_id, room.creator_id, room.topic, room.language, room.skill_level,
        room.max_capacity, room.room_url, room.mic_allowed, room.is_locked,
        room.created_at, room.is_active
      ]);
  } catch(e) { console.error("Upsert Room Failed:", e.message); }
}

// 3. Sync Sessions
async function syncRoomSessions(roomId, usersInRoom) {
    const client = await pool.connect(); // Use a single client for transaction safety
    try {
        await client.query('BEGIN');

        // A. Handle Users Leaving
        if (usersInRoom.length > 0) {
            const currentIds = usersInRoom.map(u => `'${u.user_id}'`).join(',');
            await client.query(`
                UPDATE sessions SET left_at = NOW(), is_active = false 
                WHERE room_id = $1 AND is_active = true AND user_id NOT IN (${currentIds})
            `, [roomId]);
        } else {
            await client.query(`
                UPDATE sessions SET left_at = NOW(), is_active = false 
                WHERE room_id = $1 AND is_active = true
            `, [roomId]);
        }

        // B. Handle Users Joining
        for (const user of usersInRoom) {
            // We must upsert user here inside the transaction to ensure FK validity
            await upsertUser(user); 
            
            await client.query(`
                INSERT INTO sessions (user_id, room_id, joined_at, is_active)
                SELECT $1, $2, NOW(), true
                WHERE NOT EXISTS (
                    SELECT 1 FROM sessions 
                    WHERE user_id = $1 AND room_id = $2 AND is_active = true
                );
            `, [user.user_id, roomId]);
        }

        await client.query('COMMIT');
    } catch (e) {
        await client.query('ROLLBACK');
        console.error(`Sync Session Error for Room ${roomId}:`, e.message);
    } finally {
        client.release();
    }
}

module.exports = { pool, upsertUser, upsertRoom, syncRoomSessions };
