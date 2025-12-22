// parser.js - FIXED VERSION
const cheerio = require('cheerio');

/**
 * Parse the homepage HTML to extract users and rooms
 */
function parseHomepage(html) {
  const $ = cheerio.load(html);
  const users = [];
  const rooms = [];

  try {
    // Extract users from homepage
    $('.user-card, .profile-card, [data-username]').each((i, el) => {
      const $el = $(el);
      const username = $el.attr('data-username') || 
                      $el.find('[data-username]').attr('data-username') ||
                      $el.find('.username').text().trim();

      if (username) {
        users.push({
          username: username.replace('@', ''),
          displayName: $el.find('.display-name, .name').text().trim() || username,
          avatarUrl: $el.find('img').attr('src') || null,
          isOnline: $el.hasClass('online') || $el.find('.online-indicator').length > 0
        });
      }
    });

    // Extract rooms from homepage
    $('.room-card, [data-room-id]').each((i, el) => {
      const $el = $(el);
      const roomId = $el.attr('data-room-id') || $el.find('[data-room-id]').attr('data-room-id');
      const roomName = $el.find('.room-name, .room-title').text().trim();

      if (roomId || roomName) {
        const participants = [];
        $el.find('.participant, [data-username]').each((j, participant) => {
          const username = $(participant).attr('data-username');
          if (username) participants.push(username.replace('@', ''));
        });

        rooms.push({
          roomId: roomId || roomName,
          roomName: roomName || roomId,
          participantCount: parseInt($el.find('.participant-count').text()) || participants.length,
          participants: participants,
          language: $el.find('.language, [data-language]').text().trim() || null,
          topic: $el.find('.topic, .room-topic').text().trim() || null,
          isPublic: !$el.hasClass('private')
        });
      }
    });

    console.log(`📊 Parsed homepage: ${users.length} users, ${rooms.length} rooms`);
    return { users, rooms };

  } catch (error) {
    console.error('Error parsing homepage:', error);
    return { users: [], rooms: [] };
  }
}

/**
 * Parse a user profile page - FIXED VERSION
 */
function parseProfilePage(html, username) {
  const $ = cheerio.load(html);

  try {
    const profileSection = $('.profile-section, .user-profile, [data-profile]').first();

    if (!profileSection.length) {
      console.warn(`⚠️  No profile section found for ${username}`);
      return getDefaultUserData(username);
    }

    // FIXED: Get ALL stat elements, not just the first one
    const statElements = profileSection.find('.pr-7 span, .stat-value, .count').toArray();

    // Method 1: If we have exactly 3 elements in order
    let followerCount = '0';
    let followingCount = '0';
    let friendsCount = '0';

    if (statElements.length >= 3) {
      followerCount = $(statElements[0]).text().trim() || '0';
      followingCount = $(statElements[1]).text().trim() || '0';
      friendsCount = $(statElements[2]).text().trim() || '0';

      console.log(`📊 ${username}: ${followerCount} followers, ${followingCount} following, ${friendsCount} friends`);
    } else {
      // Method 2: Look for labeled stats (more robust)
      const statItems = profileSection.find('.stat-item, .profile-stat');

      statItems.each((i, item) => {
        const $item = $(item);
        const text = $item.text().toLowerCase();
        const value = $item.find('span, .count, .value').text().trim() || '0';

        if (text.includes('follower')) {
          followerCount = value;
        } else if (text.includes('following')) {
          followingCount = value;
        } else if (text.includes('friend')) {
          friendsCount = value;
        }
      });
    }

    // Validate - if all are identical and not 0, something might be wrong
    if (followerCount === followingCount && 
        followingCount === friendsCount && 
        followerCount !== '0') {
      console.warn(`⚠️  Suspicious: ${username} has identical counts (${followerCount})`);
    }

    // Extract other profile data
    const displayName = profileSection.find('.display-name, .profile-name, h1, h2').first().text().trim() || username;
    const avatarUrl = profileSection.find('img.avatar, .profile-avatar img, .profile-picture').attr('src') || null;
    const bio = profileSection.find('.bio, .about, .description').text().trim() || null;

    // Gender
    const genderText = profileSection.find('.gender, [data-gender]').text().trim().toLowerCase();
    const gender = genderText.includes('male') ? 'male' : 
                   genderText.includes('female') ? 'female' : 
                   genderText.includes('other') ? 'other' : null;

    // Languages
    const languages = [];
    profileSection.find('.language, .lang, [data-language]').each((i, el) => {
      const lang = $(el).text().trim();
      if (lang && !languages.includes(lang)) {
        languages.push(lang);
      }
    });

    // Interests
    const interests = [];
    profileSection.find('.interest, .tag, .hobby').each((i, el) => {
      const interest = $(el).text().trim();
      if (interest && !interests.includes(interest)) {
        interests.push(interest);
      }
    });

    // Rooms - get from profile
    const rooms = [];
    $('.room-card, .user-room').each((i, el) => {
      const $room = $(el);
      const roomName = $room.find('.room-name, .title').text().trim();
      const roomId = $room.attr('data-room-id') || roomName;

      if (roomName) {
        rooms.push({
          roomId: roomId,
          roomName: roomName,
          language: $room.find('.language').text().trim() || null,
          participantCount: parseInt($room.find('.participant-count').text()) || 0
        });
      }
    });

    return {
      username: username,
      displayName: displayName,
      avatarUrl: avatarUrl,
      bio: bio,
      followerCount: parseInt(followerCount.replace(/,/g, '')) || 0,
      followingCount: parseInt(followingCount.replace(/,/g, '')) || 0,
      friendsCount: parseInt(friendsCount.replace(/,/g, '')) || 0,
      gender: gender,
      languages: languages,
      interests: interests,
      rooms: rooms
    };

  } catch (error) {
    console.error(`Error parsing profile for ${username}:`, error.message);
    return getDefaultUserData(username);
  }
}

/**
 * Parse a followers/following list page
 */
function parseRelationshipList(html, username, type) {
  const $ = cheerio.load(html);
  const users = [];

  try {
    $('.user-card, .follower-item, .following-item, [data-username]').each((i, el) => {
      const $el = $(el);
      const relatedUsername = $el.attr('data-username') || 
                             $el.find('[data-username]').attr('data-username') ||
                             $el.find('.username').text().trim().replace('@', '');

      if (relatedUsername && relatedUsername !== username) {
        users.push({
          username: relatedUsername,
          displayName: $el.find('.display-name, .name').text().trim() || relatedUsername,
          avatarUrl: $el.find('img').attr('src') || null
        });
      }
    });

    console.log(`📊 Found ${users.length} ${type} for ${username}`);
    return users;

  } catch (error) {
    console.error(`Error parsing ${type} for ${username}:`, error);
    return [];
  }
}

/**
 * Parse room details page
 */
function parseRoomDetails(html, roomId) {
  const $ = cheerio.load(html);

  try {
    const roomSection = $('.room-details, .room-info').first();

    const roomName = roomSection.find('.room-name, h1').text().trim();
    const topic = roomSection.find('.topic, .description').text().trim() || null;
    const language = roomSection.find('.language, [data-language]').text().trim() || null;
    const isPublic = !roomSection.hasClass('private');

    // Get participants
    const participants = [];
    $('.participant, .member, [data-username]').each((i, el) => {
      const $el = $(el);
      const username = $el.attr('data-username') || $el.find('.username').text().trim().replace('@', '');
      const role = $el.attr('data-role') || 
                   ($el.hasClass('owner') ? 'owner' : 
                    $el.hasClass('speaker') ? 'speaker' : 'listener');

      if (username) {
        participants.push({
          username: username,
          role: role,
          displayName: $el.find('.display-name, .name').text().trim() || username
        });
      }
    });

    return {
      roomId: roomId,
      roomName: roomName,
      topic: topic,
      language: language,
      isPublic: isPublic,
      participantCount: participants.length,
      participants: participants
    };

  } catch (error) {
    console.error(`Error parsing room ${roomId}:`, error);
    return null;
  }
}

/**
 * Helper: Get default user data
 */
function getDefaultUserData(username) {
  return {
    username: username,
    displayName: username,
    avatarUrl: null,
    bio: null,
    followerCount: 0,
    followingCount: 0,
    friendsCount: 0,
    gender: null,
    languages: [],
    interests: [],
    rooms: []
  };
}

module.exports = {
  parseHomepage,
  parseProfilePage,
  parseRelationshipList,
  parseRoomDetails
};