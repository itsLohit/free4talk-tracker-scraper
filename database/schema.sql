-- ============================================
-- FREE4TALK TRACKER DATABASE SCHEMA
-- World's Best PostgreSQL Schema for Tracking
-- ============================================

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm"; -- For fuzzy text search

-- ============================================
-- CORE TABLES
-- ============================================

-- Users Table: Store all user information
CREATE TABLE IF NOT EXISTS users (
    user_id VARCHAR(50) PRIMARY KEY,
    username VARCHAR(100) NOT NULL,
    user_avatar TEXT,
    verification_status VARCHAR(20) DEFAULT 'UNVERIFIED' CHECK (verification_status IN ('VERIFIED', 'UNVERIFIED')),

    -- Social metrics (from API)
    followers_count INTEGER DEFAULT 0,
    following_count INTEGER DEFAULT 0,
    friends_count INTEGER DEFAULT 0,
    supporter_level INTEGER DEFAULT 0,

    -- Tracking metadata
    first_seen TIMESTAMP NOT NULL DEFAULT NOW(),
    last_seen TIMESTAMP NOT NULL DEFAULT NOW(),

    -- Profile metadata
    total_sessions INTEGER DEFAULT 0,
    total_duration_seconds BIGINT DEFAULT 0,
    profile_views_count INTEGER DEFAULT 0,

    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- Rooms Table: Store all room/group information
CREATE TABLE IF NOT EXISTS rooms (
    room_id VARCHAR(100) PRIMARY KEY,

    -- Room details
    channel VARCHAR(50) DEFAULT 'free4talk',
    platform VARCHAR(50) DEFAULT 'Free4Talk',
    topic VARCHAR(200) DEFAULT 'Anything',
    language VARCHAR(50) NOT NULL,
    second_language VARCHAR(50),
    skill_level VARCHAR(50) DEFAULT 'Any Level' CHECK (
        skill_level IN ('Beginner', 'Intermediate', 'Advanced', 'Any Level')
    ),

    -- Room settings
    max_capacity INTEGER DEFAULT -1, -- -1 means unlimited
    allows_unlimited BOOLEAN DEFAULT FALSE,
    is_locked BOOLEAN DEFAULT FALSE,

    -- Mic settings
    mic_allowed BOOLEAN DEFAULT TRUE,
    mic_required BOOLEAN DEFAULT FALSE,
    al_mic INTEGER DEFAULT 0,
    no_mic BOOLEAN DEFAULT FALSE,

    -- Room status
    is_active BOOLEAN DEFAULT TRUE,
    is_full BOOLEAN DEFAULT FALSE,
    is_empty BOOLEAN DEFAULT TRUE,
    current_users_count INTEGER DEFAULT 0,

    -- Room URL
    url TEXT,

    -- Creator information
    creator_user_id VARCHAR(50),
    creator_name VARCHAR(100),
    creator_avatar TEXT,
    creator_is_verified BOOLEAN DEFAULT FALSE,

    -- Timestamps
    first_seen TIMESTAMP NOT NULL DEFAULT NOW(),
    last_activity TIMESTAMP NOT NULL DEFAULT NOW(),
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),

    FOREIGN KEY (creator_user_id) REFERENCES users(user_id) ON DELETE SET NULL
);

-- Sessions Table: Track user participation in rooms
CREATE TABLE IF NOT EXISTS sessions (
    session_id BIGSERIAL PRIMARY KEY,
    user_id VARCHAR(50) NOT NULL,
    room_id VARCHAR(100) NOT NULL,

    -- Session timing
    joined_at TIMESTAMP NOT NULL DEFAULT NOW(),
    left_at TIMESTAMP,
    duration_seconds INTEGER,

    -- Session metadata
    user_position INTEGER, -- Position in the room (1, 2, 3, etc.)
    mic_was_on BOOLEAN DEFAULT FALSE,
    event_type VARCHAR(20) DEFAULT 'join' CHECK (event_type IN ('join', 'leave', 'kicked', 'disconnected')),
    is_currently_active BOOLEAN DEFAULT TRUE,

    created_at TIMESTAMP DEFAULT NOW(),

    FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE,
    FOREIGN KEY (room_id) REFERENCES rooms(room_id) ON DELETE CASCADE,

    -- Constraint: left_at must be after joined_at
    CONSTRAINT valid_session_times CHECK (left_at IS NULL OR left_at >= joined_at)
);

-- ============================================
-- ANALYTICS & TRACKING TABLES
-- ============================================

-- Profile Views: Track who viewed whose profile
CREATE TABLE IF NOT EXISTS profile_views (
    view_id BIGSERIAL PRIMARY KEY,
    viewed_user_id VARCHAR(50) NOT NULL,
    viewer_ip VARCHAR(45), -- IPv4 or IPv6
    viewer_user_agent TEXT,
    viewed_at TIMESTAMP NOT NULL DEFAULT NOW(),

    FOREIGN KEY (viewed_user_id) REFERENCES users(user_id) ON DELETE CASCADE
);

-- Room History Snapshot: Periodic snapshots of room state
CREATE TABLE IF NOT EXISTS room_snapshots (
    snapshot_id BIGSERIAL PRIMARY KEY,
    room_id VARCHAR(100) NOT NULL,
    snapshot_time TIMESTAMP NOT NULL DEFAULT NOW(),

    -- Room state at snapshot time
    participants_count INTEGER DEFAULT 0,
    participants_json JSONB, -- Store full participant list
    is_active BOOLEAN DEFAULT TRUE,

    FOREIGN KEY (room_id) REFERENCES rooms(room_id) ON DELETE CASCADE
);

-- User Activity Log: Track interesting user events
CREATE TABLE IF NOT EXISTS user_activity_log (
    log_id BIGSERIAL PRIMARY KEY,
    user_id VARCHAR(50) NOT NULL,
    activity_type VARCHAR(50) NOT NULL, -- 'profile_view', 'room_join', 'room_leave', etc.
    activity_data JSONB, -- Flexible JSON storage for activity details
    activity_time TIMESTAMP NOT NULL DEFAULT NOW(),

    FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
);

-- Room Analytics: Aggregated room statistics
CREATE TABLE IF NOT EXISTS room_analytics (
    analytics_id BIGSERIAL PRIMARY KEY,
    room_id VARCHAR(100) NOT NULL,
    date DATE NOT NULL DEFAULT CURRENT_DATE,

    -- Daily metrics
    total_participants INTEGER DEFAULT 0,
    unique_participants INTEGER DEFAULT 0,
    total_sessions INTEGER DEFAULT 0,
    avg_session_duration_seconds REAL DEFAULT 0,
    peak_concurrent_users INTEGER DEFAULT 0,

    created_at TIMESTAMP DEFAULT NOW(),

    FOREIGN KEY (room_id) REFERENCES rooms(room_id) ON DELETE CASCADE,
    UNIQUE(room_id, date)
);

-- ============================================
-- INDEXES FOR PERFORMANCE
-- ============================================

-- Users indexes
CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
CREATE INDEX IF NOT EXISTS idx_users_last_seen ON users(last_seen DESC);
CREATE INDEX IF NOT EXISTS idx_users_verification ON users(verification_status);
CREATE INDEX IF NOT EXISTS idx_users_username_trgm ON users USING gin(username gin_trgm_ops);

-- Rooms indexes
CREATE INDEX IF NOT EXISTS idx_rooms_language ON rooms(language);
CREATE INDEX IF NOT EXISTS idx_rooms_skill_level ON rooms(skill_level);
CREATE INDEX IF NOT EXISTS idx_rooms_topic ON rooms(topic);
CREATE INDEX IF NOT EXISTS idx_rooms_is_active ON rooms(is_active);
CREATE INDEX IF NOT EXISTS idx_rooms_last_activity ON rooms(last_activity DESC);
CREATE INDEX IF NOT EXISTS idx_rooms_creator ON rooms(creator_user_id);
CREATE INDEX IF NOT EXISTS idx_rooms_topic_trgm ON rooms USING gin(topic gin_trgm_ops);

-- Sessions indexes
CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_room_id ON sessions(room_id);
CREATE INDEX IF NOT EXISTS idx_sessions_joined_at ON sessions(joined_at DESC);
CREATE INDEX IF NOT EXISTS idx_sessions_is_active ON sessions(is_currently_active);
CREATE INDEX IF NOT EXISTS idx_sessions_user_room ON sessions(user_id, room_id);
CREATE INDEX IF NOT EXISTS idx_sessions_user_joined ON sessions(user_id, joined_at DESC);

-- Profile Views indexes
CREATE INDEX IF NOT EXISTS idx_profile_views_user ON profile_views(viewed_user_id);
CREATE INDEX IF NOT EXISTS idx_profile_views_time ON profile_views(viewed_at DESC);
CREATE INDEX IF NOT EXISTS idx_profile_views_user_time ON profile_views(viewed_user_id, viewed_at DESC);

-- Room Snapshots indexes
CREATE INDEX IF NOT EXISTS idx_snapshots_room ON room_snapshots(room_id);
CREATE INDEX IF NOT EXISTS idx_snapshots_time ON room_snapshots(snapshot_time DESC);

-- User Activity Log indexes
CREATE INDEX IF NOT EXISTS idx_activity_user ON user_activity_log(user_id);
CREATE INDEX IF NOT EXISTS idx_activity_type ON user_activity_log(activity_type);
CREATE INDEX IF NOT EXISTS idx_activity_time ON user_activity_log(activity_time DESC);

-- Room Analytics indexes
CREATE INDEX IF NOT EXISTS idx_analytics_room ON room_analytics(room_id);
CREATE INDEX IF NOT EXISTS idx_analytics_date ON room_analytics(date DESC);

-- ============================================
-- FUNCTIONS & STORED PROCEDURES
-- ============================================

-- Function: Get user's complete room history
CREATE OR REPLACE FUNCTION get_user_room_history(p_user_id VARCHAR)
RETURNS TABLE (
    room_id VARCHAR,
    topic VARCHAR,
    language VARCHAR,
    skill_level VARCHAR,
    joined_at TIMESTAMP,
    left_at TIMESTAMP,
    duration_seconds INTEGER,
    session_count BIGINT
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        s.room_id,
        r.topic,
        r.language,
        r.skill_level,
        MIN(s.joined_at) as first_join,
        MAX(s.left_at) as last_leave,
        SUM(s.duration_seconds)::INTEGER as total_duration,
        COUNT(*)::BIGINT as session_count
    FROM sessions s
    JOIN rooms r ON s.room_id = r.room_id
    WHERE s.user_id = p_user_id
    GROUP BY s.room_id, r.topic, r.language, r.skill_level
    ORDER BY first_join DESC;
END;
$$ LANGUAGE plpgsql;

-- Function: Find shared rooms between two users
CREATE OR REPLACE FUNCTION get_shared_rooms(p_user_id_1 VARCHAR, p_user_id_2 VARCHAR)
RETURNS TABLE (
    room_id VARCHAR,
    topic VARCHAR,
    language VARCHAR,
    user1_sessions BIGINT,
    user2_sessions BIGINT,
    were_together_count BIGINT,
    last_together TIMESTAMP
) AS $$
BEGIN
    RETURN QUERY
    WITH user1_sessions AS (
        SELECT room_id, joined_at, left_at
        FROM sessions
        WHERE user_id = p_user_id_1 AND left_at IS NOT NULL
    ),
    user2_sessions AS (
        SELECT room_id, joined_at, left_at
        FROM sessions
        WHERE user_id = p_user_id_2 AND left_at IS NOT NULL
    ),
    overlapping_sessions AS (
        SELECT 
            u1.room_id,
            COUNT(*) as together_count,
            MAX(GREATEST(u1.joined_at, u2.joined_at)) as last_together
        FROM user1_sessions u1
        JOIN user2_sessions u2 ON u1.room_id = u2.room_id
        WHERE u1.joined_at < u2.left_at AND u2.joined_at < u1.left_at
        GROUP BY u1.room_id
    )
    SELECT 
        r.room_id,
        r.topic,
        r.language,
        (SELECT COUNT(*)::BIGINT FROM sessions WHERE user_id = p_user_id_1 AND room_id = r.room_id) as user1_sessions,
        (SELECT COUNT(*)::BIGINT FROM sessions WHERE user_id = p_user_id_2 AND room_id = r.room_id) as user2_sessions,
        COALESCE(o.together_count, 0)::BIGINT as were_together_count,
        o.last_together
    FROM rooms r
    LEFT JOIN overlapping_sessions o ON r.room_id = o.room_id
    WHERE EXISTS (
        SELECT 1 FROM sessions WHERE user_id = p_user_id_1 AND room_id = r.room_id
    ) AND EXISTS (
        SELECT 1 FROM sessions WHERE user_id = p_user_id_2 AND room_id = r.room_id
    )
    ORDER BY were_together_count DESC, last_together DESC;
END;
$$ LANGUAGE plpgsql;

-- Function: Get room timeline (all join/leave events)
CREATE OR REPLACE FUNCTION get_room_timeline(p_room_id VARCHAR, p_user_filter VARCHAR[] DEFAULT NULL)
RETURNS TABLE (
    session_id BIGINT,
    user_id VARCHAR,
    username VARCHAR,
    user_avatar TEXT,
    event_type VARCHAR,
    event_time TIMESTAMP,
    duration_seconds INTEGER,
    is_currently_active BOOLEAN
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        s.session_id,
        s.user_id,
        u.username,
        u.user_avatar,
        CASE 
            WHEN s.left_at IS NULL THEN 'join'::VARCHAR
            ELSE 'leave'::VARCHAR
        END as event_type,
        CASE 
            WHEN s.left_at IS NULL THEN s.joined_at
            ELSE s.left_at
        END as event_time,
        s.duration_seconds,
        s.is_currently_active
    FROM sessions s
    JOIN users u ON s.user_id = u.user_id
    WHERE s.room_id = p_room_id
        AND (p_user_filter IS NULL OR s.user_id = ANY(p_user_filter))
    ORDER BY event_time ASC;
END;
$$ LANGUAGE plpgsql;

-- Function: Get most stalked users (leaderboard)
CREATE OR REPLACE FUNCTION get_most_stalked_users(p_days INTEGER DEFAULT 7, p_limit INTEGER DEFAULT 20)
RETURNS TABLE (
    user_id VARCHAR,
    username VARCHAR,
    user_avatar TEXT,
    verification_status VARCHAR,
    view_count BIGINT,
    last_viewed TIMESTAMP
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        u.user_id,
        u.username,
        u.user_avatar,
        u.verification_status,
        COUNT(pv.view_id)::BIGINT as view_count,
        MAX(pv.viewed_at) as last_viewed
    FROM users u
    JOIN profile_views pv ON u.user_id = pv.viewed_user_id
    WHERE pv.viewed_at >= NOW() - (p_days || ' days')::INTERVAL
    GROUP BY u.user_id, u.username, u.user_avatar, u.verification_status
    ORDER BY view_count DESC
    LIMIT p_limit;
END;
$$ LANGUAGE plpgsql;

-- Function: Get active users in a room (with green glow indicator)
CREATE OR REPLACE FUNCTION get_room_active_users(p_room_id VARCHAR)
RETURNS TABLE (
    user_id VARCHAR,
    username VARCHAR,
    user_avatar TEXT,
    joined_at TIMESTAMP,
    duration_seconds INTEGER,
    is_active BOOLEAN
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        u.user_id,
        u.username,
        u.user_avatar,
        s.joined_at,
        EXTRACT(EPOCH FROM (NOW() - s.joined_at))::INTEGER as duration_seconds,
        s.is_currently_active as is_active
    FROM sessions s
    JOIN users u ON s.user_id = u.user_id
    WHERE s.room_id = p_room_id 
        AND s.is_currently_active = TRUE
    ORDER BY s.joined_at ASC;
END;
$$ LANGUAGE plpgsql;

-- Function: Search users by username (fuzzy search)
CREATE OR REPLACE FUNCTION search_users(p_query VARCHAR, p_limit INTEGER DEFAULT 20)
RETURNS TABLE (
    user_id VARCHAR,
    username VARCHAR,
    user_avatar TEXT,
    verification_status VARCHAR,
    followers_count INTEGER,
    last_seen TIMESTAMP,
    similarity_score REAL
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        u.user_id,
        u.username,
        u.user_avatar,
        u.verification_status,
        u.followers_count,
        u.last_seen,
        SIMILARITY(u.username, p_query) as similarity_score
    FROM users u
    WHERE u.username ILIKE '%' || p_query || '%'
        OR SIMILARITY(u.username, p_query) > 0.3
    ORDER BY similarity_score DESC, u.followers_count DESC
    LIMIT p_limit;
END;
$$ LANGUAGE plpgsql;

-- Function: Get room statistics
CREATE OR REPLACE FUNCTION get_room_statistics(p_room_id VARCHAR)
RETURNS TABLE (
    total_participants BIGINT,
    unique_participants BIGINT,
    total_sessions BIGINT,
    avg_duration_seconds REAL,
    max_duration_seconds INTEGER,
    first_activity TIMESTAMP,
    last_activity TIMESTAMP,
    is_currently_active BOOLEAN
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        COUNT(DISTINCT s.session_id)::BIGINT as total_participants,
        COUNT(DISTINCT s.user_id)::BIGINT as unique_participants,
        COUNT(*)::BIGINT as total_sessions,
        AVG(s.duration_seconds)::REAL as avg_duration_seconds,
        MAX(s.duration_seconds) as max_duration_seconds,
        MIN(s.joined_at) as first_activity,
        MAX(COALESCE(s.left_at, s.joined_at)) as last_activity,
        EXISTS(SELECT 1 FROM sessions WHERE room_id = p_room_id AND is_currently_active = TRUE) as is_currently_active
    FROM sessions s
    WHERE s.room_id = p_room_id;
END;
$$ LANGUAGE plpgsql;

-- Function: Get user statistics
CREATE OR REPLACE FUNCTION get_user_statistics(p_user_id VARCHAR)
RETURNS TABLE (
    total_rooms BIGINT,
    total_sessions BIGINT,
    total_duration_seconds BIGINT,
    avg_session_duration REAL,
    favorite_language VARCHAR,
    favorite_skill_level VARCHAR,
    first_seen TIMESTAMP,
    last_seen TIMESTAMP,
    is_currently_active BOOLEAN
) AS $$
BEGIN
    RETURN QUERY
    WITH user_stats AS (
        SELECT 
            COUNT(DISTINCT s.room_id)::BIGINT as rooms,
            COUNT(*)::BIGINT as sessions,
            SUM(COALESCE(s.duration_seconds, 0))::BIGINT as duration,
            AVG(COALESCE(s.duration_seconds, 0))::REAL as avg_duration
        FROM sessions s
        WHERE s.user_id = p_user_id
    ),
    favorite_lang AS (
        SELECT r.language
        FROM sessions s
        JOIN rooms r ON s.room_id = r.room_id
        WHERE s.user_id = p_user_id
        GROUP BY r.language
        ORDER BY COUNT(*) DESC
        LIMIT 1
    ),
    favorite_level AS (
        SELECT r.skill_level
        FROM sessions s
        JOIN rooms r ON s.room_id = r.room_id
        WHERE s.user_id = p_user_id
        GROUP BY r.skill_level
        ORDER BY COUNT(*) DESC
        LIMIT 1
    ),
    user_times AS (
        SELECT 
            MIN(s.joined_at) as first_seen,
            MAX(COALESCE(s.left_at, s.joined_at)) as last_seen
        FROM sessions s
        WHERE s.user_id = p_user_id
    )
    SELECT 
        us.rooms,
        us.sessions,
        us.duration,
        us.avg_duration,
        fl.language,
        fsl.skill_level,
        ut.first_seen,
        ut.last_seen,
        EXISTS(SELECT 1 FROM sessions WHERE user_id = p_user_id AND is_currently_active = TRUE) as is_currently_active
    FROM user_stats us
    CROSS JOIN favorite_lang fl
    CROSS JOIN favorite_level fsl
    CROSS JOIN user_times ut;
END;
$$ LANGUAGE plpgsql;

-- Function: Get trending rooms (most active in last N hours)
CREATE OR REPLACE FUNCTION get_trending_rooms(p_hours INTEGER DEFAULT 24, p_limit INTEGER DEFAULT 10)
RETURNS TABLE (
    room_id VARCHAR,
    topic VARCHAR,
    language VARCHAR,
    skill_level VARCHAR,
    participant_count BIGINT,
    session_count BIGINT,
    is_currently_active BOOLEAN
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        r.room_id,
        r.topic,
        r.language,
        r.skill_level,
        COUNT(DISTINCT s.user_id)::BIGINT as participant_count,
        COUNT(*)::BIGINT as session_count,
        r.is_active as is_currently_active
    FROM rooms r
    JOIN sessions s ON r.room_id = s.room_id
    WHERE s.joined_at >= NOW() - (p_hours || ' hours')::INTERVAL
    GROUP BY r.room_id, r.topic, r.language, r.skill_level, r.is_active
    ORDER BY session_count DESC, participant_count DESC
    LIMIT p_limit;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- TRIGGERS FOR AUTOMATIC UPDATES
-- ============================================

-- Trigger: Update user's last_seen on session activity
CREATE OR REPLACE FUNCTION update_user_last_seen()
RETURNS TRIGGER AS $$
BEGIN
    UPDATE users 
    SET last_seen = NEW.joined_at,
        updated_at = NOW()
    WHERE user_id = NEW.user_id;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_user_last_seen
AFTER INSERT ON sessions
FOR EACH ROW
EXECUTE FUNCTION update_user_last_seen();

-- Trigger: Update room last_activity on session changes
CREATE OR REPLACE FUNCTION update_room_last_activity()
RETURNS TRIGGER AS $$
BEGIN
    UPDATE rooms 
    SET last_activity = COALESCE(NEW.left_at, NEW.joined_at),
        updated_at = NOW()
    WHERE room_id = NEW.room_id;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_room_last_activity
AFTER INSERT OR UPDATE ON sessions
FOR EACH ROW
EXECUTE FUNCTION update_room_last_activity();

-- Trigger: Calculate session duration on leave
CREATE OR REPLACE FUNCTION calculate_session_duration()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.left_at IS NOT NULL AND OLD.left_at IS NULL THEN
        NEW.duration_seconds := EXTRACT(EPOCH FROM (NEW.left_at - NEW.joined_at))::INTEGER;
        NEW.is_currently_active := FALSE;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_calculate_session_duration
BEFORE UPDATE ON sessions
FOR EACH ROW
EXECUTE FUNCTION calculate_session_duration();

-- Trigger: Update user total stats on session changes
CREATE OR REPLACE FUNCTION update_user_session_stats()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        UPDATE users
        SET total_sessions = total_sessions + 1
        WHERE user_id = NEW.user_id;
    ELSIF TG_OP = 'UPDATE' AND NEW.duration_seconds IS NOT NULL AND OLD.duration_seconds IS NULL THEN
        UPDATE users
        SET total_duration_seconds = total_duration_seconds + NEW.duration_seconds
        WHERE user_id = NEW.user_id;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_user_session_stats
AFTER INSERT OR UPDATE ON sessions
FOR EACH ROW
EXECUTE FUNCTION update_user_session_stats();

-- Trigger: Update room current_users_count
CREATE OR REPLACE FUNCTION update_room_user_count()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'INSERT' OR TG_OP = 'UPDATE' THEN
        UPDATE rooms
        SET current_users_count = (
            SELECT COUNT(DISTINCT user_id)
            FROM sessions
            WHERE room_id = NEW.room_id AND is_currently_active = TRUE
        ),
        is_empty = (
            SELECT COUNT(*) = 0
            FROM sessions
            WHERE room_id = NEW.room_id AND is_currently_active = TRUE
        ),
        updated_at = NOW()
        WHERE room_id = NEW.room_id;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_room_user_count
AFTER INSERT OR UPDATE ON sessions
FOR EACH ROW
EXECUTE FUNCTION update_room_user_count();

-- Trigger: Increment profile_views_count on profile view
CREATE OR REPLACE FUNCTION increment_profile_views()
RETURNS TRIGGER AS $$
BEGIN
    UPDATE users
    SET profile_views_count = profile_views_count + 1
    WHERE user_id = NEW.viewed_user_id;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_increment_profile_views
AFTER INSERT ON profile_views
FOR EACH ROW
EXECUTE FUNCTION increment_profile_views();

-- ============================================
-- MATERIALIZED VIEWS FOR ANALYTICS
-- ============================================

-- Materialized View: Daily Room Statistics
CREATE MATERIALIZED VIEW IF NOT EXISTS mv_daily_room_stats AS
SELECT 
    room_id,
    DATE(joined_at) as activity_date,
    COUNT(DISTINCT user_id) as unique_users,
    COUNT(*) as total_sessions,
    AVG(duration_seconds) as avg_duration,
    SUM(duration_seconds) as total_duration
FROM sessions
WHERE joined_at >= CURRENT_DATE - INTERVAL '90 days'
GROUP BY room_id, DATE(joined_at);

CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_daily_room_stats ON mv_daily_room_stats(room_id, activity_date);

-- Materialized View: User Activity Summary
CREATE MATERIALIZED VIEW IF NOT EXISTS mv_user_activity_summary AS
SELECT 
    u.user_id,
    u.username,
    u.user_avatar,
    u.verification_status,
    u.followers_count,
    COUNT(DISTINCT s.room_id) as total_rooms_visited,
    COUNT(s.session_id) as total_sessions,
    SUM(s.duration_seconds) as total_time_seconds,
    AVG(s.duration_seconds) as avg_session_duration,
    MAX(s.joined_at) as last_active,
    MIN(s.joined_at) as first_seen
FROM users u
LEFT JOIN sessions s ON u.user_id = s.user_id
GROUP BY u.user_id, u.username, u.user_avatar, u.verification_status, u.followers_count;

CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_user_activity_summary ON mv_user_activity_summary(user_id);

-- ============================================
-- UTILITY FUNCTIONS
-- ============================================

-- Function: Refresh all materialized views
CREATE OR REPLACE FUNCTION refresh_all_materialized_views()
RETURNS void AS $$
BEGIN
    REFRESH MATERIALIZED VIEW CONCURRENTLY mv_daily_room_stats;
    REFRESH MATERIALIZED VIEW CONCURRENTLY mv_user_activity_summary;
END;
$$ LANGUAGE plpgsql;

-- Function: Clean old data (for maintenance)
CREATE OR REPLACE FUNCTION clean_old_data(p_days INTEGER DEFAULT 90)
RETURNS void AS $$
BEGIN
    -- Delete old profile views
    DELETE FROM profile_views
    WHERE viewed_at < NOW() - (p_days || ' days')::INTERVAL;

    -- Delete old activity logs
    DELETE FROM user_activity_log
    WHERE activity_time < NOW() - (p_days || ' days')::INTERVAL;

    -- Delete old snapshots
    DELETE FROM room_snapshots
    WHERE snapshot_time < NOW() - (p_days || ' days')::INTERVAL;
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- COMMENTS & DOCUMENTATION
-- ============================================

COMMENT ON TABLE users IS 'Stores all Free4Talk user information and social metrics';
COMMENT ON TABLE rooms IS 'Stores all room/group information including settings and creator details';
COMMENT ON TABLE sessions IS 'Tracks user participation in rooms with join/leave events and durations';
COMMENT ON TABLE profile_views IS 'Tracks profile views for the "Most Stalked Users" leaderboard';
COMMENT ON TABLE room_snapshots IS 'Periodic snapshots of room state for historical analysis';
COMMENT ON TABLE user_activity_log IS 'General purpose activity tracking with flexible JSON storage';
COMMENT ON TABLE room_analytics IS 'Aggregated daily statistics for each room';

COMMENT ON FUNCTION get_user_room_history IS 'Returns complete room participation history for a user';
COMMENT ON FUNCTION get_shared_rooms IS 'Finds rooms where two users have been together';
COMMENT ON FUNCTION get_room_timeline IS 'Returns chronological join/leave events for a room';
COMMENT ON FUNCTION get_most_stalked_users IS 'Leaderboard of most viewed profiles in last N days';
COMMENT ON FUNCTION get_room_active_users IS 'Returns currently active users in a room';
COMMENT ON FUNCTION search_users IS 'Fuzzy search for users by username';
COMMENT ON FUNCTION get_room_statistics IS 'Returns comprehensive statistics for a room';
COMMENT ON FUNCTION get_user_statistics IS 'Returns comprehensive statistics for a user';
COMMENT ON FUNCTION get_trending_rooms IS 'Returns most active rooms in recent hours';

-- ============================================
-- INITIAL DATA & SETUP
-- ============================================

-- Create a function to check schema health
CREATE OR REPLACE FUNCTION check_schema_health()
RETURNS TABLE (
    check_name VARCHAR,
    status VARCHAR,
    details VARCHAR
) AS $$
BEGIN
    RETURN QUERY
    SELECT 'Total Users'::VARCHAR, 'INFO'::VARCHAR, COUNT(*)::VARCHAR FROM users
    UNION ALL
    SELECT 'Total Rooms'::VARCHAR, 'INFO'::VARCHAR, COUNT(*)::VARCHAR FROM rooms
    UNION ALL
    SELECT 'Total Sessions'::VARCHAR, 'INFO'::VARCHAR, COUNT(*)::VARCHAR FROM sessions
    UNION ALL
    SELECT 'Active Sessions'::VARCHAR, 'INFO'::VARCHAR, COUNT(*)::VARCHAR FROM sessions WHERE is_currently_active = TRUE
    UNION ALL
    SELECT 'Profile Views (7d)'::VARCHAR, 'INFO'::VARCHAR, COUNT(*)::VARCHAR FROM profile_views WHERE viewed_at >= NOW() - INTERVAL '7 days';
END;
$$ LANGUAGE plpgsql;

-- ============================================
-- SCHEMA VERSION & METADATA
-- ============================================

CREATE TABLE IF NOT EXISTS schema_metadata (
    id SERIAL PRIMARY KEY,
    schema_version VARCHAR(20) DEFAULT '1.0.0',
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    description TEXT
);

INSERT INTO schema_metadata (schema_version, description)
VALUES ('1.0.0', 'Initial Free4Talk Tracker Schema - World-Class PostgreSQL Database')
ON CONFLICT DO NOTHING;

-- ============================================
-- END OF SCHEMA
-- ============================================

-- Success message
SELECT 
    '🎉 FREE4TALK TRACKER SCHEMA CREATED SUCCESSFULLY!' as message,
    (SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'public') as total_tables,
    (SELECT COUNT(*) FROM information_schema.routines WHERE routine_schema = 'public') as total_functions;
