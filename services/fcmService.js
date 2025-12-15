const admin = require('firebase-admin');
const DeviceToken = require('../models/DeviceToken');

class FCMService {
  constructor() {
    this.initialized = false;
    
    // Initialize Firebase Admin SDK
    if (!admin.apps.length) {
      // Check if we have service account credentials
      const serviceAccountPath = process.env.FCM_SERVICE_ACCOUNT_PATH;
      const serviceAccountKey = process.env.FCM_SERVICE_ACCOUNT_KEY;
      
      if (serviceAccountPath) {
        // Use service account file
        try {
          // Use path.resolve untuk handle relative paths
          const path = require('path');
          const fs = require('fs');
          const resolvedPath = path.resolve(process.cwd(), serviceAccountPath);
          
          // Check if file exists
          if (!fs.existsSync(resolvedPath)) {
            console.warn('⚠️ WARNING: FCM service account file not found:', resolvedPath);
            console.warn('⚠️ FCM notifications will be disabled. Set FCM_SERVICE_ACCOUNT_PATH in .env');
            return;
          }
          
          const serviceAccount = require(resolvedPath);
          admin.initializeApp({
            credential: admin.credential.cert(serviceAccount),
          });
          this.initialized = true;
          console.log('✅ Firebase Admin SDK initialized from service account file');
        } catch (error) {
          console.warn('⚠️ WARNING: Error initializing Firebase Admin SDK from file:', error.message);
          console.warn('⚠️ FCM notifications will be disabled. Check FCM_SERVICE_ACCOUNT_PATH in .env');
          // Don't throw error, just disable FCM
          return;
        }
      } else if (serviceAccountKey) {
        // Use service account JSON string from env
        try {
          const serviceAccount = JSON.parse(serviceAccountKey);
          admin.initializeApp({
            credential: admin.credential.cert(serviceAccount),
          });
          this.initialized = true;
          console.log('✅ Firebase Admin SDK initialized from environment variable');
        } catch (error) {
          console.warn('⚠️ WARNING: Error parsing FCM_SERVICE_ACCOUNT_KEY:', error.message);
          console.warn('⚠️ FCM notifications will be disabled. Check FCM_SERVICE_ACCOUNT_KEY in .env');
          // Don't throw error, just disable FCM
          return;
        }
      } else {
        console.warn('⚠️ WARNING: FCM credentials not found!');
        console.warn('⚠️ Set FCM_SERVICE_ACCOUNT_PATH or FCM_SERVICE_ACCOUNT_KEY in .env to enable FCM');
        console.warn('⚠️ Backend will fallback to Expo Push Notification Service');
      }
    } else {
      // Firebase already initialized (maybe by another service)
      this.initialized = true;
      console.log('✅ Firebase Admin SDK already initialized');
    }
  }

  // Validate if token is valid FCM token
  isValidToken(token) {
    // FCM tokens are typically long strings (152+ characters)
    // They don't have a specific prefix like Expo tokens
    return token && typeof token === 'string' && token.length > 50;
  }

  // Send notification to single user
  async sendToUser(userId, { title, body, data = {}, sound = 'default', priority = 'high' }) {
    // Check if FCM is initialized
    if (!this.initialized) {
      throw new Error('FCM service not initialized. Set FCM_SERVICE_ACCOUNT_PATH or FCM_SERVICE_ACCOUNT_KEY in .env');
    }
    
    try {
      // Get all active device tokens for user
      const tokens = await DeviceToken.findActiveByUserId(userId);
      
      if (tokens.length === 0) {
        console.log(`📱 No device tokens found for user ${userId}`);
        return { success: false, message: 'No device tokens', sent: 0 };
      }

      // Filter valid FCM tokens
      const validTokens = tokens
        .map(t => t.device_token)
        .filter(token => {
          const isValid = this.isValidToken(token);
          if (!isValid) {
            console.warn(`⚠️ Invalid FCM token format for user ${userId}: ${token?.substring(0, 30)}...`);
          }
          return isValid;
        });

      if (validTokens.length === 0) {
        console.warn(`📱 No valid FCM tokens found for user ${userId} (${tokens.length} total tokens, all invalid)`);
        return { success: false, message: 'No valid tokens', sent: 0 };
      }
      
      console.log(`📤 Sending FCM notification to user ${userId}: "${title}" - ${validTokens.length}/${tokens.length} valid device(s)`);

      // Prepare FCM message
      const message = {
        notification: {
          title,
          body,
        },
        data: {
          ...data,
          userId: userId.toString(),
          timestamp: new Date().toISOString(),
        },
        android: {
          priority: priority === 'high' ? 'high' : 'normal',
          notification: {
            sound: sound === 'default' ? 'default' : sound,
            channelId: 'default', // Must match channel ID in app
          },
        },
        apns: {
          payload: {
            aps: {
              sound: sound === 'default' ? 'default.aiff' : sound,
            },
          },
        },
      };

      // Send to all tokens
      const results = await admin.messaging().sendEachForMulticast({
        tokens: validTokens,
        ...message,
      });

      // Count successful sends
      let sentCount = 0;
      const failedTokens = [];

      results.responses.forEach((response, index) => {
        if (response.success) {
          sentCount++;
        } else {
          const token = validTokens[index];
          console.error(`❌ Failed to send to token ${index}:`, response.error);
          
          // Handle invalid tokens
          if (response.error?.code === 'messaging/invalid-registration-token' ||
              response.error?.code === 'messaging/registration-token-not-registered') {
            failedTokens.push(token);
            // Deactivate invalid token
            DeviceToken.unregisterByToken(token).catch(err => {
              console.error('Error deactivating invalid token:', err);
            });
          }
        }
      });

      console.log(`✅ FCM notification sent: ${sentCount}/${validTokens.length} successful`);

      return {
        success: sentCount > 0,
        message: sentCount > 0 ? `Sent to ${sentCount} device(s)` : 'Failed to send',
        sent: sentCount,
        failed: validTokens.length - sentCount,
        failedTokens,
      };
    } catch (error) {
      console.error('❌ Error sending FCM notification:', error);
      return {
        success: false,
        message: error.message || 'Failed to send notification',
        sent: 0,
      };
    }
  }

  // Send notification to multiple users
  async sendToUsers(userIds, { title, body, data = {}, sound = 'default', priority = 'high' }) {
    const results = await Promise.all(
      userIds.map(userId => this.sendToUser(userId, { title, body, data, sound, priority }))
    );

    const totalSent = results.reduce((sum, r) => sum + (r.sent || 0), 0);
    const totalFailed = results.reduce((sum, r) => sum + (r.failed || 0), 0);

    return {
      success: totalSent > 0,
      message: `Sent to ${totalSent} device(s), ${totalFailed} failed`,
      sent: totalSent,
      failed: totalFailed,
      results,
    };
  }

  // Send notification to specific token
  async sendToToken(token, { title, body, data = {}, sound = 'default', priority = 'high' }) {
    // Check if FCM is initialized
    if (!this.initialized) {
      throw new Error('FCM service not initialized. Set FCM_SERVICE_ACCOUNT_PATH or FCM_SERVICE_ACCOUNT_KEY in .env');
    }
    
    try {
      if (!this.isValidToken(token)) {
        return { success: false, message: 'Invalid token format' };
      }

      const message = {
        token,
        notification: {
          title,
          body,
        },
        data: {
          ...data,
          timestamp: new Date().toISOString(),
        },
        android: {
          priority: priority === 'high' ? 'high' : 'normal',
          notification: {
            sound: sound === 'default' ? 'default' : sound,
            channelId: 'default',
          },
        },
        apns: {
          payload: {
            aps: {
              sound: sound === 'default' ? 'default.aiff' : sound,
            },
          },
        },
      };

      const response = await admin.messaging().send(message);
      console.log(`✅ FCM notification sent successfully: ${response}`);

      return {
        success: true,
        message: 'Notification sent successfully',
        messageId: response,
      };
    } catch (error) {
      console.error('❌ Error sending FCM notification to token:', error);
      
      // Handle invalid token
      if (error.code === 'messaging/invalid-registration-token' ||
          error.code === 'messaging/registration-token-not-registered') {
        DeviceToken.unregisterByToken(token).catch(err => {
          console.error('Error deactivating invalid token:', err);
        });
      }

      return {
        success: false,
        message: error.message || 'Failed to send notification',
      };
    }
  }
}

module.exports = new FCMService();

