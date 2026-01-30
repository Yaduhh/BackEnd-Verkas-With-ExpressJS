const { Expo } = require('expo-server-sdk');
const DeviceToken = require('../models/DeviceToken');

// Create a new Expo SDK client (Empty config to match your working project)
const expo = new Expo();

class ExpoPushService {
  // Check if a string is a valid Expo push token
  isValidToken(token) {
    return Expo.isExpoPushToken(token);
  }

  // Send notification to a single user
  async sendToUser(userId, { title, body, data = {}, sound = 'default', priority = 'high' }) {
    try {
      // Get active tokens for the user
      // Match your table schema: is_active = 1
      const tokens = await DeviceToken.findByUserId(userId);
      const expoTokens = tokens
        .filter(t => t.is_active === 1 && Expo.isExpoPushToken(t.device_token))
        .map(t => t.device_token);

      console.log('═══════════════════════════════════════════════════════════');
      console.log(`📬 [BACKEND] SENDING TO USER: ${userId}`);
      console.log(`📊 [BACKEND] Tokens found: ${tokens.length}, Valid: ${expoTokens.length}`);
      console.log('═══════════════════════════════════════════════════════════');

      if (expoTokens.length === 0) {
        return { success: false, message: 'No valid tokens', sent: 0 };
      }

      // Create messages (Match your other project structure)
      const messages = expoTokens.map(token => ({
        to: token,
        sound: sound || 'default',
        title: title,
        body: body,
        priority: priority === 'high' ? 'high' : 'default',
        data: { ...data, userId },
      }));

      // Chunk and send (Match your other project loop)
      const chunks = expo.chunkPushNotifications(messages);
      const tickets = [];
      let sentCount = 0;

      for (let chunk of chunks) {
        try {
          console.log(`� Sending chunk with ${chunk.length} messages...`);
          const ticketChunk = await expo.sendPushNotificationsAsync(chunk);
          console.log('📨 Received tickets:', ticketChunk);
          tickets.push(...ticketChunk);
          sentCount += ticketChunk.filter(t => t.status === 'ok').length;
        } catch (error) {
          console.error('❌ Error sending chunk:', error);
          // Keep the error for top level if all fail
          throw error;
        }
      }

      // Update last used (optional but good)
      const usedTokenIds = tokens.filter(t => expoTokens.includes(t.device_token)).map(t => t.id);
      if (usedTokenIds.length > 0) {
        DeviceToken.updateLastUsed(usedTokenIds).catch(e => console.error('Update last used error:', e));
      }

      return {
        success: sentCount > 0,
        sent: sentCount,
        total: expoTokens.length,
        tickets
      };

    } catch (error) {
      console.error('❌ Fatal error in sendToUser:', error.message);
      return { success: false, error: error.message, sent: 0 };
    }
  }

  async sendToUsers(userIds, options) {
    const results = await Promise.all(userIds.map(id => this.sendToUser(id, options)));
    return { success: true, sent: results.reduce((sum, r) => sum + (r.sent || 0), 0), results };
  }

  async sendToBranchOwner(branchId, options) {
    const Branch = require('../models/Branch');
    const branch = await Branch.findById(branchId);
    return branch ? await this.sendToUser(branch.owner_id, options) : { success: false, message: 'Branch not found' };
  }

  async sendTest(userId, options = {}) {
    return await this.sendToUser(userId, { title: 'Test', body: 'This is a test', ...options });
  }
}

module.exports = new ExpoPushService();
