const { Pool } = require('pg');
const { DB_CONNECTION_STRING } = require('./config');

console.log("🔌 Connecting to DB:", DB_CONNECTION_STRING.split('@')[1]); // Log host for verification

const pool = new Pool({
  connectionString: DB_CONNECTION_STRING,
  ssl: { rejectUnauthorized: false } // Required for Aiven
});

// 1. Upsert User (Now includes social stats!)
async function upsertUser(user) {
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
      following_count = GREATEST(users.following_count, EXCLUDED.following_count),
      friends_count = GREATEST(users.friends_count, EXCLUDED.friends_count),
      last_seen_at = EXCLUDED.last_seen_at,
      is_online = EXCLUDED.is_online;
  `;
  const values = [
    user.user_id, user.username, user.user_avatar, user.is_verified,
    user.followers_count, user.following_count, user.friends_count,
    user.last_seen_at, user.is_online
  ];
  try {
    await pool.query(query, values);
  } catch (err) {
    console.error(`Error upserting user ${user.username}:`, err.message);
  }
}

// 2. Upsert Room (Now includes creator_id and settings)
async function upsertRoom(room) {
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
      mic_allowed = EXCLUDED.mic_allowed,
      is_locked = EXCLUDED.is_locked,
      total_unique_visitors = rooms.total_unique_visitors + 1;
  `;
  const values = [
    room.room_id, room.creator_id, room.topic, room.language, room.skill_level,
    room.max_capacity, room.room_url, room.mic_allowed, room.is_locked,
    room.created_at, room.is_active
  ];
  try {
    await pool.query(query, values);
  } catch (err) {
    console.error(`Error upserting room ${room.room_id}:`, err.message);
  }
}

// 3. Sync Sessions (Crucial for "Who is in Where")
async function syncRoomSessions(roomId, usersInRoom) {
    // A. Close sessions for users who LEFT the room
    if (usersInRoom.length > 0) {
        const currentUserIds = usersInRoom.map(u => `'${u.user_id}'`).join(',');
        await pool.query(`
            UPDATE sessions 
            SET left_at = NOW(), is_active = false 
            WHERE room_id = $1 
            AND is_active = true 
            AND user_id NOT IN (${currentUserIds})
        `, [roomId]);
    } else {
        // Room is empty -> close ALL sessions
        await pool.query(`
            UPDATE sessions 
            SET left_at = NOW(), is_active = false 
            WHERE room_id = $1 AND is_active = true
        `, [roomId]);
    }

    // B. Create/Update sessions for users currently IN the room
    for (const user of usersInRoom) {
        // Ensure user exists first
        await upsertUser(user);

        // Insert new active session only if one doesn't already exist
        const sessionQuery = `
            INSERT INTO sessions (user_id, room_id, joined_at, is_active)
            SELECT $1, $2, NOW(), true
            WHERE NOT EXISTS (
                SELECT 1 FROM sessions 
                WHERE user_id = $1 AND room_id = $2 AND is_active = true
            );
        `;
        await pool.query(sessionQuery, [user.user_id, roomId]);
    }
}

// 4. Mark Room Inactive (When it disappears from API)
async function markRoomInactive(roomId) {
    await pool.query(`
        UPDATE rooms SET is_active = false, closed_at = NOW() WHERE room_id = $1
    `, [roomId]);
    
    // Close all sessions in that room
    await pool.query(`
        UPDATE sessions SET left_at = NOW(), is_active = false WHERE room_id = $1 AND is_active = true
    `, [roomId]);
}

module.exports = { pool, upsertUser, upsertRoom, syncRoomSessions, markRoomInactive };
