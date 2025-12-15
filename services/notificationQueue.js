const expoPushService = require('./expoPushService');
const fcmService = require('./fcmService');

/**
 * Simple in-memory notification queue
 * Processes notifications in background without blocking requests
 */
class NotificationQueue {
  constructor() {
    this.queue = [];
    this.processing = false;
    this.maxRetries = 3;
    this.batchSize = 10; // Process 10 notifications at a time
  }

  /**
   * Add notification to queue (non-blocking)
   * @param {Object} job - Notification job
   * @param {number|number[]} job.userId - User ID(s) to send to
   * @param {string} job.title - Notification title
   * @param {string} job.body - Notification body
   * @param {Object} job.data - Notification data
   * @param {string} job.sound - Notification sound
   * @param {string} job.priority - Notification priority
   */
  enqueue({ userId, title, body, data = {}, sound = 'default', priority = 'default' }) {
    const job = {
      userId,
      title,
      body,
      data,
      sound,
      priority,
      attempts: 0,
      createdAt: Date.now()
    };

    this.queue.push(job);
    
    // Start processing if not already running
    if (!this.processing) {
      this.process();
    }

    // Log in development
    if (process.env.NODE_ENV === 'development') {
      console.log(`📬 Notification queued: "${title}" for user(s) ${Array.isArray(userId) ? userId.join(', ') : userId}`);
    }
  }

  /**
   * Process queue in background
   */
  async process() {
    if (this.processing || this.queue.length === 0) {
      return;
    }

    this.processing = true;

    try {
      // Process in batches
      while (this.queue.length > 0) {
        const batch = this.queue.splice(0, this.batchSize);
        
        // Process batch concurrently (but don't wait for all to complete)
        batch.forEach(job => {
          // Use setImmediate to make it truly non-blocking
          setImmediate(async () => {
            await this.processJob(job);
          });
        });

        // Small delay between batches to avoid overwhelming the system
        if (this.queue.length > 0) {
          await new Promise(resolve => setTimeout(resolve, 100));
        }
      }
    } finally {
      this.processing = false;
      
      // If more items were added while processing, process again
      if (this.queue.length > 0) {
        setImmediate(() => this.process());
      }
    }
  }

  /**
   * Process a single notification job
   */
  async processJob(job) {
    try {
      job.attempts++;

      let result;
      
      if (Array.isArray(job.userId)) {
        // Multiple users - Check token format first, then use appropriate service
        result = await this.sendToUsersWithAutoDetect(job.userId, {
          title: job.title,
          body: job.body,
          data: job.data,
          sound: job.sound,
          priority: job.priority
        });

        if (result.sent > 0) {
          console.log(`✅ Queued notification sent: "${job.title}" to ${result.sent} device(s)`);
        } else if (process.env.NODE_ENV === 'development') {
          console.warn(`⚠️ Queued notification failed: "${job.title}" - ${result.message || 'No devices'}`);
        }
      } else {
        // Single user - Check token format first, then use appropriate service
        result = await this.sendToUserWithAutoDetect(job.userId, {
          title: job.title,
          body: job.body,
          data: job.data,
          sound: job.sound,
          priority: job.priority
        });

        if (result.sent > 0) {
          console.log(`✅ Queued notification sent: "${job.title}" to user ${job.userId} (${result.sent} device(s))`);
        } else if (process.env.NODE_ENV === 'development') {
          console.warn(`⚠️ Queued notification failed: "${job.title}" to user ${job.userId} - ${result.message || 'No devices'}`);
        }
      }
    } catch (error) {
      // Retry if attempts < maxRetries
      if (job.attempts < this.maxRetries) {
        console.warn(`⚠️ Notification job failed (attempt ${job.attempts}/${this.maxRetries}), retrying...`, error.message);
        
        // Exponential backoff: 1s, 2s, 4s
        const delay = Math.pow(2, job.attempts - 1) * 1000;
        setTimeout(() => {
          this.queue.push(job);
          if (!this.processing) {
            this.process();
          }
        }, delay);
      } else {
        console.error(`❌ Notification job failed after ${this.maxRetries} attempts:`, {
          title: job.title,
          userId: job.userId,
          error: error.message
        });
      }
    }
  }

  /**
   * Auto-detect token format and use appropriate service for single user
   */
  async sendToUserWithAutoDetect(userId, notification) {
    const DeviceToken = require('../models/DeviceToken');
    
    console.log('═══════════════════════════════════════════════════════════');
    console.log('📤 [BACKEND] 📤 SENDING NOTIFICATION TO USER:', userId);
    console.log('═══════════════════════════════════════════════════════════');
    
    // Get all active tokens for user
    const tokens = await DeviceToken.findActiveByUserId(userId);
    
    if (tokens.length === 0) {
      console.log('❌ [BACKEND] No device tokens found for user', userId);
      return { success: false, message: 'No device tokens', sent: 0 };
    }

    console.log(`📊 [BACKEND] Found ${tokens.length} device token(s) for user ${userId}`);

    // Check token formats
    const expoTokens = tokens.filter(t => expoPushService.isValidToken(t.device_token));
    const fcmTokens = tokens.filter(t => fcmService.isValidToken(t.device_token));

    console.log(`📊 [BACKEND] Token Analysis:`);
    console.log(`   - Expo tokens: ${expoTokens.length}`);
    console.log(`   - FCM tokens: ${fcmTokens.length}`);
    
    if (expoTokens.length > 0) {
      console.log(`   - Sample Expo token: ${expoTokens[0].device_token.substring(0, 40)}...`);
    }
    if (fcmTokens.length > 0) {
      console.log(`   - Sample FCM token: ${fcmTokens[0].device_token.substring(0, 40)}...`);
    }

    // If all tokens are Expo format, use Expo service
    if (expoTokens.length === tokens.length && expoTokens.length > 0) {
      console.log('🔥 [BACKEND] 🔥 USING EXPO SERVICE (all tokens are Expo format)');
      console.log('📊 [BACKEND] Will send via: Expo Push Notification Service (exp.host)');
      console.log('═══════════════════════════════════════════════════════════');
      return await expoPushService.sendToUser(userId, notification);
    }
    
    // If all tokens are FCM format, use FCM service
    if (fcmTokens.length === tokens.length && fcmTokens.length > 0) {
      if (!fcmService.initialized) {
        // FCM not initialized, fallback to Expo
        console.warn('⚠️ [BACKEND] FCM service not initialized, falling back to Expo');
        console.log('🔥 [BACKEND] 🔥 USING EXPO SERVICE (FCM not available)');
        console.log('═══════════════════════════════════════════════════════════');
        return await expoPushService.sendToUser(userId, notification);
      }
      console.log('🔥 [BACKEND] 🔥 USING FCM SERVICE (all tokens are FCM format)');
      console.log('📊 [BACKEND] Will send via: Firebase Cloud Messaging (FCM)');
      console.log('═══════════════════════════════════════════════════════════');
      return await fcmService.sendToUser(userId, notification);
    }

    // Mixed tokens - try both services
    let totalSent = 0;
    let totalFailed = 0;
    
    if (expoTokens.length > 0) {
      const expoResult = await expoPushService.sendToUser(userId, notification);
      totalSent += expoResult.sent || 0;
    }
    
    if (fcmTokens.length > 0 && fcmService.initialized) {
      try {
        const fcmResult = await fcmService.sendToUser(userId, notification);
        totalSent += fcmResult.sent || 0;
      } catch (fcmError) {
        console.warn('⚠️ FCM service failed:', fcmError.message);
        totalFailed += fcmTokens.length;
      }
    } else if (fcmTokens.length > 0) {
      totalFailed += fcmTokens.length;
    }

    return {
      success: totalSent > 0,
      message: `Sent to ${totalSent} device(s), ${totalFailed} failed`,
      sent: totalSent,
      failed: totalFailed
    };
  }

  /**
   * Auto-detect token format and use appropriate service for multiple users
   */
  async sendToUsersWithAutoDetect(userIds, notification) {
    const results = await Promise.all(
      userIds.map(userId => this.sendToUserWithAutoDetect(userId, notification))
    );

    const totalSent = results.reduce((sum, r) => sum + (r.sent || 0), 0);
    const totalFailed = results.reduce((sum, r) => sum + (r.failed || 0), 0);

    return {
      success: totalSent > 0,
      message: `Sent to ${totalSent} device(s), ${totalFailed} failed`,
      sent: totalSent,
      failed: totalFailed,
      results
    };
  }

  /**
   * Get queue status (for debugging)
   */
  getStatus() {
    return {
      queueLength: this.queue.length,
      processing: this.processing
    };
  }
}

// Export singleton instance
module.exports = new NotificationQueue();

