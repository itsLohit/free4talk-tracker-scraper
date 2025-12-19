const { Pool } = require('pg');
const config = require('./config');

// Optimized connection pool for cloud database
const pool = new Pool({
  ...config.db,
  connectionTimeoutMillis: 10000,
  max: 30, // Maximum connections
  min: 5,  // Minimum idle connections
  idleTimeoutMillis: 30000, // Keep connections alive
});

// Log successful connection
pool.on('connect', () => {
  console.log('✅ Connected to PostgreSQL database');
});

// Log errors
pool.on('error', (err) => {
  console.error('❌ Unexpected database error:', err);
});

/**
 * Upsert a room (insert or update if exists)
 */
async function upsertRoom(roomData) {
  const {
    room_id, language, skill_level, topic, max_capacity,
    is_active, is_full, is_empty, allows_unlimited,
    mic_allowed, mic_required
  } = roomData;

  const query = `
    INSERT INTO rooms (
      room_id, language, skill_level, topic, max_capacity,
      is_active, is_full, is_empty, allows_unlimited,
      mic_allowed, mic_required, last_seen_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW())
    ON CONFLICT (room_id) 
    DO UPDATE SET
      language = EXCLUDED.language,
      skill_level = EXCLUDED.skill_level,
      topic = EXCLUDED.topic,
      is_active = EXCLUDED.is_active,
      is_full = EXCLUDED.is_full,
      is_empty = EXCLUDED.is_empty,
      last_seen_at = NOW()
    RETURNING room_id;
  `;

  const values = [
    room_id, language, skill_level, topic, max_capacity,
    is_active, is_full, is_empty, allows_unlimited,
    mic_allowed, mic_required
  ];

  const result = await pool.query(query, values);
  return result.rows[0];
}

/**
 * Upsert a user (insert or update if exists)
 */
async function upsertUser(userData) {
  const {
    user_id, username, user_avatar, followers_count, verification_status
  } = userData;

  const query = `
    INSERT INTO users (
      user_id, username, user_avatar, followers_count, verification_status
    ) VALUES ($1, $2, $3, $4, $5)
    ON CONFLICT (user_id)
    DO UPDATE SET
      username = EXCLUDED.username,
      user_avatar = EXCLUDED.user_avatar,
      followers_count = EXCLUDED.followers_count,
      verification_status = EXCLUDED.verification_status
    RETURNING user_id;
  `;

  const values = [user_id, username, user_avatar, followers_count, verification_status];
  
  const result = await pool.query(query, values);
  return result.rows[0];
}

/**
 * Create a new session
 */
async function createSession(sessionData) {
  const { user_id, room_id, joined_at, is_currently_active } = sessionData;

  const query = `
    INSERT INTO sessions (user_id, room_id, joined_at, is_currently_active)
    VALUES ($1, $2, $3, $4)
    RETURNING session_id;
  `;

  const values = [user_id, room_id, joined_at, is_currently_active];
  
  const result = await pool.query(query, values);
  return result.rows[0];
}

/**
 * End all active sessions for a user in a specific room
 */
async function endAllSessionsInRoom(room_id, user_id, left_at) {
  const query = `
    UPDATE sessions
    SET left_at = $1, is_currently_active = false
    WHERE user_id = $2 AND room_id = $3 AND is_currently_active = true
    RETURNING session_id;
  `;

  const result = await pool.query(query, [left_at, user_id, room_id]);
  return result.rows;
}

/**
 * Get current participants in a room
 */
async function getRoomParticipants(room_id) {
  const query = `
    SELECT DISTINCT s.user_id, u.username
    FROM sessions s
    JOIN users u ON s.user_id = u.user_id
    WHERE s.room_id = $1 AND s.is_currently_active = true;
  `;

  const result = await pool.query(query, [room_id]);
  return result.rows;
}

/**
 * Get overall statistics
 */
async function getStats() {
  const query = `
    SELECT
      (SELECT COUNT(*) FROM users) as total_users,
      (SELECT COUNT(*) FROM rooms) as total_rooms,
      (SELECT COUNT(*) FROM sessions WHERE is_currently_active = true) as active_sessions,
      (SELECT COUNT(*) FROM sessions) as total_sessions;
  `;

  const result = await pool.query(query);
  return result.rows[0];
}

module.exports = {
  pool,
  upsertRoom,
  upsertUser,
  createSession,
  endAllSessionsInRoom,
  getRoomParticipants,
  getStats,
};
