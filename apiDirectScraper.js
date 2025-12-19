const axios = require('axios');

class Free4TalkAPI {
  constructor() {
    this.baseURL = 'https://sync.free4talk.com/sync/get/free4talk';
  }

  async fetchGroups() {
    const timestamp = Date.now();
    const url = `${this.baseURL}/groups/?a=sync-get-free4talk-groups&v=553-4&t=${timestamp}`;
    
    console.log('📡 Fetching from API...');
    
    try {
      const response = await axios.get(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36',
          'Referer': 'https://free4talk.com/'
        }
      });
      
      console.log(`✅ Got ${response.data.length} groups`);
      return response.data;
      
    } catch (error) {
      console.error('❌ Error:', error.message);
      throw error;
    }
  }

  parseGroups(groupsData) {
    const groups = [];
    const userIds = new Set();

    groupsData.forEach(group => {
      const parsed = {
        groupId: group.groupId || group._id,
        topic: group.topic || 'Unknown',
        language: group.language || 'Unknown',
        level: group.level || 'Unknown',
        clients: []
      };

      if (group.clients) {
        group.clients.forEach(client => {
          if (client.id) userIds.add(client.id);
          
          parsed.clients.push({
            id: client.id,
            username: client.username || 'Anonymous',
            followers: client.followers || 0
          });
        });
      }

      groups.push(parsed);
    });

    return { groups, userIds: Array.from(userIds) };
  }
}

module.exports = Free4TalkAPI;
