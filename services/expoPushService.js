const { Expo } = require('expo-server-sdk');
const DeviceToken = require('../models/DeviceToken');
const dns = require('dns');

// Force Node.js to prefer IPv4. Node 17+ defaults to IPv6 first, which causes EAI_AGAIN on many VPS setups.
if (dns.setDefaultResultOrder) {
  dns.setDefaultResultOrder('ipv4first');
}

class ExpoPushService {
  constructor() {
    this.expo = new Expo({ accessToken: process.env.EXPO_ACCESS_TOKEN });
  }

  // Check if a string is a valid Expo push token
  isValidToken(token) {
    return Expo.isExpoPushToken(token);
  }

  // Debug DNS connectivity
  async testDNSResolution(host) {
    try {
      const dns = require('dns').promises;
      const addresses = await dns.resolve4(host);
      console.log(`📡 [BACKEND] DNS Resolution for ${host} OK: ${addresses.join(', ')}`);
      return true;
    } catch (err) {
      console.error(`❌ [BACKEND] DNS Resolution for ${host} FAILED:`, err.message);
      return false;
    }
  }

  // Send notification to a single user
  async sendToUser(userId, { title, body, data = {}, sound = 'default', priority = 'high' }) {
    try {
      // Find all active tokens for the user
      const tokens = await DeviceToken.findByUserId(userId);
      const validTokens = tokens
        .filter(t => t.status === 'active' && Expo.isExpoPushToken(t.device_token))
        .map(t => t.device_token);

      console.log('═══════════════════════════════════════════════════════════');
      console.log(`� [BACKEND] � SENDING NOTIFICATION TO USER: ${userId}`);
      console.log('═══════════════════════════════════════════════════════════');
      console.log(`📊 [BACKEND] Found ${tokens.length} device token(s) for user ${userId}`);
      console.log(`📊 [BACKEND] Valid Expo tokens: ${validTokens.length}`);

      if (validTokens.length === 0) {
        console.warn(`⚠️ [BACKEND] No valid Expo push tokens found for user ${userId}`);
        return { success: false, message: 'No valid tokens found', sent: 0 };
      }

      // Test DNS before starting
      await this.testDNSResolution('exp.host');

      // Create message objects
      const messages = validTokens.map(token => ({
        to: token,
        sound,
        title,
        body,
        priority: priority === 'high' ? 'high' : 'default',
        channelId: 'verkas-notif-v1', // REQUIRED for Android foreground
        data: {
          ...data,
          userId,
          timestamp: new Date().toISOString(),
        },
      }));

      // Send in chunks
      const chunks = this.expo.chunkPushNotifications(messages);
      const tickets = [];
      let sentCount = 0;

      for (const [chunkIndex, chunk] of chunks.entries()) {
        let retries = 5;
        let lastError = null;

        while (retries > 0) {
          try {
            console.log(`📡 Sending chunk ${chunkIndex + 1}/${chunks.length} with ${chunk.length} notification(s)...`);

            const chunkTickets = await this.expo.sendPushNotificationsAsync(chunk);
            tickets.push(...chunkTickets);
            sentCount += chunkTickets.filter(t => t.status === 'ok').length;

            // Handle ticket errors
            chunkTickets.forEach((ticket, index) => {
              if (ticket.status !== 'ok') {
                console.warn(`⚠️ Ticket Error (Token ${index}):`, ticket.message);
                if (ticket.details?.error === 'DeviceNotRegistered') {
                  const invalidToken = chunk[index]?.to;
                  if (invalidToken) {
                    DeviceToken.unregisterByToken(invalidToken).catch(e => console.error('Unregister error:', e));
                  }
                }
              }
            });

            lastError = null;
            break;
          } catch (error) {
            lastError = error;
            retries--;
            const isDnsError = error.code === 'EAI_AGAIN' || error.message?.includes('getaddrinfo');

            if (retries > 0) {
              const waitTime = isDnsError ? 3000 : Math.min(2000 * Math.pow(2, 5 - retries - 1), 10000);
              console.warn(`⚠️ ${isDnsError ? 'DNS' : 'Network'} error (${error.code || 'ERR'}). Retrying in ${waitTime / 1000}s... (Left: ${retries})`);
              await new Promise(r => setTimeout(r, waitTime));

              // If DNS failed, test it again before retrying
              if (isDnsError) await this.testDNSResolution('exp.host');
            } else {
              console.error(`❌ Final Error (${error.code || 'ERR'}):`, error.message);
              break;
            }
          }
        }
      }

      // Update token last used
      const usedTokenIds = tokens.filter(t => validTokens.includes(t.device_token)).map(t => t.id);
      if (usedTokenIds.length > 0) {
        await DeviceToken.updateLastUsed(usedTokenIds);
      }

      console.log(`✅ Notification cycle complete. Sent: ${sentCount}/${validTokens.length}`);
      return { success: sentCount > 0, sent: sentCount, total: validTokens.length, tickets };

    } catch (error) {
      console.error('❌ FATAL ERROR in sendToUser:', error);
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
