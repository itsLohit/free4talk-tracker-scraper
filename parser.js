const cheerio = require('cheerio');

/**
 * Normalize skill level to match database constraints
 */
function normalizeSkillLevel(level) {
  const mapping = {
    'beginner': 'Beginner',
    'intermediate': 'Intermediate',
    'upper intermediate': 'Advanced',
    'advanced': 'Advanced',
    'upper advanced': 'Upper Advanced',
    'any level': 'Any Level',
    'all levels': 'Any Level',
  };

  const normalized = level?.toLowerCase().trim();
  return mapping[normalized] || 'Any Level';
}

/**
 * Parse the Free4Talk DOM and extract all room data
 */
function parseRooms(html) {
  const $ = cheerio.load(html);
  const rooms = [];

  // Debug: Check how many room elements exist
  const allGroupItems = $('.group-item').length;
  const realGroupItems = $('.group-item:not(.fake)').length;
  console.log(`🔍 Parser found: ${allGroupItems} total group-items, ${realGroupItems} real rooms`);

  // Find all room cards
  $('.group-item').each((index, element) => {
    try {
      const $room = $(element);
      
      // Skip fake/template rooms
      if ($room.hasClass('fake')) {
        return;
      }
      const roomIdCheck = $room.find('[id^="group-"]').first().attr('id');
      if (roomIdCheck && roomIdCheck.includes('fake')) {
        return;
      }

      // ROBUST room_id extraction - try multiple methods
      let room_id = null;
      
      // Method 1: Find child div with id starting with "group-"
      const groupDiv = $room.find('[id^="group-"]').first();
      if (groupDiv.length > 0) {
        const idAttr = groupDiv.attr('id');
        const match = idAttr?.match(/group-(.+)/);
        if (match) {
          room_id = match[1];
        }
      }
      
      // Method 2: Check if the .group-item itself has an id
      if (!room_id) {
        const parentId = $room.attr('id');
        if (parentId && parentId.startsWith('group-')) {
          room_id = parentId.replace('group-', '');
        }
      }
      
      // Method 3: Look for data attributes
      if (!room_id) {
        room_id = $room.attr('data-room-id') || $room.attr('data-id');
      }
      
      // Method 4: Generate from index as fallback
      if (!room_id) {
        console.log(`⚠️  No room_id found for room ${index}, generating fallback`);
        room_id = `unknown-room-${index}-${Date.now()}`;
      }

      // Extract language
      const language = $room.find('.sc-kvZOFW').text().trim() || 
                      $room.find('[class*="language"]').text().trim() || 
                      'Unknown';

      // Extract skill level
      const rawSkillLevel = $room.find('.sc-hqyNC').text().trim() || 
                           $room.find('[class*="level"]').text().trim() || 
                           'Any Level';
      const skill_level = normalizeSkillLevel(rawSkillLevel);

      // Extract topic
      const topic = $room.find('.sc-jbKcbu .notranslate').text().trim() || 
                   $room.find('[class*="topic"]').text().trim() || 
                   'Anything';

      // Extract participants
      const participants = [];
      $room.find('.client-item').each((i, clientEl) => {
        const $client = $(clientEl);
        
        // Skip empty slots
        const isEmptySlot = $client.find('.blind').text().includes('Empty Slot') || 
                           $client.find('button[disabled]').length > 0;
        if (isEmptySlot) {
          return;
        }

        // Get username
        let username = $client.find('button[aria-label]').attr('aria-label');
        if (!username || username === 'Empty Slot' || username === '') {
          return;
        }

        // Extract follower count
        const followerText = $client.find('.followers-btn').text().trim();
        const followerMatch = followerText.match(/(\d+)/);
        const followers_count = followerMatch ? parseInt(followerMatch[1]) : 0;

        // Extract avatar
        let user_avatar = null;
        const imgElement = $client.find('img[alt="avatar"]');
        if (imgElement.length > 0) {
          user_avatar = imgElement.attr('src');
        } else {
          const svgText = $client.find('svg text').first().text().trim();
          user_avatar = svgText ? `SVG:${svgText}` : null;
        }

        // Check verification
        const allSvgText = $client.find('svg text').text();
        const verification_status = allSvgText.includes('VERIFIED') ? 'VERIFIED' : 'UNVERIFIED';

        // Generate consistent user_id
        const user_id = username.toLowerCase().replace(/[^a-z0-9]/g, '-');

        participants.push({
          user_id,
          username,
          user_avatar,
          followers_count,
          verification_status,
          position: i + 1,
        });
      });

      // Determine room status
      const is_full = $room.find('.btn-stop').length > 0;
      const is_empty = participants.length === 0;
      const is_active = true; // Assume active if it's in the list

      // Extract capacity
      const capacityAttr = $room.find('.client-item').parent().attr('class');
      const capacityMatch = capacityAttr?.match(/length(\d+)/);
      const max_capacity = capacityMatch ? parseInt(capacityMatch[1]) : -1;

      // Add room to list
      rooms.push({
        room_id,
        language,
        skill_level,
        topic,
        max_capacity,
        current_users: participants.length,
        is_active,
        is_full,
        is_empty,
        allows_unlimited: max_capacity === -1,
        mic_allowed: true,
        mic_required: false,
        participants,
      });

      // Log successful parse
      console.log(`   ✅ Parsed room ${room_id}: ${language} (${participants.length} users)`);

    } catch (error) {
      console.error(`   ❌ Error parsing room ${index}:`, error.message);
    }
  });

  console.log(`\n✨ Successfully parsed ${rooms.length} rooms`);
  return rooms;
}

/**
 * Parse language statistics from the page
 */
function parseLanguageStats(html) {
  const $ = cheerio.load(html);
  const stats = {};

  $('.lang-tag').each((index, element) => {
    const $tag = $(element);
    const text = $tag.text().trim();
    const match = text.match(/(.+)\s+(\d+)/);
    
    if (match) {
      const language = match[1].trim();
      const count = parseInt(match[2]);
      stats[language] = count;
    }
  });

  return stats;
}

module.exports = {
  parseRooms,
  parseLanguageStats,
};
