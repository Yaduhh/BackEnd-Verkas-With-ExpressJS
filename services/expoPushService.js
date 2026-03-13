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
      // Get all stored tokens
      const tokens = await DeviceToken.findByUserId(userId);

      // Filter active expo tokens
      const expoTokens = tokens
        .filter(t => t.is_active === 1 && Expo.isExpoPushToken(t.device_token))
        .map(t => t.device_token);

      if (expoTokens.length === 0) {
        return { success: false, message: 'No valid tokens found', sent: 0 };
      }

      // Create message objects
      const messages = expoTokens.map(token => ({
        to: token,
        sound: sound || 'default',
        title: title,
        body: body,
        priority: priority === 'high' ? 'high' : 'default',
        channelId: 'verkas-notif-v2',
        data: { ...data, userId },
      }));

      // Send in chunks
      const chunks = expo.chunkPushNotifications(messages);
      const tickets = [];
      let sentCount = 0;

      for (let chunk of chunks) {
        try {
          const ticketChunk = await expo.sendPushNotificationsAsync(chunk);
          tickets.push(...ticketChunk);
          sentCount += ticketChunk.filter(t => t.status === 'ok').length;
        } catch (error) {
          console.error('❌ [BACKEND] Expo push error:', error.message);
          throw error;
        }
      }

      // Update last used in background
      const usedTokenIds = tokens.filter(t => expoTokens.includes(t.device_token)).map(t => t.id);
      if (usedTokenIds.length > 0) {
        DeviceToken.updateLastUsed(usedTokenIds).catch(() => { });
      }

      return {
        success: sentCount > 0,
        sent: sentCount,
        total: expoTokens.length,
        tickets
      };

    } catch (error) {
      console.error('❌ [BACKEND] Fatal error in sendToUser:', error.message);
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

  chunkTokens(tokens) {
    const chunkSize = 100;
    const chunks = [];
    for (let i = 0; i < tokens.length; i += chunkSize) {
      chunks.push(tokens.slice(i, i + chunkSize));
    }
    return chunks;
  }

  async sendMulticast(tokens, { title, body, data = {}, sound = 'default', priority = 'high' }) {
    if (tokens.length === 0) return { success: true, sent: 0 };

    const messages = tokens.map(token => {
      // Mendukung gambar rich notification untuk Android via direct channel Expo (opsional untuk iOS)
      const messageObj = {
        to: token,
        sound: sound || 'default',
        title: title,
        body: body,
        priority: priority === 'high' ? 'high' : 'default',
        channelId: 'verkas-notif-v2',
        data: data,
      };

      if (data.image_url) {
        messageObj.categoryId = 'verkas-image-notif';
        messageObj.attachments = [
          {
            url: data.image_url
          }
        ];
      }

      return messageObj;
    });

    const chunks = expo.chunkPushNotifications(messages);
    const tickets = [];
    let sentCount = 0;

    for (let chunk of chunks) {
      try {
        const ticketChunk = await expo.sendPushNotificationsAsync(chunk);
        tickets.push(...ticketChunk);
        sentCount += ticketChunk.filter(t => t.status === 'ok').length;
      } catch (error) {
        console.error('❌ [BACKEND] Expo push multicast error:', error.message);
      }
    }

    return { success: true, sent: sentCount, tickets };
  }
}

module.exports = new ExpoPushService();
