const { Expo } = require('expo-server-sdk');
const DeviceToken = require('../models/DeviceToken');
const { promisify } = require('util');

class ExpoPushService {
  constructor() {
    // Create Expo client
    // Access token is optional, but recommended for production
    const accessToken = process.env.EXPO_ACCESS_TOKEN;

    if (!accessToken && process.env.NODE_ENV === 'production') {
      console.warn('⚠️ WARNING: EXPO_ACCESS_TOKEN not set in production environment!');
      console.warn('⚠️ Push notifications may fail or be rate-limited without access token.');
      console.warn('⚠️ Get your access token from: https://expo.dev/accounts/[your-account]/settings/access-tokens');
    }

    this.expo = new Expo({
      accessToken: accessToken, // Optional, tapi recommended untuk production
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
        console.log(`📱 No device tokens found for user ${userId}`);
        return { success: false, message: 'No device tokens', sent: 0 };
      }

      // Filter valid Expo tokens
      const validTokens = tokens
        .map(t => t.device_token)
        .filter(token => {
          const isValid = this.isValidToken(token);
          if (!isValid) {
            console.warn(`⚠️ Invalid Expo token format for user ${userId}: ${token?.substring(0, 30)}...`);
          }
          return isValid;
        });

      if (validTokens.length === 0) {
        console.warn(`📱 No valid Expo push tokens found for user ${userId} (${tokens.length} total tokens, all invalid)`);
        return { success: false, message: 'No valid tokens', sent: 0 };
      }

      console.log('═══════════════════════════════════════════════════════════');
      console.log(`📤 [BACKEND] 📤 EXPO SERVICE: Sending notification to user ${userId}`);
      console.log(`📊 [BACKEND] Title: "${title}"`);
      console.log(`📊 [BACKEND] Valid tokens: ${validTokens.length}/${tokens.length}`);
      console.log(`📊 [BACKEND] Service: Expo Push Notification Service (exp.host)`);
      console.log(`📊 [BACKEND] Token format: ExponentPushToken[...]`);
      console.log('═══════════════════════════════════════════════════════════');

      // Check if Expo access token is set (important for production)
      if (!process.env.EXPO_ACCESS_TOKEN) {
        if (process.env.NODE_ENV === 'production') {
          console.warn('⚠️ [BACKEND] EXPO_ACCESS_TOKEN not set in production! This may cause notification delivery issues.');
        } else {
          console.log('ℹ️ [BACKEND] EXPO_ACCESS_TOKEN not set (optional for development)');
        }
      } else {
        console.log('✅ [BACKEND] EXPO_ACCESS_TOKEN is set');
      }

      // Prepare messages
      const messages = validTokens.map(token => ({
        to: token,
        sound,
        title,
        body,
        priority,
        channelId: 'verkas-notif-v1', // CRITICAL for Android foreground display
        data: {
          ...data,
          userId,
          timestamp: new Date().toISOString(),
        },
      }));

      console.log(`📦 [BACKEND] Prepared ${messages.length} notification message(s)`);

      // Send notifications in chunks with retry mechanism
      // Expo SDK automatically chunks to max 100 messages per chunk
      const chunks = this.expo.chunkPushNotifications(messages);
      console.log(`📦 [BACKEND] Split into ${chunks.length} chunk(s) (max 100 per chunk)`);
      const tickets = [];
      let sentCount = 0;

      for (const chunk of chunks) {
        let retries = 3; // Increased to 3 retries for DNS issues
        let lastError = null;
        let attemptNumber = 0;

        while (retries > 0) {
          attemptNumber++;
          try {
            if (attemptNumber > 1) {
              console.log(`🔄 Attempt ${attemptNumber} to send push notification chunk...`);

              // Test DNS resolution before retry
              if (attemptNumber === 2) {
                const dnsOk = await this.testDNSResolution('exp.host');
                if (!dnsOk) {
                  console.warn('⚠️ DNS resolution still failing, will retry with longer wait...');
                }
              }
            }

            console.log(`📤 [BACKEND] Sending chunk ${chunks.indexOf(chunk) + 1}/${chunks.length} with ${chunk.length} notification(s)...`);
            const ticketChunk = await this.expo.sendPushNotificationsAsync(chunk);
            console.log(`📥 [BACKEND] Received ${ticketChunk.length} ticket(s) from Expo API`);
            tickets.push(...ticketChunk);

            // Count successful sends and handle errors
            ticketChunk.forEach((ticket, index) => {
              if (ticket.status === 'ok') {
                sentCount++;
                console.log(`✅ [BACKEND] Ticket ${index + 1}: OK (ID: ${ticket.id || 'N/A'})`);
              } else {
                // Log error details for debugging
                const errorDetails = ticket.status === 'error' ? ticket.message : ticket.details;
                console.error(`❌ [BACKEND] Ticket ${index + 1} ERROR:`, {
                  status: ticket.status,
                  message: ticket.message || errorDetails,
                  details: ticket.details,
                  error: ticket.details?.error,
                  errorCode: ticket.details?.errorCode,
                  token: chunk[index]?.to ? chunk[index].to.substring(0, 30) + '...' : 'unknown'
                });

                // If token is invalid, deactivate it
                if (ticket.details?.error === 'DeviceNotRegistered' ||
                  ticket.details?.error === 'InvalidCredentials' ||
                  ticket.message?.includes('DeviceNotRegistered') ||
                  ticket.message?.includes('InvalidCredentials')) {
                  // Find and deactivate invalid token
                  const invalidToken = chunk[index]?.to;
                  if (invalidToken) {
                    DeviceToken.unregisterByToken(invalidToken).catch(err => {
                      console.error('Error deactivating invalid token:', err);
                    });
                  }
                }
              }
            });

            // Success, break retry loop
            lastError = null;
            break;
          } catch (error) {
            lastError = error;
            retries--;

            if (retries > 0) {
              const waitTime = Math.min(2000 * Math.pow(2, 3 - retries - 1), 10000);
              console.warn(`⚠️ Network error. Retrying push notification in ${waitTime / 1000}s...`);
              await new Promise(resolve => setTimeout(resolve, waitTime));
            } else {
              console.error('❌ Error sending push notification chunk:', error.message);
              break;
            }
          }
        }

        // If all retries failed, log the error
        if (lastError) {
          console.error('❌ Failed to send push notification chunk after 3 retries:', {
            error: lastError.message,
            code: lastError.code,
            errno: lastError.errno
          });
        }
      }

      // Update last_used_at for tokens that were used
      const usedTokenIds = tokens
        .filter(t => validTokens.includes(t.device_token))
        .map(t => t.id);

      if (usedTokenIds.length > 0) {
        await DeviceToken.updateLastUsed(usedTokenIds);
      }

      if (sentCount > 0) {
        console.log(`✅ Notification sent to user ${userId}: ${sentCount}/${validTokens.length} device(s) successful`);
      } else {
        console.warn(`⚠️ Notification failed for user ${userId}: 0/${validTokens.length} device(s) successful`);
        // Log ticket details for debugging - CRITICAL for production debugging
        if (tickets.length > 0) {
          const errors = tickets.filter(t => t.status !== 'ok');
          if (errors.length > 0) {
            console.error('❌ CRITICAL: Ticket errors (production debugging):', errors.map((e, idx) => ({
              index: idx,
              status: e.status,
              message: e.message,
              details: e.details,
              error: e.details?.error,
              errorCode: e.details?.errorCode,
              tokenPreview: validTokens[idx]?.substring(0, 30) + '...'
            })));

            // Check for common production issues
            const deviceNotRegistered = errors.filter(e =>
              e.details?.error === 'DeviceNotRegistered' ||
              e.message?.includes('DeviceNotRegistered')
            );
            const invalidCredentials = errors.filter(e =>
              e.details?.error === 'InvalidCredentials' ||
              e.message?.includes('InvalidCredentials')
            );
            const messageTooBig = errors.filter(e =>
              e.details?.error === 'MessageTooBig' ||
              e.message?.includes('MessageTooBig')
            );

            if (deviceNotRegistered.length > 0) {
              console.error('🔴 PRODUCTION ISSUE: DeviceNotRegistered - Token mungkin expired atau app di-uninstall');
            }
            if (invalidCredentials.length > 0) {
              console.error('🔴 PRODUCTION ISSUE: InvalidCredentials - Cek EXPO_ACCESS_TOKEN atau Firebase credentials');
            }
            if (messageTooBig.length > 0) {
              console.error('🔴 PRODUCTION ISSUE: MessageTooBig - Notifikasi terlalu besar (>4KB)');
            }
          } else {
            console.error('❌ CRITICAL: All tickets returned but none successful. Check ticket status:', tickets);
          }
        } else {
          console.error('❌ CRITICAL: No tickets returned from Expo API');
        }
      }

      return {
        success: sentCount > 0,
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

