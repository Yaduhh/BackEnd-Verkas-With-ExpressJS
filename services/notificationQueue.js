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
        // Multiple users - Try FCM first, fallback to Expo
        try {
          result = await fcmService.sendToUsers(job.userId, {
            title: job.title,
            body: job.body,
            data: job.data,
            sound: job.sound,
            priority: job.priority
          });
        } catch (fcmError) {
          console.warn('⚠️ FCM service failed, falling back to Expo:', fcmError.message);
          result = await expoPushService.sendToUsers(job.userId, {
            title: job.title,
            body: job.body,
            data: job.data,
            sound: job.sound,
            priority: job.priority
          });
        }

        if (result.sent > 0) {
          console.log(`✅ Queued notification sent: "${job.title}" to ${result.sent} device(s)`);
        } else if (process.env.NODE_ENV === 'development') {
          console.warn(`⚠️ Queued notification failed: "${job.title}" - ${result.message || 'No devices'}`);
        }
      } else {
        // Single user - Try FCM first, fallback to Expo
        try {
          result = await fcmService.sendToUser(job.userId, {
            title: job.title,
            body: job.body,
            data: job.data,
            sound: job.sound,
            priority: job.priority
          });
        } catch (fcmError) {
          console.warn('⚠️ FCM service failed, falling back to Expo:', fcmError.message);
          result = await expoPushService.sendToUser(job.userId, {
            title: job.title,
            body: job.body,
            data: job.data,
            sound: job.sound,
            priority: job.priority
          });
        }

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

