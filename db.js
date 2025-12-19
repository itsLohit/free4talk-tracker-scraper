const { Pool } = require('pg');
const config = require('./config');

// Create connection pool
const pool = new Pool(config.db);

// Test connection
pool.on('connect', () => {
  console.log('✅ Connected to PostgreSQL database');
});

pool.on('error', (err) => {
  console.error('❌ Database error:', err);
});

// ============================================
// USER QUERIES
// ============================================

async function upsertUser(userData) {
  const query = `
    INSERT INTO users (
      user_id, username, user_avatar, verification_status,
      followers_count, first_seen, last_seen
    ) VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
    ON CONFLICT (user_id) DO UPDATE SET
      username = EXCLUDED.username,
      user_avatar = EXCLUDED.user_avatar,
      verification_status = EXCLUDED.verification_status,
      followers_count = EXCLUDED.followers_count,
      last_seen = NOW(),
      updated_at = NOW()
    RETURNING user_id;
  `;

  const values = [
    userData.user_id,
    userData.username,
    userData.user_avatar,
    userData.verification_status || 'UNVERIFIED',
    userData.followers_count || 0,
  ];

  try {
    const result = await pool.query(query, values);
    return result.rows[0];
  } catch (error) {
    console.error('Error upserting user:', error);
    throw error;
  }
}

// ============================================
// ROOM QUERIES
// ============================================

async function upsertRoom(roomData) {
  const query = `
    INSERT INTO rooms (
      room_id, language, skill_level, topic, max_capacity,
      is_active, is_full, is_empty, allows_unlimited,
      mic_allowed, mic_required, first_seen, last_activity
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW(), NOW())
    ON CONFLICT (room_id) DO UPDATE SET
      language = EXCLUDED.language,
      skill_level = EXCLUDED.skill_level,
      topic = EXCLUDED.topic,
      max_capacity = EXCLUDED.max_capacity,
      is_active = EXCLUDED.is_active,
      is_full = EXCLUDED.is_full,
      is_empty = EXCLUDED.is_empty,
      allows_unlimited = EXCLUDED.allows_unlimited,
      mic_allowed = EXCLUDED.mic_allowed,
      mic_required = EXCLUDED.mic_required,
      last_activity = NOW(),
      updated_at = NOW()
    RETURNING room_id;
  `;

  const values = [
    roomData.room_id,
    roomData.language || 'Unknown',
    roomData.skill_level || 'Any Level',
    roomData.topic || 'Anything',
    roomData.max_capacity || -1,
    roomData.is_active !== false,
    roomData.is_full || false,
    roomData.is_empty || false,
    roomData.allows_unlimited || false,
    roomData.mic_allowed !== false,
    roomData.mic_required || false,
  ];

  try {
    const result = await pool.query(query, values);
    return result.rows[0];
  } catch (error) {
    console.error('Error upserting room:', error);
    throw error;
  }
}

// ============================================
// SESSION QUERIES
// ============================================

async function getActiveSessions(roomId) {
  const query = `
    SELECT session_id, user_id, room_id, joined_at
    FROM sessions
    WHERE room_id = $1 AND is_currently_active = true;
  `;

  try {
    const result = await pool.query(query, [roomId]);
    return result.rows;
  } catch (error) {
    console.error('Error getting active sessions:', error);
    throw error;
  }
}

/**
 * Get current participants in a room
 */
async function getRoomParticipants(room_id) {
  try {
    const result = await pool.query(
      `SELECT u.user_id, u.username, s.session_id
       FROM sessions s
       JOIN users u ON s.user_id = u.user_id
       WHERE s.room_id = $1 AND s.is_currently_active = true`,
      [room_id]
    );
    return result.rows;
  } catch (error) {
    console.error('Error getting room participants:', error);
    throw error;
  }
}


async function createSession(sessionData) {
  const query = `
    INSERT INTO sessions (
      user_id, room_id, joined_at, user_position,
      mic_was_on, event_type
    ) VALUES ($1, $2, $3, $4, $5, $6)
    RETURNING session_id;
  `;

  const values = [
    sessionData.user_id,
    sessionData.room_id,
    sessionData.joined_at || new Date(),
    sessionData.user_position || null,
    sessionData.mic_was_on || false,
    sessionData.event_type || 'join',
  ];

  try {
    const result = await pool.query(query, values);
    return result.rows[0];
  } catch (error) {
    console.error('Error creating session:', error);
    throw error;
  }
}

    async function endSession(sessionId) {
        // Use CURRENT_TIMESTAMP for consistent server time
        const query = `
            UPDATE sessions 
            SET left_at = GREATEST(joined_at, CURRENT_TIMESTAMP),
                duration = EXTRACT(EPOCH FROM (GREATEST(joined_at, CURRENT_TIMESTAMP) - joined_at))
            WHERE id = $1
            RETURNING id, duration;
        `;
        
        try {
            const res = await this.pool.query(query, [sessionId]);
            return res.rows[0];
        } catch (err) {
            // If constraint fails, force close it by setting left_at = joined_at
            if (err.code === '23514') { // check_violation
                console.warn(`⚠️ Fixing timestamp mismatch for session ${sessionId}`);
                await this.pool.query(
                    `UPDATE sessions SET left_at = joined_at, duration = 0 WHERE id = $1`, 
                    [sessionId]
                );
                return { id: sessionId, duration: 0 };
            }
            throw err;
        }
    }


async function endAllSessionsInRoom(roomId, userId, leftAt) {
  const query = `
    UPDATE sessions
    SET left_at = $1, event_type = 'leave'
    WHERE room_id = $2 AND user_id = $3 AND left_at IS NULL
    RETURNING session_id;
  `;

  try {
    const result = await pool.query(query, [leftAt || new Date(), roomId, userId]);
    return result.rows;
  } catch (error) {
    console.error('Error ending sessions:', error);
    throw error;
  }
}

// ============================================
// STATISTICS
// ============================================

async function getStats() {
  const query = `
    SELECT 
      (SELECT COUNT(*) FROM users) as total_users,
      (SELECT COUNT(*) FROM rooms) as total_rooms,
      (SELECT COUNT(*) FROM sessions WHERE is_currently_active = true) as active_sessions,
      (SELECT COUNT(*) FROM sessions) as total_sessions
  `;

  try {
    const result = await pool.query(query);
    return result.rows[0];
  } catch (error) {
    console.error('Error getting stats:', error);
    throw error;
  }
}

// ============================================
// EXPORTS
// ============================================

module.exports = {
  pool,
  upsertUser,
  upsertRoom,
  getActiveSessions,
  createSession,
  endSession,
  endAllSessionsInRoom,
  getRoomParticipants,
  getStats,
};
