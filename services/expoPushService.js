const { Expo } = require('expo-server-sdk');
const DeviceToken = require('../models/DeviceToken');

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
      
      console.log(`📤 Sending notification to user ${userId}: "${title}" - ${validTokens.length}/${tokens.length} valid device(s)`);
      
      // Check if Expo access token is set (important for production)
      if (!process.env.EXPO_ACCESS_TOKEN && process.env.NODE_ENV === 'production') {
        console.warn('⚠️ EXPO_ACCESS_TOKEN not set in production! This may cause notification delivery issues.');
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

      // Send notifications in chunks with retry mechanism
      const chunks = this.expo.chunkPushNotifications(messages);
      const tickets = [];
      let sentCount = 0;

      for (const chunk of chunks) {
        let retries = 2; // Reduced from 3 to 2 for faster failure
        let lastError = null;
        let attemptNumber = 0;
        
        while (retries > 0) {
          attemptNumber++;
          try {
            if (attemptNumber > 1) {
              console.log(`🔄 Attempt ${attemptNumber} to send push notification chunk...`);
            }
            const ticketChunk = await this.expo.sendPushNotificationsAsync(chunk);
            tickets.push(...ticketChunk);
            
            // Count successful sends and handle errors
            ticketChunk.forEach((ticket, index) => {
              if (ticket.status === 'ok') {
                sentCount++;
              } else {
                // Log error details for debugging
                const errorDetails = ticket.status === 'error' ? ticket.message : ticket.details;
                console.error(`❌ Error sending notification to token ${index}:`, {
                  status: ticket.status,
                  message: ticket.message || errorDetails,
                  details: ticket.details,
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
                      if (process.env.NODE_ENV === 'development') {
                        console.error('Error deactivating invalid token:', err);
                      }
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
            
            // Check if it's a DNS/network error that might be temporary
            const errorMessage = error.message || '';
            const errorCode = error.code || '';
            const errorErrno = error.errno || '';
            
            const isNetworkError = errorMessage.includes('getaddrinfo') || 
                                  errorMessage.includes('EAI_AGAIN') ||
                                  errorMessage.includes('ENOTFOUND') ||
                                  errorMessage.includes('ETIMEDOUT') ||
                                  errorMessage.includes('ECONNREFUSED') ||
                                  errorCode === 'EAI_AGAIN' ||
                                  errorCode === 'ENOTFOUND' ||
                                  errorCode === 'ETIMEDOUT' ||
                                  errorErrno === 'EAI_AGAIN' ||
                                  errorErrno === 'ENOTFOUND' ||
                                  errorErrno === 'ETIMEDOUT';
            
            if (isNetworkError && retries > 0) {
              // Wait before retry (faster retry: 1s, 2s instead of 2s, 4s, 8s)
              const waitTime = (3 - retries) * 1000; // 1s for first retry, 2s for second retry
              console.warn(`⚠️ DNS/Network error (${errorCode || errorErrno || 'unknown'}). Retrying push notification in ${waitTime/1000}s... (${3 - retries}/2)`);
              await new Promise(resolve => setTimeout(resolve, waitTime));
            } else {
              // Not a network error or no retries left
              console.error('❌ Error sending push notification chunk:', error);
              if (error.message || error.code || error.errno) {
                console.error('Error details:', {
                  message: errorMessage,
                  code: errorCode,
                  errno: errorErrno,
                  type: error.type || 'unknown'
                });
                
                // Provide helpful troubleshooting info for DNS errors
                if (isNetworkError) {
                  console.error('\n🔍 TROUBLESHOOTING DNS Error:');
                  console.error('1. Server tidak bisa resolve DNS untuk exp.host');
                  console.error('2. Cek DNS configuration di server');
                  console.error('3. Cek network connectivity dari server ke exp.host');
                  console.error('4. Mungkin perlu configure DNS server atau use different DNS resolver\n');
                }
              }
              break;
            }
          }
        }
        
        // If all retries failed, log the error (silently in production)
        if (lastError) {
          if (process.env.NODE_ENV === 'development') {
            console.error('Failed to send push notification chunk after 2 retries:', lastError);
          }
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
        // Log ticket details for debugging
        if (tickets.length > 0) {
          const errors = tickets.filter(t => t.status !== 'ok');
          if (errors.length > 0) {
            console.error('❌ Ticket errors:', errors.map(e => ({
              status: e.status,
              message: e.message,
              details: e.details
            })));
          }
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

