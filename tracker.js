const db = require('./db');

class SessionTracker {
    constructor() {
        this.activeSessions = new Map(); // user_id -> Set of room_ids
        this.snapshotInterval = 5 * 60 * 1000; // 5 minutes
        this.lastSnapshotTime = new Map(); // room_id -> timestamp
    }

    /**
     * Initialize tracker by loading active sessions from database
     */
    async initialize() {
        // Get ALL active sessions, not just from one room
        const result = await db.pool.query(
            'SELECT session_id, user_id, room_id FROM sessions WHERE is_currently_active = true'
        );

        const sessions = result.rows;
        for (const session of sessions) {
            if (!this.activeSessions.has(session.user_id)) {
                this.activeSessions.set(session.user_id, new Set());
            }
            this.activeSessions.get(session.user_id).add(session.room_id);
        }

        console.log(`🔄 Initialized tracker with ${sessions.length} active sessions\n`);
    }

    /**
     * Process a room and its participants
     * Returns counts of joins and leaves
     */
    async processRoom(roomData) {
        const { room_id, participants } = roomData;

        // Get current participants from database
        const currentParticipants = await db.getRoomParticipants(room_id);
        const currentUserIds = new Set(currentParticipants.map(p => p.user_id));

        // Track new participants
        const newUserIds = new Set(participants.map(p => p.user_id));

        let joined = 0;
        let left = 0;

        // Detect joins
        for (const participant of participants) {
            const { 
                user_id, 
                username, 
                user_avatar, 
                followers_count,
                following_count,
                friends_count,
                supporter_level,
                verification_status, 
                position 
            } = participant;

            // Upsert user with full data (this auto-tracks profile changes)
            await db.upsertUser({
                user_id,
                username,
                user_avatar,
                followers_count,
                following_count,
                friends_count,
                supporter_level,
                verification_status,
            });

            // If user wasn't in room before, they joined
            if (!currentUserIds.has(user_id)) {
                await db.createSession({
                    user_id,
                    room_id,
                    joined_at: new Date(),
                    user_position: position,
                    is_currently_active: true,
                });

                // Update in-memory tracker
                if (!this.activeSessions.has(user_id)) {
                    this.activeSessions.set(user_id, new Set());
                }
                this.activeSessions.get(user_id).add(room_id);
                joined++;
            }
        }

        // Detect leaves
        for (const user_id of currentUserIds) {
            if (!newUserIds.has(user_id)) {
                await db.endAllSessionsInRoom(room_id, user_id, new Date());

                // Update in-memory tracker
                if (this.activeSessions.has(user_id)) {
                    this.activeSessions.get(user_id).delete(room_id);
                    if (this.activeSessions.get(user_id).size === 0) {
                        this.activeSessions.delete(user_id);
                    }
                }
                left++;
            }
        }

        // Create snapshot if enough time has passed
        await this.maybeCreateSnapshot(room_id, participants);

        // Update analytics if significant activity
        if (joined > 0 || left > 0) {
            await db.updateRoomAnalytics(room_id);
        }

        return { joined, left };
    }

    /**
     * Create room snapshot if interval has passed
     */
    async maybeCreateSnapshot(roomId, participants) {
        const now = Date.now();
        const lastSnapshot = this.lastSnapshotTime.get(roomId) || 0;

        // Create snapshot every 5 minutes
        if (now - lastSnapshot >= this.snapshotInterval) {
            try {
                await db.createRoomSnapshot(roomId, participants);
                this.lastSnapshotTime.set(roomId, now);
                console.log(`📸 Created snapshot for room ${roomId}`);
            } catch (error) {
                console.error(`Error creating snapshot for room ${roomId}:`, error.message);
            }
        }
    }

    /**
     * Get current active session count
     */
    getActiveSessionCount() {
        let count = 0;
        for (const rooms of this.activeSessions.values()) {
            count += rooms.size;
        }
        return count;
    }

    /**
     * Get active users count
     */
    getActiveUsersCount() {
        return this.activeSessions.size;
    }

    /**
     * Get stats summary
     */
    getStats() {
        return {
            activeUsers: this.activeSessions.size,
            activeSessions: this.getActiveSessionCount(),
            averageRoomsPerUser: this.activeSessions.size > 0 
                ? (this.getActiveSessionCount() / this.activeSessions.size).toFixed(2)
                : 0
        };
    }
}

module.exports = SessionTracker;