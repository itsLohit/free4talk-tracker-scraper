/**
 * Maps Free4Talk's raw skill levels to your clean DB constraints.
 */
function normalizeSkillLevel(level) {
    if (!level) return 'Any Level';
    
    // Map from your old code
    const skillMap = {
        'beginner': 'Beginner',
        'upper beginner': 'Beginner',
        'intermediate': 'Intermediate',
        'upper intermediate': 'Intermediate',
        'advanced': 'Advanced',
        'upper advanced': 'Advanced',
        'any level': 'Any Level'
    };

    const lower = level.toLowerCase().trim();
    return skillMap[lower] || 'Any Level';
}

/**
 * Parses the raw API object (which is a Map of ID -> Group)
 */
function parseSnapshot(apiData) {
  const rooms = [];
  
  // apiData is an OBJECT, not an array. We must iterate its keys.
  // Example: { "123": { topic: "Hi", ... }, "456": { ... } }
  for (const [id, group] of Object.entries(apiData)) {
    
    // 1. Map Room
    const room = {
      room_id: String(group.id),
      creator_id: String(group.userId), // Note: Verify if API sends 'userId' or just 'creator'
      topic: (group.topic || "").substring(0, 499),
      language: group.language || "Unknown",
      skill_level: normalizeSkillLevel(group.level),
      max_capacity: group.maxPeople || 0,
      room_url: group.url || "",
      
      // Settings usually come in group.settings
      mic_allowed: group.settings ? !group.settings.noMic : true,
      is_locked: group.settings ? !!group.settings.isLocked : false,
      
      created_at: group.createdAt ? new Date(group.createdAt) : new Date(),
      is_active: true,
      
      // 2. Map Users (Clients)
      users: (group.clients || []).map(client => ({
          user_id: String(client.id),
          username: client.name || "Unknown",
          user_avatar: client.avatar || "",
          is_verified: !!client.isVerified,
          followers_count: Number(client.followers) || 0,
          following_count: Number(client.following) || 0,
          friends_count: Number(client.friends) || 0,
          is_online: true,
          last_seen_at: new Date()
      }))
    };

    rooms.push(room);
  }

  return { rooms };
}

module.exports = { parseSnapshot };
