const admin = require('firebase-admin');
const DeviceToken = require('../models/DeviceToken');

class FCMService {
  constructor() {
    this.initialized = false;

    // Initialize Firebase Admin SDK
    if (!admin.apps.length) {
      try {
        console.log('🚀 Starting Firebase Admin SDK initialization...');

        // Try to load from environment variable first
        if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
          console.log('🔑 Using credentials from GOOGLE_APPLICATION_CREDENTIALS');
          admin.initializeApp({
            credential: admin.credential.applicationDefault()
          });
          this.initialized = true;
          console.log('✅ Firebase Admin SDK initialized from environment');
        } else {
          // Fallback to local file
          console.log('📄 Using local service account file');

          // Use the specific file mentioned by user (verkas-c342f-f4f33dad77c1.json)
          // Look in root directory (..) since we are in services/
          const path = require('path');
          const serviceAccountFileName = 'verkas-c342f-f4f33dad77c1.json';
          const serviceAccountPath = path.resolve(__dirname, '..', serviceAccountFileName);

          console.log(`📂 Attempting to load service account from: ${serviceAccountPath}`);

          if (require('fs').existsSync(serviceAccountPath)) {
            const serviceAccount = require(serviceAccountPath);
            console.log('📋 Service account loaded, project_id:', serviceAccount.project_id);

            admin.initializeApp({
              credential: admin.credential.cert(serviceAccount),
              projectId: serviceAccount.project_id
            });
            this.initialized = true;
            console.log('✅ Firebase Admin SDK initialized from local file');
          } else {
            // Check fallback to firebase-service-account.json
            const fallbackPath = path.resolve(__dirname, '..', 'firebase-service-account.json');
            if (require('fs').existsSync(fallbackPath)) {
              const serviceAccount = require(fallbackPath);
              admin.initializeApp({
                credential: admin.credential.cert(serviceAccount),
                projectId: serviceAccount.project_id
              });
              this.initialized = true;
              console.log('✅ Firebase Admin SDK initialized from fallback local file');
            } else {
              throw new Error(`Service account file not found at ${serviceAccountPath} or ${fallbackPath}`);
            }
          }
        }

        if (this.initialized) {
          const app = admin.app();
          console.log('🔥 Firebase app name:', app.name);
          console.log('🔥 Firebase project ID:', app.options.projectId);
        }
      } catch (error) {
        console.error('❌ Failed to initialize Firebase Admin SDK:', error.message);
        console.error('Make sure GOOGLE_APPLICATION_CREDENTIALS is set or service account JSON exists in root');
        this.initialized = false;
      }
    } else {
      this.initialized = true;
    }

    // Rate limiting for notifications (prevent spam)
    this.notificationRateLimit = new Map();
    this.RATE_LIMIT_WINDOW = 5000; // 5 seconds
    this.MAX_NOTIFICATIONS_PER_WINDOW = 1;
  }

  // Validate if token is valid FCM token
  isValidToken(token) {
    if (!token || typeof token !== 'string') {
      return false;
    }

    // FCM tokens are typically long strings (152+ characters)
    // They don't have a specific prefix like Expo tokens
    // But they should NOT start with "ExponentPushToken" or "ExpoPushToken"
    if (token.startsWith('ExponentPushToken[') || token.startsWith('ExpoPushToken[')) {
      return false; // This is an Expo token, not FCM
    }

    // FCM tokens are usually longer and don't have brackets
    return token.length > 50 && !token.includes('[') && !token.includes(']');
  }

  // Convert all data values to strings (FCM requirement)
  // FCM data payload must only contain string values
  convertDataToStrings(data) {
    if (!data || typeof data !== 'object') {
      return {};
    }

    const stringData = {};
    for (const [key, value] of Object.entries(data)) {
      if (value === null || value === undefined) {
        stringData[key] = '';
      } else if (typeof value === 'string') {
        stringData[key] = value;
      } else if (typeof value === 'object') {
        // Convert objects/arrays to JSON string
        stringData[key] = JSON.stringify(value);
      } else {
        // Convert numbers, booleans, etc. to string
        stringData[key] = String(value);
      }
    }

    return stringData;
  }

  async sendToUser(userId, { title, body, data = {}, sound = 'default', priority = 'high' }) {
    // Check if FCM is initialized
    if (!this.initialized) {
      throw new Error('FCM service not initialized. Please ensure Firebase Admin SDK is initialized correctly.');
    }

    // Rate limiting check
    const now = Date.now();
    const userLimit = this.notificationRateLimit.get(userId) || { count: 0, lastTime: 0 };

    if (now - userLimit.lastTime < this.RATE_LIMIT_WINDOW) {
      if (userLimit.count >= this.MAX_NOTIFICATIONS_PER_WINDOW) {
        console.warn(`🛑 [FCM] Rate limit exceeded for user ${userId}. Skipping notification: "${title}"`);
        return { success: false, message: 'Rate limit exceeded', sent: 0 };
      }
      userLimit.count++;
    } else {
      userLimit.count = 1;
      userLimit.lastTime = now;
    }

    // Update rate limit map
    this.notificationRateLimit.set(userId, userLimit);

    // Periodically cleanup the rate limit map (if it gets too large)
    if (this.notificationRateLimit.size > 1000) {
      for (const [key, value] of this.notificationRateLimit.entries()) {
        if (now - value.lastTime > this.RATE_LIMIT_WINDOW) {
          this.notificationRateLimit.delete(key);
        }
      }
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

      console.log('═══════════════════════════════════════════════════════════');
      console.log(`📤 [BACKEND] 📤 FCM SERVICE: Sending notification to user ${userId}`);
      console.log(`📊 [BACKEND] Title: "${title}"`);
      console.log(`📊 [BACKEND] Valid tokens: ${validTokens.length}/${tokens.length}`);
      console.log(`📊 [BACKEND] Service: Firebase Cloud Messaging (FCM)`);
      console.log(`📊 [BACKEND] Token format: Direct FCM token (no Expo wrapper)`);
      console.log('═══════════════════════════════════════════════════════════');

      // Prepare FCM message
      // Convert all data values to strings (FCM requirement)
      const stringData = this.convertDataToStrings({
        ...data,
        userId: userId.toString(),
        timestamp: new Date().toISOString(),
      });

      const message = {
        notification: {
          title,
          body,
        },
        data: stringData,
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

      // Send to all tokens with retry mechanism for network errors
      let results;
      let lastError;
      const maxRetries = 3;

      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
          results = await admin.messaging().sendEachForMulticast({
            tokens: validTokens,
            ...message,
          });
          break; // Success, exit retry loop
        } catch (error) {
          lastError = error;
          if (attempt < maxRetries) {
            const waitTime = Math.min(2000 * Math.pow(2, attempt - 1), 10000);
            console.warn(`⚠️ Network error during FCM send. Retrying in ${waitTime / 1000}s... (${attempt}/${maxRetries})`);
            await new Promise(resolve => setTimeout(resolve, waitTime));
            continue; // Retry
          } else {
            throw error;
          }
        }
      }

      if (!results) {
        throw lastError || new Error('Failed to send FCM notification after retries');
      }

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

      // Convert all data values to strings (FCM requirement)
      const stringData = this.convertDataToStrings({
        ...data,
        timestamp: new Date().toISOString(),
      });

      const message = {
        token,
        notification: {
          title,
          body,
        },
        data: stringData,
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

