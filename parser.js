// parser.js
function parseSnapshot(data) {
  const rooms = [];
  const activeUserIds = new Set();
  const activeRoomIds = new Set();
  const roomUserMap = new Map(); // Map room_id -> array of user objects

  if (!data || !data.data) return { rooms, activeUserIds, activeRoomIds, roomUserMap };

  // Loop through each room in the 'data' object
  for (const roomId in data.data) {
    const roomData = data.data[roomId];
    
    // 1. Extract Room Details
    // We map API fields to our DB columns here
    const room = {
      room_id: roomData.id,
      creator_id: roomData.userId, // Links to the creator
      topic: roomData.topic || "",
      language: roomData.language || "Unknown",
      skill_level: roomData.level || "Any",
      max_capacity: roomData.maxPeople || 0,
      room_url: roomData.url || "",
      
      // Settings logic
      mic_allowed: !roomData.settings?.noMic, // Flip 'noMic' to 'mic_allowed'
      is_locked: !!roomData.settings?.isLocked, // '!!' forces boolean
      
      // Timestamps
      created_at: roomData.createdAt ? new Date(roomData.createdAt) : new Date(),
      is_active: true
    };

    activeRoomIds.add(room.room_id);
    rooms.push(room);

    // 2. Extract Users (Clients in the room)
    const usersInRoom = [];
    if (roomData.clients && Array.isArray(roomData.clients)) {
      roomData.clients.forEach(client => {
        const user = {
          user_id: client.id,
          username: client.name || "Unknown",
          user_avatar: client.avatar || "",
          is_verified: !!client.isVerified,
          
          // Social Stats (CRITICAL UPDATE)
          followers_count: client.followers || 0,
          following_count: client.following || 0,
          friends_count: client.friends || 0,
          
          is_online: true,
          last_seen_at: new Date()
        };
        
        activeUserIds.add(user.user_id);
        usersInRoom.push(user);
      });
    }
    
    // Also track the creator (sometimes they aren't in 'clients' list but we need their profile)
    if (roomData.creator) {
         const creator = {
            user_id: roomData.creator.id,
            username: roomData.creator.name,
            user_avatar: roomData.creator.avatar,
            is_verified: !!roomData.creator.isVerified,
            // Creator object in room summary often lacks follower counts, 
            // so we default to 0 to avoid breaking INSERTs if they aren't in 'clients'
            followers_count: 0, 
            following_count: 0,
            friends_count: 0,
            is_online: true, // If they just made a room, they are likely online
            last_seen_at: new Date()
         };
         // We only add creator if not already in the active list to avoid duplicates
         if (!activeUserIds.has(creator.user_id)) {
             // activeUserIds.add(creator.user_id); // Optional: don't force them as "active" in a room if they left
             // But we might want to UPSERT them just to save their profile info
         }
    }

    roomUserMap.set(room.room_id, usersInRoom);
  }

  return { rooms, activeUserIds, activeRoomIds, roomUserMap };
}

module.exports = { parseSnapshot };
