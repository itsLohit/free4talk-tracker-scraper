/**
 * Standardizes skill levels so your DB analytics work correctly.
 */
function normalizeSkillLevel(level) {
    if (!level) return 'Any Level';
    const lower = level.toLowerCase().trim();
    if (lower.includes('beginner')) return 'Beginner';
    if (lower.includes('upper intermediate')) return 'Advanced'; // Map to closest
    if (lower.includes('intermediate')) return 'Intermediate';
    if (lower.includes('advanced')) return 'Advanced';
    return 'Any Level';
}

function parseSnapshot(data) {
  const rooms = [];
  
  // Safety check
  if (!data || !data.data) {
      return { rooms, activeRoomIds: new Set() };
  }

  try {
      for (const roomId in data.data) {
        const r = data.data[roomId];
        
        // 1. Map Room Data
        const room = {
          room_id: String(r.id),
          creator_id: String(r.userId),
          topic: (r.topic || "No Topic").substring(0, 499), // Truncate to fit DB
          language: r.language || "Unknown",
          skill_level: normalizeSkillLevel(r.level),
          max_capacity: r.maxPeople || 0,
          room_url: r.url || "",
          
          // Fix: Handle different settings formats
          mic_allowed: r.settings ? !r.settings.noMic : true,
          is_locked: r.settings ? !!r.settings.isLocked : false,
          
          created_at: r.createdAt ? new Date(r.createdAt) : new Date(),
          is_active: true,
          
          // 2. Map Users
          users: (r.clients || []).map(client => ({
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
  } catch (error) {
      console.error("Error inside parser:", error);
  }

  return { 
      rooms, 
      activeRoomIds: new Set(rooms.map(r => r.room_id)) 
  };
}

module.exports = { parseSnapshot };
