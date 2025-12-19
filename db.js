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
// USER QUERIES (ENHANCED WITH HISTORY TRACKING)
// ============================================

/**
 * Upsert user with full social metrics and history tracking
 */
async function upsertUser(userData) {
    // First, get the old user data to detect changes
    const oldUser = await pool.query(
        'SELECT * FROM users WHERE user_id = $1',
        [userData.user_id]
    );

    const query = `
        INSERT INTO users (
            user_id, username, user_avatar, verification_status,
            followers_count, following_count, friends_count, supporter_level,
            first_seen, last_seen
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), NOW())
        ON CONFLICT (user_id) DO UPDATE SET
            username = EXCLUDED.username,
            user_avatar = EXCLUDED.user_avatar,
            verification_status = EXCLUDED.verification_status,
            followers_count = EXCLUDED.followers_count,
            following_count = EXCLUDED.following_count,
            friends_count = EXCLUDED.friends_count,
            supporter_level = EXCLUDED.supporter_level,
            last_seen = NOW(),
            updated_at = NOW()
        RETURNING *;
    `;

    const values = [
        userData.user_id,
        userData.username,
        userData.user_avatar || null,
        userData.verification_status || 'UNVERIFIED',
        userData.followers_count || 0,
        userData.following_count || 0,
        userData.friends_count || 0,
        userData.supporter_level || 0,
    ];

    try {
        const result = await pool.query(query, values);
        const newUser = result.rows[0];

        // Log profile changes if user existed before
        if (oldUser.rows.length > 0) {
            await logUserProfileChanges(oldUser.rows[0], newUser);
        }

        return newUser;
    } catch (error) {
        console.error('Error upserting user:', error);
        throw error;
    }
}

/**
 * Log user profile changes for history tracking
 */
async function logUserProfileChanges(oldUser, newUser) {
    const changes = {};

    // Track changes in key fields
    if (oldUser.followers_count !== newUser.followers_count) {
        changes.followers_count = {
            old: oldUser.followers_count,
            new: newUser.followers_count,
            diff: newUser.followers_count - oldUser.followers_count
        };
    }

    if (oldUser.following_count !== newUser.following_count) {
        changes.following_count = {
            old: oldUser.following_count,
            new: newUser.following_count,
            diff: newUser.following_count - oldUser.following_count
        };
    }

    if (oldUser.friends_count !== newUser.friends_count) {
        changes.friends_count = {
            old: oldUser.friends_count,
            new: newUser.friends_count,
            diff: newUser.friends_count - oldUser.friends_count
        };
    }

    if (oldUser.username !== newUser.username) {
        changes.username = {
            old: oldUser.username,
            new: newUser.username
        };
    }

    // If there are changes, log them
    if (Object.keys(changes).length > 0) {
        await pool.query(
            `INSERT INTO user_activity_log (user_id, activity_type, activity_data)
             VALUES ($1, $2, $3)`,
            [newUser.user_id, 'profile_update', JSON.stringify(changes)]
        );
    }
}

// ============================================
// ROOM QUERIES (ENHANCED WITH FULL API DATA)
// ============================================

/**
 * Upsert room with complete data from API
 */
async function upsertRoom(roomData) {
    const query = `
        INSERT INTO rooms (
            room_id, channel, platform, topic, language, second_language,
            skill_level, max_capacity, allows_unlimited, is_locked,
            mic_allowed, mic_required, al_mic, no_mic,
            url, creator_user_id, creator_name, creator_avatar, creator_is_verified,
            is_active, is_full, is_empty, current_users_count,
            first_seen, last_activity
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, NOW(), NOW())
        ON CONFLICT (room_id) DO UPDATE SET
            channel = EXCLUDED.channel,
            platform = EXCLUDED.platform,
            topic = EXCLUDED.topic,
            language = EXCLUDED.language,
            second_language = EXCLUDED.second_language,
            skill_level = EXCLUDED.skill_level,
            max_capacity = EXCLUDED.max_capacity,
            allows_unlimited = EXCLUDED.allows_unlimited,
            is_locked = EXCLUDED.is_locked,
            mic_allowed = EXCLUDED.mic_allowed,
            mic_required = EXCLUDED.mic_required,
            al_mic = EXCLUDED.al_mic,
            no_mic = EXCLUDED.no_mic,
            url = EXCLUDED.url,
            creator_user_id = EXCLUDED.creator_user_id,
            creator_name = EXCLUDED.creator_name,
            creator_avatar = EXCLUDED.creator_avatar,
            creator_is_verified = EXCLUDED.creator_is_verified,
            is_active = EXCLUDED.is_active,
            is_full = EXCLUDED.is_full,
            is_empty = EXCLUDED.is_empty,
            current_users_count = EXCLUDED.current_users_count,
            last_activity = NOW(),
            updated_at = NOW()
        RETURNING room_id;
    `;

    const values = [
        roomData.room_id,
        roomData.channel || 'free4talk',
        roomData.platform || 'Free4Talk',
        roomData.topic || 'Anything',
        roomData.language || 'Unknown',
        roomData.second_language || null,
        roomData.skill_level || 'Any Level',
        roomData.max_capacity || -1,
        roomData.allows_unlimited || (roomData.max_capacity === -1),
        roomData.is_locked || false,
        roomData.mic_allowed !== false,
        roomData.mic_required || false,
        roomData.al_mic || 0,
        roomData.no_mic || false,
        roomData.url || null,
        roomData.creator_user_id || null,
        roomData.creator_name || null,
        roomData.creator_avatar || null,
        roomData.creator_is_verified || false,
        roomData.is_active !== false,
        roomData.is_full || false,
        roomData.is_empty || false,
        roomData.current_users_count || 0,
    ];

    try {
        const result = await pool.query(query, values);
        return result.rows[0];
    } catch (error) {
        console.error('Error upserting room:', error);
        throw error;
    }
}

/**
 * Create room snapshot for historical tracking
 */
async function createRoomSnapshot(roomId, participants) {
    const query = `
        INSERT INTO room_snapshots (
            room_id, snapshot_time, participants_count, participants_json, is_active
        ) VALUES ($1, NOW(), $2, $3, $4)
        RETURNING snapshot_id;
    `;

    const values = [
        roomId,
        participants.length,
        JSON.stringify(participants),
        true
    ];

    try {
        const result = await pool.query(query, values);
        return result.rows[0];
    } catch (error) {
        console.error('Error creating room snapshot:', error);
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
            mic_was_on, event_type, is_currently_active
        ) VALUES ($1, $2, $3, $4, $5, $6, $7)
        RETURNING session_id;
    `;

    const values = [
        sessionData.user_id,
        sessionData.room_id,
        sessionData.joined_at || new Date(),
        sessionData.user_position || null,
        sessionData.mic_was_on || false,
        sessionData.event_type || 'join',
        true
    ];

    try {
        const result = await pool.query(query, values);

        // Log activity
        await pool.query(
            `INSERT INTO user_activity_log (user_id, activity_type, activity_data)
             VALUES ($1, $2, $3)`,
            [
                sessionData.user_id,
                'room_join',
                JSON.stringify({ room_id: sessionData.room_id, joined_at: sessionData.joined_at })
            ]
        );

        return result.rows[0];
    } catch (error) {
        console.error('Error creating session:', error);
        throw error;
    }
}

async function endAllSessionsInRoom(roomId, userId, leftAt) {
    const query = `
        UPDATE sessions
        SET left_at = $1, 
            duration_seconds = EXTRACT(EPOCH FROM ($1 - joined_at))::INTEGER,
            event_type = 'leave',
            is_currently_active = false
        WHERE room_id = $2 AND user_id = $3 AND left_at IS NULL
        RETURNING session_id, duration_seconds;
    `;

    try {
        const result = await pool.query(query, [leftAt || new Date(), roomId, userId]);

        // Log activity if sessions were ended
        if (result.rows.length > 0) {
            await pool.query(
                `INSERT INTO user_activity_log (user_id, activity_type, activity_data)
                 VALUES ($1, $2, $3)`,
                [
                    userId,
                    'room_leave',
                    JSON.stringify({ 
                        room_id: roomId, 
                        left_at: leftAt,
                        sessions_ended: result.rows.length
                    })
                ]
            );
        }

        return result.rows;
    } catch (error) {
        console.error('Error ending sessions:', error);
        throw error;
    }
}

// ============================================
// STATISTICS & ANALYTICS
// ============================================

async function getStats() {
    const query = `
        SELECT
            (SELECT COUNT(*) FROM users) as total_users,
            (SELECT COUNT(*) FROM rooms) as total_rooms,
            (SELECT COUNT(*) FROM rooms WHERE is_active = true) as active_rooms,
            (SELECT COUNT(*) FROM sessions WHERE is_currently_active = true) as active_sessions,
            (SELECT COUNT(*) FROM sessions) as total_sessions,
            (SELECT COUNT(*) FROM profile_views WHERE viewed_at >= NOW() - INTERVAL '24 hours') as views_24h,
            (SELECT COUNT(*) FROM room_snapshots) as total_snapshots
    `;

    try {
        const result = await pool.query(query);
        return result.rows[0];
    } catch (error) {
        console.error('Error getting stats:', error);
        throw error;
    }
}

/**
 * Record profile view for leaderboard
 */
async function recordProfileView(userId, viewerIp, viewerUserAgent) {
    const query = `
        INSERT INTO profile_views (viewed_user_id, viewer_ip, viewer_user_agent, viewed_at)
        VALUES ($1, $2, $3, NOW())
        RETURNING view_id;
    `;

    try {
        const result = await pool.query(query, [userId, viewerIp, viewerUserAgent]);
        return result.rows[0];
    } catch (error) {
        console.error('Error recording profile view:', error);
        throw error;
    }
}

/**
 * Update daily room analytics
 */
async function updateRoomAnalytics(roomId) {
    const query = `
        INSERT INTO room_analytics (
            room_id, date, total_participants, unique_participants,
            total_sessions, avg_session_duration_seconds, peak_concurrent_users
        )
        SELECT 
            $1,
            CURRENT_DATE,
            COUNT(*) as total_participants,
            COUNT(DISTINCT user_id) as unique_participants,
            COUNT(*) as total_sessions,
            AVG(COALESCE(duration_seconds, 0))::REAL as avg_duration,
            (
                SELECT MAX(concurrent)
                FROM (
                    SELECT COUNT(*) as concurrent
                    FROM sessions
                    WHERE room_id = $1
                    AND DATE(joined_at) = CURRENT_DATE
                    AND is_currently_active = true
                    GROUP BY DATE_TRUNC('hour', joined_at)
                ) subq
            ) as peak_concurrent
        FROM sessions
        WHERE room_id = $1
        AND DATE(joined_at) = CURRENT_DATE
        ON CONFLICT (room_id, date) DO UPDATE SET
            total_participants = EXCLUDED.total_participants,
            unique_participants = EXCLUDED.unique_participants,
            total_sessions = EXCLUDED.total_sessions,
            avg_session_duration_seconds = EXCLUDED.avg_session_duration_seconds,
            peak_concurrent_users = EXCLUDED.peak_concurrent_users;
    `;

    try {
        await pool.query(query, [roomId]);
    } catch (error) {
        console.error('Error updating room analytics:', error);
    }
}

/**
 * Mark inactive rooms as no longer active
 */
async function markInactiveRooms(activeRoomIds) {
    if (activeRoomIds.length === 0) return;

    const query = `
        UPDATE rooms
        SET is_active = false, updated_at = NOW()
        WHERE is_active = true
        AND room_id NOT IN (${activeRoomIds.map((_, i) => `$${i + 1}`).join(',')})
        RETURNING room_id;
    `;

    try {
        const result = await pool.query(query, activeRoomIds);
        return result.rows;
    } catch (error) {
        console.error('Error marking inactive rooms:', error);
        throw error;
    }
}

// ============================================
// EXPORTS
// ============================================

module.exports = {
    pool,
    // User functions
    upsertUser,
    logUserProfileChanges,
    recordProfileView,

    // Room functions
    upsertRoom,
    createRoomSnapshot,
    markInactiveRooms,

    // Session functions
    getActiveSessions,
    createSession,
    endAllSessionsInRoom,
    getRoomParticipants,

    // Analytics
    getStats,
    updateRoomAnalytics,
};