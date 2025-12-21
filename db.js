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
 * Sanitize supporter level to ensure it's a valid integer
 */
function sanitizeSupporterLevel(value) {
  if (value === null || value === undefined) return 0;
  
  const num = parseInt(value);
  if (isNaN(num)) return 0;
  
  // PostgreSQL INTEGER max is 2147483647
  if (num > 2147483647 || num < -2147483648) {
    return 0;
  }
  
  // Ensure it's between 0 and 10 (typical supporter levels)
  return Math.max(0, Math.min(10, num));
}

/**
 * Upsert user with full social metrics and history tracking
 */
async function upsertUser(userData) {
  // First, get the old user data to detect changes
  const oldUser = await pool.query(`SELECT * FROM users WHERE userid = $1`, [userData.userid]);
  
  // Smart value selection: Don't overwrite good data with zeros
  const getSmartValue = (newVal, oldVal, defaultVal = 0) => {
    const parsedNew = parseInt(newVal) || 0;
    const parsedOld = parseInt(oldVal) || 0;
    
    // If new value is 0 but old value was positive, keep old value
    if (parsedNew === 0 && parsedOld > 0) {
      return parsedOld;
    }
    
    // Otherwise use new value
    return parsedNew || defaultVal;
  };
  
  // Prepare values with smart fallback
  const followersCount = oldUser.rows.length > 0
    ? getSmartValue(userData.followerscount, oldUser.rows[0].followerscount)
    : (parseInt(userData.followerscount) || 0);
    
  const followingCount = oldUser.rows.length > 0
    ? getSmartValue(userData.followingcount, oldUser.rows[0].followingcount)
    : (parseInt(userData.followingcount) || 0);
    
  const friendsCount = oldUser.rows.length > 0
    ? getSmartValue(userData.friendscount, oldUser.rows[0].friendscount)
    : (parseInt(userData.friendscount) || 0);
  
  const query = `
    INSERT INTO users (
      userid, username, useravatar, verificationstatus,
      followerscount, followingcount, friendscount, supporterlevel,
      firstseen, lastseen
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), NOW())
    ON CONFLICT (userid) DO UPDATE SET
      username = EXCLUDED.username,
      useravatar = EXCLUDED.useravatar,
      verificationstatus = EXCLUDED.verificationstatus,
      followerscount = EXCLUDED.followerscount,
      followingcount = EXCLUDED.followingcount,
      friendscount = EXCLUDED.friendscount,
      supporterlevel = EXCLUDED.supporterlevel,
      lastseen = NOW(),
      updatedat = NOW()
    RETURNING *`;
  
  const values = [
    userData.userid,
    userData.username,
    userData.useravatar || null,
    userData.verificationstatus || 'UNVERIFIED',
    followersCount,
    followingCount,
    friendsCount,
    sanitizeSupporterLevel(userData.supporterlevel),
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
  
  // Helper function to detect if a change is valid
  const isValidChange = (oldVal, newVal) => {
    // Ignore changes TO zero (likely bad data from scraper)
    if (newVal === 0 && oldVal > 0) return false;
    
    // Ignore changes FROM zero to same value (duplicate logging)
    if (oldVal === 0 && newVal === 0) return false;
    
    // Only log if there's a real difference
    return oldVal !== newVal;
  };
  
  // Track changes in key fields with smart detection
  if (isValidChange(oldUser.followerscount, newUser.followerscount)) {
    changes.followers_count = {
      old: oldUser.followerscount,
      new: newUser.followerscount,
      diff: newUser.followerscount - oldUser.followerscount
    };
  }
  
  if (isValidChange(oldUser.followingcount, newUser.followingcount)) {
    changes.following_count = {
      old: oldUser.followingcount,
      new: newUser.followingcount,
      diff: newUser.followingcount - oldUser.followingcount
    };
  }
  
  if (isValidChange(oldUser.friendscount, newUser.friendscount)) {
    changes.friends_count = {
      old: oldUser.friendscount,
      new: newUser.friendscount,
      diff: newUser.friendscount - oldUser.friendscount
    };
  }
  
  if (oldUser.supporterlevel !== newUser.supporterlevel && newUser.supporterlevel > 0) {
    changes.supporter_level = {
      old: oldUser.supporterlevel,
      new: newUser.supporterlevel,
      diff: newUser.supporterlevel - oldUser.supporterlevel
    };
  }
  
  if (oldUser.username !== newUser.username) {
    changes.username = {
      old: oldUser.username,
      new: newUser.username
    };
  }
  
  if (oldUser.verificationstatus !== newUser.verificationstatus) {
    changes.verification_status = {
      old: oldUser.verificationstatus,
      new: newUser.verificationstatus
    };
  }
  
  // If there are VALID changes, log them
  if (Object.keys(changes).length > 0) {
    await pool.query(
      `INSERT INTO user_activity_log (userid, activitytype, activitydata)
       VALUES ($1, $2, $3)`,
      [newUser.userid, 'profile_update', JSON.stringify(changes)]
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
      roomid, channel, platform, topic, language, secondlanguage,
      skilllevel, maxcapacity, allowsunlimited, islocked,
      micallowed, micrequired, almic, nomic,
      url, creatoruserid, creatorname, creatoravatar, creatorisverified,
      isactive, isfull, isempty, currentuserscount,
      firstseen, lastactivity
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, NOW(), NOW())
    ON CONFLICT (roomid) DO UPDATE SET
      channel = EXCLUDED.channel,
      platform = EXCLUDED.platform,
      topic = EXCLUDED.topic,
      language = EXCLUDED.language,
      secondlanguage = EXCLUDED.secondlanguage,
      skilllevel = EXCLUDED.skilllevel,
      maxcapacity = EXCLUDED.maxcapacity,
      allowsunlimited = EXCLUDED.allowsunlimited,
      islocked = EXCLUDED.islocked,
      micallowed = EXCLUDED.micallowed,
      micrequired = EXCLUDED.micrequired,
      almic = EXCLUDED.almic,
      nomic = EXCLUDED.nomic,
      url = EXCLUDED.url,
      creatoruserid = EXCLUDED.creatoruserid,
      creatorname = EXCLUDED.creatorname,
      creatoravatar = EXCLUDED.creatoravatar,
      creatorisverified = EXCLUDED.creatorisverified,
      isactive = EXCLUDED.isactive,
      isfull = EXCLUDED.isfull,
      isempty = EXCLUDED.isempty,
      currentuserscount = EXCLUDED.currentuserscount,
      lastactivity = NOW(),
      updatedat = NOW()
    RETURNING roomid;
  `;
  
  const values = [
    roomData.roomid,
    roomData.channel || 'free4talk',
    roomData.platform || 'Free4Talk',
    roomData.topic || 'Anything',
    roomData.language || 'Unknown',
    roomData.secondlanguage || null,
    roomData.skilllevel || 'Any Level',
    roomData.maxcapacity || -1,
    roomData.allowsunlimited || (roomData.maxcapacity === -1),
    roomData.islocked || false,
    roomData.micallowed !== false,
    roomData.micrequired || false,
    roomData.almic || 0,
    roomData.nomic || false,
    roomData.url || null,
    roomData.creatoruserid || null,
    roomData.creatorname || null,
    roomData.creatoravatar || null,
    roomData.creatorisverified || false,
    roomData.isactive !== false,
    roomData.isfull || false,
    roomData.isempty || false,
    roomData.currentuserscount || 0,
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
    INSERT INTO roomsnapshots (
      roomid, snapshottime, participantscount, participantsjson, isactive
    ) VALUES ($1, NOW(), $2, $3, $4)
    RETURNING snapshotid;
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
    SELECT sessionid, userid, roomid, joinedat
    FROM sessions
    WHERE roomid = $1 AND iscurrentlyactive = true;
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
async function getRoomParticipants(roomid) {
  try {
    const result = await pool.query(
      `SELECT u.userid, u.username, s.sessionid
       FROM sessions s
       JOIN users u ON s.userid = u.userid
       WHERE s.roomid = $1 AND s.iscurrentlyactive = true`,
      [roomid]
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
      userid, roomid, joinedat, userposition,
      micwason, eventtype, iscurrentlyactive
    ) VALUES ($1, $2, $3, $4, $5, $6, $7)
    RETURNING sessionid;
  `;
  
  const values = [
    sessionData.userid,
    sessionData.roomid,
    sessionData.joinedat || new Date(),
    sessionData.userposition || null,
    sessionData.micwason || false,
    sessionData.eventtype || 'join',
    true
  ];
  
  try {
    const result = await pool.query(query, values);
    
    // Log activity
    await pool.query(
      `INSERT INTO user_activity_log (userid, activitytype, activitydata)
       VALUES ($1, $2, $3)`,
      [
        sessionData.userid,
        'room_join',
        JSON.stringify({ roomid: sessionData.roomid, joinedat: sessionData.joinedat })
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
    SET leftat = $1,
        durationseconds = EXTRACT(EPOCH FROM ($1 - joinedat))::INTEGER,
        eventtype = 'leave',
        iscurrentlyactive = false
    WHERE roomid = $2 AND userid = $3 AND leftat IS NULL
    RETURNING sessionid, durationseconds;
  `;
  
  try {
    const result = await pool.query(query, [leftAt || new Date(), roomId, userId]);
    
    // Log activity if sessions were ended
    if (result.rows.length > 0) {
      await pool.query(
        `INSERT INTO user_activity_log (userid, activitytype, activitydata)
         VALUES ($1, $2, $3)`,
        [
          userId,
          'room_leave',
          JSON.stringify({
            roomid: roomId,
            leftat: leftAt,
            sessionsended: result.rows.length
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
      (SELECT COUNT(*) FROM users) as totalusers,
      (SELECT COUNT(*) FROM rooms) as totalrooms,
      (SELECT COUNT(*) FROM rooms WHERE isactive = true) as activerooms,
      (SELECT COUNT(*) FROM sessions WHERE iscurrentlyactive = true) as activesessions,
      (SELECT COUNT(*) FROM sessions) as totalsessions,
      (SELECT COUNT(*) FROM profileviews WHERE viewedat >= NOW() - INTERVAL '24 hours') as views24h,
      (SELECT COUNT(*) FROM roomsnapshots) as totalsnapshots
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
    INSERT INTO profileviews (vieweduserid, viewerip, vieweruseragent, viewedat)
    VALUES ($1, $2, $3, NOW())
    RETURNING viewid;
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
    INSERT INTO roomanalytics (
      roomid,
      date,
      totalparticipants,
      uniqueparticipants,
      totalsessions,
      avgsessiondurationseconds,
      peakconcurrentusers
    )
    SELECT
      $1::VARCHAR,
      CURRENT_DATE,
      COUNT(*) as totalparticipants,
      COUNT(DISTINCT userid) as uniqueparticipants,
      COUNT(*) as totalsessions,
      COALESCE(AVG(COALESCE(durationseconds, 0)), 0)::REAL as avgduration,
      COALESCE((
        SELECT MAX(concurrentcount)
        FROM (
          SELECT
            DATE_TRUNC('minute', joinedat) as timeslot,
            COUNT(*) as concurrentcount
          FROM sessions
          WHERE roomid = $1::VARCHAR
            AND DATE(joinedat) = CURRENT_DATE
            AND (iscurrentlyactive = true OR leftat IS NOT NULL)
          GROUP BY DATE_TRUNC('minute', joinedat)
        ) subq
      ), 0) as peakconcurrent
    FROM sessions
    WHERE roomid = $1::VARCHAR
      AND DATE(joinedat) = CURRENT_DATE
    ON CONFLICT (roomid, date) DO UPDATE SET
      totalparticipants = EXCLUDED.totalparticipants,
      uniqueparticipants = EXCLUDED.uniqueparticipants,
      totalsessions = EXCLUDED.totalsessions,
      avgsessiondurationseconds = EXCLUDED.avgsessiondurationseconds,
      peakconcurrentusers = EXCLUDED.peakconcurrentusers;
  `;
  
  try {
    await pool.query(query, [roomId]);
  } catch (error) {
    console.error('Error updating room analytics:', error);
    // Don't throw - this is non-critical
  }
}

/**
 * Mark inactive rooms as no longer active
 */
async function markInactiveRooms(activeRoomIds) {
  if (activeRoomIds.length === 0) return;
  
  const query = `
    UPDATE rooms
    SET isactive = false, updatedat = NOW()
    WHERE isactive = true
      AND roomid NOT IN (${activeRoomIds.map((_, i) => `$${i + 1}`).join(',')})
    RETURNING roomid;
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

