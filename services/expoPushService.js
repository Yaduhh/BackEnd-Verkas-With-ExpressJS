const { Expo } = require('expo-server-sdk');
const DeviceToken = require('../models/DeviceToken');

class ExpoPushService {
  constructor() {
    // Create Expo client
    // Access token is optional, but recommended for production
    this.expo = new Expo({
      accessToken: process.env.EXPO_ACCESS_TOKEN, // Optional, untuk production
    });
  }

  // Validate if token is valid Expo push token
  isValidToken(token) {
    return Expo.isExpoPushToken(token);
  }

  // Send notification to single user
  async sendToUser(userId, { title, body, data = {}, sound = 'default', priority = 'default' }) {
    try {
      // Get all active device tokens for user
      const tokens = await DeviceToken.findActiveByUserId(userId);
      
      if (tokens.length === 0) {
        console.log(`No device tokens found for user ${userId}`);
        return { success: false, message: 'No device tokens', sent: 0 };
      }

      // Filter valid Expo tokens
      const validTokens = tokens
        .map(t => t.device_token)
        .filter(token => this.isValidToken(token));

      if (validTokens.length === 0) {
        console.log(`No valid Expo push tokens found for user ${userId}`);
        return { success: false, message: 'No valid tokens', sent: 0 };
      }

      // Prepare messages
      const messages = validTokens.map(token => ({
        to: token,
        sound,
        title,
        body,
        priority,
        data: {
          ...data,
          userId,
          timestamp: new Date().toISOString(),
        },
      }));

      // Send notifications in chunks
      const chunks = this.expo.chunkPushNotifications(messages);
      const tickets = [];
      let sentCount = 0;

      for (const chunk of chunks) {
        try {
          const ticketChunk = await this.expo.sendPushNotificationsAsync(chunk);
          tickets.push(...ticketChunk);
          
          // Count successful sends
          ticketChunk.forEach(ticket => {
            if (ticket.status === 'ok') {
              sentCount++;
            } else {
              console.error('Error sending notification:', ticket);
            }
          });
        } catch (error) {
          console.error('Error sending push notification chunk:', error);
        }
      }

      // Update last_used_at for tokens that were used
      const usedTokenIds = tokens
        .filter(t => validTokens.includes(t.device_token))
        .map(t => t.id);
      
      if (usedTokenIds.length > 0) {
        await DeviceToken.updateLastUsed(usedTokenIds);
      }

      return { 
        success: true, 
        sent: sentCount,
        total: validTokens.length,
        tickets 
      };
    } catch (error) {
      console.error('Error in sendToUser:', error);
      return { success: false, error: error.message, sent: 0 };
    }
  }

  // Send notification to multiple users
  async sendToUsers(userIds, { title, body, data = {}, sound = 'default', priority = 'default' }) {
    const results = await Promise.all(
      userIds.map(userId => 
        this.sendToUser(userId, { title, body, data, sound, priority })
      )
    );
    
    const totalSent = results.reduce((sum, r) => sum + (r.sent || 0), 0);
    
    return { 
      success: true, 
      sent: totalSent,
      results 
    };
  }

  // Send notification to branch owner
  async sendToBranchOwner(branchId, { title, body, data = {}, sound = 'default', priority = 'default' }) {
    try {
      const Branch = require('../models/Branch');
      const branch = await Branch.findById(branchId);
      
      if (!branch) {
        return { success: false, message: 'Branch not found', sent: 0 };
      }

      return await this.sendToUser(branch.owner_id, { title, body, data, sound, priority });
    } catch (error) {
      console.error('Error in sendToBranchOwner:', error);
      return { success: false, error: error.message, sent: 0 };
    }
  }

  // Send test notification
  async sendTest(userId, { title = 'Test Notification', body = 'This is a test notification', data = {} }) {
    return await this.sendToUser(userId, { title, body, data, sound: 'default' });
  }
}

module.exports = new ExpoPushService();

