// db.js - FIXED VERSION
const { Pool } = require('pg');
const config = require('./config');

class Database {
  constructor() {
    this.pool = new Pool({
      connectionString: config.DATABASE_URL,
      ssl: config.DATABASE_URL.includes('aiven') ? { rejectUnauthorized: false } : false
    });
  }

  async connect() {
    try {
      const client = await this.pool.connect();
      console.log('✅ Connected to PostgreSQL database');
      client.release();
      return true;
    } catch (error) {
      console.error('❌ Database connection error:', error.message);
      throw error;
    }
  }

  /**
   * FIXED: Upsert user with proper update logic
   */
  async upsertUser(userData) {
    const {
      username,
      displayName,
      avatarUrl,
      bio,
      followerCount,
      followingCount,
      friendsCount,
      gender,
      languages,
      interests
    } = userData;

    // First, try to INSERT
    const insertQuery = `
      INSERT INTO users (
        username, display_name, avatar_url, bio, 
        follower_count, following_count, friends_count, 
        gender, languages, interests, last_active
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())
      ON CONFLICT (username) DO NOTHING
      RETURNING *
    `;

    const values = [
      username,
      displayName || username,
      avatarUrl,
      bio,
      followerCount || 0,
      followingCount || 0,
      friendsCount || 0,
      gender,
      languages || [],
      interests || []
    ];

    try {
      const insertResult = await this.pool.query(insertQuery, values);

      // If insert succeeded, return the new row
      if (insertResult.rowCount > 0) {
        console.log(`✅ Inserted new user: ${username}`);
        return insertResult.rows[0];
      }

      // Otherwise, UPDATE the existing row
      const updateQuery = `
        UPDATE users SET
          display_name = $2,
          avatar_url = $3,
          bio = $4,
          follower_count = $5,
          following_count = $6,
          friends_count = $7,
          gender = $8,
          languages = $9,
          interests = $10,
          last_active = NOW(),
          updated_at = NOW()
        WHERE username = $1
        RETURNING *
      `;

      const updateResult = await this.pool.query(updateQuery, values);

      if (updateResult.rowCount > 0) {
        console.log(`🔄 Updated user: ${username} (${followerCount} followers)`);
        return updateResult.rows[0];
      }

      throw new Error(`Failed to upsert user ${username}`);

    } catch (error) {
      console.error(`❌ Error upserting user ${username}:`, error.message);
      throw error;
    }
  }

  /**
   * NEW: Add or update a user relationship
   */
  async upsertRelationship(username, relatedUsername, type) {
    const query = `
      WITH user_ids AS (
        SELECT 
          u1.id as user_id,
          u2.id as related_user_id
        FROM users u1
        CROSS JOIN users u2
        WHERE u1.username = $1 AND u2.username = $2
      )
      INSERT INTO user_relationships (user_id, related_user_id, relationship_type)
      SELECT user_id, related_user_id, $3
      FROM user_ids
      ON CONFLICT (user_id, related_user_id, relationship_type) 
      DO UPDATE SET created_at = NOW()
      RETURNING *
    `;

    try {
      const result = await this.pool.query(query, [username, relatedUsername, type]);
      return result.rows[0];
    } catch (error) {
      console.error(`Error adding ${type} relationship ${username} -> ${relatedUsername}:`, error.message);
      return null;
    }
  }

  /**
   * NEW: Bulk insert relationships (more efficient)
   */
  async bulkInsertRelationships(username, relatedUsernames, type) {
    if (!relatedUsernames || relatedUsernames.length === 0) {
      return 0;
    }

    const query = `
      WITH user_id AS (
        SELECT id FROM users WHERE username = $1
      ),
      related_ids AS (
        SELECT id, username FROM users WHERE username = ANY($2)
      )
      INSERT INTO user_relationships (user_id, related_user_id, relationship_type)
      SELECT user_id.id, related_ids.id, $3
      FROM user_id
      CROSS JOIN related_ids
      ON CONFLICT (user_id, related_user_id, relationship_type) DO NOTHING
    `;

    try {
      const result = await this.pool.query(query, [username, relatedUsernames, type]);
      console.log(`✅ Added ${result.rowCount} ${type} relationships for ${username}`);
      return result.rowCount;
    } catch (error) {
      console.error(`Error bulk inserting ${type} for ${username}:`, error.message);
      return 0;
    }
  }

  /**
   * Upsert a room
   */
  async upsertRoom(roomData) {
    const { roomId, roomName, topic, language, isPublic, participantCount, createdBy } = roomData;

    const query = `
      INSERT INTO rooms (room_id, room_name, topic, language, is_public, participant_count, created_by)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      ON CONFLICT (room_id) 
      DO UPDATE SET
        room_name = EXCLUDED.room_name,
        topic = EXCLUDED.topic,
        language = EXCLUDED.language,
        participant_count = EXCLUDED.participant_count,
        last_active = NOW(),
        updated_at = NOW()
      RETURNING *
    `;

    try {
      const result = await this.pool.query(query, [
        roomId, roomName, topic, language, isPublic !== false, participantCount || 0, createdBy
      ]);
      return result.rows[0];
    } catch (error) {
      console.error(`Error upserting room ${roomId}:`, error.message);
      throw error;
    }
  }

  /**
   * NEW: Add room participant
   */
  async addRoomParticipant(roomId, username, role = 'listener') {
    const query = `
      WITH room_user AS (
        SELECT r.id as room_id, u.id as user_id
        FROM rooms r
        CROSS JOIN users u
        WHERE r.room_id = $1 AND u.username = $2
      )
      INSERT INTO room_participants (room_id, user_id, role)
      SELECT room_id, user_id, $3
      FROM room_user
      ON CONFLICT (room_id, user_id, joined_at) DO NOTHING
      RETURNING *
    `;

    try {
      const result = await this.pool.query(query, [roomId, username, role]);
      return result.rows[0];
    } catch (error) {
      console.error(`Error adding participant ${username} to room ${roomId}:`, error.message);
      return null;
    }
  }

  /**
   * NEW: Bulk add room participants
   */
  async bulkAddRoomParticipants(roomId, participants) {
    if (!participants || participants.length === 0) {
      return 0;
    }

    const query = `
      WITH room_id_lookup AS (
        SELECT id FROM rooms WHERE room_id = $1
      ),
      user_data AS (
        SELECT unnest($2::text[]) as username, unnest($3::text[]) as role
      ),
      user_ids AS (
        SELECT u.id, ud.role
        FROM users u
        JOIN user_data ud ON u.username = ud.username
      )
      INSERT INTO room_participants (room_id, user_id, role)
      SELECT room_id_lookup.id, user_ids.id, user_ids.role
      FROM room_id_lookup
      CROSS JOIN user_ids
      ON CONFLICT (room_id, user_id, joined_at) DO NOTHING
    `;

    try {
      const usernames = participants.map(p => p.username);
      const roles = participants.map(p => p.role || 'listener');

      const result = await this.pool.query(query, [roomId, usernames, roles]);
      console.log(`✅ Added ${result.rowCount} participants to room ${roomId}`);
      return result.rowCount;
    } catch (error) {
      console.error(`Error bulk adding participants to room ${roomId}:`, error.message);
      return 0;
    }
  }

  /**
   * Create or update a session
   */
  async upsertSession(sessionData) {
    const { username, roomId, joinedAt, leftAt, duration } = sessionData;

    const query = `
      WITH user_room AS (
        SELECT u.id as user_id, r.id as room_id
        FROM users u
        CROSS JOIN rooms r
        WHERE u.username = $1 AND r.room_id = $2
      )
      INSERT INTO sessions (user_id, room_id, joined_at, left_at, duration)
      SELECT user_id, room_id, $3, $4, $5
      FROM user_room
      RETURNING *
    `;

    try {
      const result = await this.pool.query(query, [
        username,
        roomId,
        joinedAt || new Date(),
        leftAt,
        duration
      ]);
      return result.rows[0];
    } catch (error) {
      console.error('Error upserting session:', error.message);
      return null;
    }
  }

  /**
   * Get user by username
   */
  async getUserByUsername(username) {
    const query = 'SELECT * FROM users WHERE username = $1';
    try {
      const result = await this.pool.query(query, [username]);
      return result.rows[0] || null;
    } catch (error) {
      console.error(`Error getting user ${username}:`, error.message);
      return null;
    }
  }

  /**
   * Get all users
   */
  async getAllUsers(limit = 100) {
    const query = 'SELECT * FROM users ORDER BY last_active DESC LIMIT $1';
    try {
      const result = await this.pool.query(query, [limit]);
      return result.rows;
    } catch (error) {
      console.error('Error getting all users:', error.message);
      return [];
    }
  }

  /**
   * Get user relationships
   */
  async getUserRelationships(username, type) {
    const query = `
      SELECT u2.username, u2.display_name, u2.avatar_url, ur.created_at
      FROM user_relationships ur
      JOIN users u1 ON ur.user_id = u1.id
      JOIN users u2 ON ur.related_user_id = u2.id
      WHERE u1.username = $1 AND ur.relationship_type = $2
      ORDER BY ur.created_at DESC
    `;

    try {
      const result = await this.pool.query(query, [username, type]);
      return result.rows;
    } catch (error) {
      console.error(`Error getting ${type} for ${username}:`, error.message);
      return [];
    }
  }

  /**
   * Get room participants
   */
  async getRoomParticipants(roomId) {
    const query = `
      SELECT u.username, u.display_name, u.avatar_url, rp.role, rp.joined_at
      FROM room_participants rp
      JOIN rooms r ON rp.room_id = r.id
      JOIN users u ON rp.user_id = u.id
      WHERE r.room_id = $1 AND rp.left_at IS NULL
      ORDER BY rp.joined_at DESC
    `;

    try {
      const result = await this.pool.query(query, [roomId]);
      return result.rows;
    } catch (error) {
      console.error(`Error getting participants for room ${roomId}:`, error.message);
      return [];
    }
  }

  /**
   * Get database statistics
   */
  async getStats() {
    const query = `
      SELECT 
        (SELECT COUNT(*) FROM users) as user_count,
        (SELECT COUNT(*) FROM rooms) as room_count,
        (SELECT COUNT(*) FROM sessions) as session_count,
        (SELECT COUNT(*) FROM user_relationships) as relationship_count,
        (SELECT COUNT(*) FROM room_participants WHERE left_at IS NULL) as active_participant_count
    `;

    try {
      const result = await this.pool.query(query);
      return result.rows[0];
    } catch (error) {
      console.error('Error getting stats:', error.message);
      return null;
    }
  }

  async close() {
    await this.pool.end();
    console.log('🔌 Database connection closed');
  }
}

module.exports = Database;