// tracker.js - FIXED VERSION
const { parseProfilePage, parseRelationshipList, parseRoomDetails } = require('./parser');

class Free4TalkTracker {
  constructor(page, db) {
    this.page = page;
    this.db = db;
    this.trackedUsers = new Set();
    this.trackedRooms = new Set();
  }

  /**
   * FIXED: Actually visit user profile page and scrape data
   */
  async trackUserProfile(username, deep = false) {
    try {
      // Skip if recently tracked
      if (this.trackedUsers.has(username)) {
        return null;
      }

      console.log(`\n👤 Tracking user: ${username}${deep ? ' (deep)' : ''}`);

      // Navigate to user profile
      const profileUrl = `https://free4talk.com/profile/${username}`;
      await this.page.goto(profileUrl, { 
        waitUntil: 'networkidle2',
        timeout: 30000 
      });

      // Wait for profile to load
      await this.page.waitForSelector('.profile-section, .user-profile, body', { timeout: 5000 });

      // Small delay for dynamic content
      await this.sleep(1000);

      // Get full HTML
      const html = await this.page.content();

      // Parse profile data
      const userData = parseProfilePage(html, username);

      // Validate data
      if (userData.followerCount === 0 && 
          userData.followingCount === 0 && 
          userData.friendsCount === 0) {
        console.warn(`⚠️  ${username} has all zero counts - possible parsing error`);
      }

      // Store in database
      const user = await this.db.upsertUser(userData);
      this.trackedUsers.add(username);

      console.log(`✅ Tracked ${username}: ${userData.followerCount} followers, ${userData.followingCount} following, ${userData.friendsCount} friends`);

      // If deep tracking, also scrape relationships
      if (deep && (userData.followerCount > 0 || userData.followingCount > 0 || userData.friendsCount > 0)) {
        await this.sleep(2000);
        await this.trackUserRelationships(username, userData);
      }

      // Track rooms from profile
      if (userData.rooms && userData.rooms.length > 0) {
        console.log(`📍 Found ${userData.rooms.length} rooms for ${username}`);
        for (const room of userData.rooms) {
          await this.trackRoom(room.roomId, room);
        }
      }

      return user;

    } catch (error) {
      if (error.message.includes('net::ERR_NAME_NOT_RESOLVED') || 
          error.message.includes('Navigation timeout')) {
        console.error(`❌ Profile not found or timeout: ${username}`);
      } else {
        console.error(`❌ Error tracking ${username}:`, error.message);
      }
      return null;
    }
  }

  /**
   * NEW: Track user's followers, following, and friends
   */
  async trackUserRelationships(username, userData) {
    try {
      console.log(`🔗 Tracking relationships for ${username}...`);

      // Track followers
      if (userData.followerCount > 0) {
        const followers = await this.scrapeRelationshipList(username, 'followers');
        if (followers.length > 0) {
          // Ensure all followers exist as users
          for (const follower of followers) {
            await this.db.upsertUser({
              username: follower.username,
              displayName: follower.displayName,
              avatarUrl: follower.avatarUrl,
              followerCount: 0,
              followingCount: 0,
              friendsCount: 0
            });
          }

          // Add relationships
          const followerUsernames = followers.map(f => f.username);
          await this.db.bulkInsertRelationships(username, followerUsernames, 'follower');
        }
      }

      // Track following
      if (userData.followingCount > 0) {
        await this.sleep(2000);
        const following = await this.scrapeRelationshipList(username, 'following');
        if (following.length > 0) {
          // Ensure all followed users exist
          for (const followed of following) {
            await this.db.upsertUser({
              username: followed.username,
              displayName: followed.displayName,
              avatarUrl: followed.avatarUrl,
              followerCount: 0,
              followingCount: 0,
              friendsCount: 0
            });
          }

          // Add relationships
          const followingUsernames = following.map(f => f.username);
          await this.db.bulkInsertRelationships(username, followingUsernames, 'following');
        }
      }

      // Track friends
      if (userData.friendsCount > 0) {
        await this.sleep(2000);
        const friends = await this.scrapeRelationshipList(username, 'friends');
        if (friends.length > 0) {
          // Ensure all friends exist as users
          for (const friend of friends) {
            await this.db.upsertUser({
              username: friend.username,
              displayName: friend.displayName,
              avatarUrl: friend.avatarUrl,
              followerCount: 0,
              followingCount: 0,
              friendsCount: 0
            });
          }

          // Add relationships (bidirectional for friends)
          const friendUsernames = friends.map(f => f.username);
          await this.db.bulkInsertRelationships(username, friendUsernames, 'friend');
        }
      }

      console.log(`✅ Completed relationship tracking for ${username}`);

    } catch (error) {
      console.error(`Error tracking relationships for ${username}:`, error.message);
    }
  }

  /**
   * NEW: Scrape a relationship list (followers/following/friends)
   */
  async scrapeRelationshipList(username, type) {
    try {
      const url = `https://free4talk.com/profile/${username}/${type}`;
      console.log(`  📋 Scraping ${type} from ${url}`);

      await this.page.goto(url, { 
        waitUntil: 'networkidle2',
        timeout: 30000 
      });

      await this.sleep(1000);

      // Get HTML
      const html = await this.page.content();

      // Parse relationship list
      const users = parseRelationshipList(html, username, type);

      console.log(`  ✅ Found ${users.length} ${type}`);
      return users;

    } catch (error) {
      console.error(`  ❌ Error scraping ${type}:`, error.message);
      return [];
    }
  }

  /**
   * Track a room and its participants
   */
  async trackRoom(roomId, roomData = null) {
    try {
      // Skip if recently tracked
      if (this.trackedRooms.has(roomId)) {
        return null;
      }

      console.log(`\n🏠 Tracking room: ${roomId}`);

      // If we don't have room data, scrape it
      if (!roomData) {
        const roomUrl = `https://free4talk.com/room/${roomId}`;
        await this.page.goto(roomUrl, { 
          waitUntil: 'networkidle2',
          timeout: 30000 
        });

        await this.sleep(1000);
        const html = await this.page.content();
        roomData = parseRoomDetails(html, roomId);
      }

      if (!roomData) {
        console.warn(`⚠️  Could not get data for room ${roomId}`);
        return null;
      }

      // Store room
      const room = await this.db.upsertRoom({
        roomId: roomId,
        roomName: roomData.roomName,
        topic: roomData.topic,
        language: roomData.language,
        isPublic: roomData.isPublic,
        participantCount: roomData.participantCount || roomData.participants?.length || 0,
        createdBy: roomData.createdBy || null
      });

      this.trackedRooms.add(roomId);

      // Track participants
      if (roomData.participants && roomData.participants.length > 0) {
        console.log(`  👥 Found ${roomData.participants.length} participants`);

        // Ensure all participants exist as users
        for (const participant of roomData.participants) {
          await this.db.upsertUser({
            username: participant.username,
            displayName: participant.displayName,
            avatarUrl: null,
            followerCount: 0,
            followingCount: 0,
            friendsCount: 0
          });
        }

        // Add to room_participants table
        await this.db.bulkAddRoomParticipants(roomId, roomData.participants);
      }

      console.log(`✅ Tracked room: ${roomData.roomName}`);
      return room;

    } catch (error) {
      console.error(`❌ Error tracking room ${roomId}:`, error.message);
      return null;
    }
  }

  /**
   * NEW: Discover users from rooms on homepage
   */
  async discoverUsersFromRooms() {
    try {
      console.log('\n🔍 Discovering users from rooms...');

      // Get all room cards from current page
      const rooms = await this.page.evaluate(() => {
        const roomElements = document.querySelectorAll('.room-card, [data-room-id]');
        return Array.from(roomElements).map(room => {
          const roomId = room.getAttribute('data-room-id') || 
                        room.querySelector('[data-room-id]')?.getAttribute('data-room-id');
          const roomName = room.querySelector('.room-name, .room-title')?.textContent?.trim();

          const participants = [];
          room.querySelectorAll('.participant, [data-username]').forEach(p => {
            const username = p.getAttribute('data-username')?.replace('@', '');
            const role = p.getAttribute('data-role') || 'listener';
            if (username) {
              participants.push({ username, role });
            }
          });

          return {
            roomId: roomId || roomName,
            roomName: roomName || roomId,
            participants: participants
          };
        }).filter(r => r.roomId);
      });

      console.log(`📊 Found ${rooms.length} rooms on page`);

      // Track all rooms and their participants
      const discoveredUsers = new Set();

      for (const room of rooms) {
        await this.trackRoom(room.roomId, room);

        // Add participants to discovered users
        if (room.participants) {
          room.participants.forEach(p => discoveredUsers.add(p.username));
        }
      }

      console.log(`✅ Discovered ${discoveredUsers.size} users from rooms`);
      return Array.from(discoveredUsers);

    } catch (error) {
      console.error('❌ Error discovering users from rooms:', error.message);
      return [];
    }
  }

  /**
   * Track a session (user joining/leaving room)
   */
  async trackSession(username, roomId, action = 'join') {
    try {
      const sessionData = {
        username: username,
        roomId: roomId,
        joinedAt: action === 'join' ? new Date() : null,
        leftAt: action === 'leave' ? new Date() : null
      };

      await this.db.upsertSession(sessionData);

    } catch (error) {
      console.error('Error tracking session:', error.message);
    }
  }

  /**
   * Helper: Sleep for ms
   */
  async sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Reset tracked sets (for new iteration)
   */
  resetTracking() {
    this.trackedUsers.clear();
    this.trackedRooms.clear();
    console.log('🔄 Reset tracking sets');
  }
}

module.exports = Free4TalkTracker;