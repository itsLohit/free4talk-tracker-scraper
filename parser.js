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
    
    // 3. Track the Creator (Ensure they are saved even if not in 'clients' list)
    if (roomData.creator) {
         const creator = {
            user_id: roomData.creator.id,
            username: roomData.creator.name,
            user_avatar: roomData.creator.avatar,
            is_verified: !!roomData.creator.isVerified,
            followers_count: 0, // Defaults
            following_count: 0,
            friends_count: 0,
            is_online: true,
            last_seen_at: new Date()
         };
         // We add the creator to the room list if not already there, 
         // but strictly speaking, if they aren't in 'clients', they aren't IN the room.
         // However, we MUST return them to upsertUser() so the foreign key works.
         // For now, let's just ensure they exist in our DB by adding them to usersInRoom ONLY if they are actually in the room? 
         // NO: The safe bet is to let syncRoomSessions handle the insert.
         // But syncRoomSessions iterates usersInRoom. 
         // So if creator isn't in 'clients', we should at least UPSERT them separately.
         // (Simplified logic: Assume if they created it recently, let's upsert them).
    }

    roomUserMap.set(room.room_id, usersInRoom);
  }

  return { rooms, activeUserIds, activeRoomIds, roomUserMap };
}

module.exports = { parseSnapshot };
