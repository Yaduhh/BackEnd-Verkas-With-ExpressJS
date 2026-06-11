const { query } = require('../config/database');

class Subscription {
  // Find by ID
  static async findById(id) {
    const results = await query(
      `SELECT s.*, p.name as plan_name, p.max_branches, p.max_admin, p.price_monthly, p.price_yearly
       FROM subscriptions s
       JOIN subscription_plans p ON s.plan_id = p.id
       WHERE s.id = ?`,
      [id]
    );
    return results[0] || null;
  }
  
  // Find by user ID
  static async findByUserId(userId) {
    const results = await query(
      `SELECT s.*, p.name as plan_name, p.max_branches, p.max_admin, p.price_monthly, p.price_yearly
       FROM subscriptions s
       JOIN subscription_plans p ON s.plan_id = p.id
       WHERE s.user_id = ?
       ORDER BY s.created_at DESC`,
      [userId]
    );
    return results;
  }
  
  // Get active subscription for user
  static async getActiveSubscription(userId) {
    const today = new Date().toISOString().split('T')[0];
    const results = await query(
      `SELECT s.*, p.name as plan_name, p.max_branches, p.max_admin, p.price_monthly, p.price_yearly
       FROM subscriptions s
       JOIN subscription_plans p ON s.plan_id = p.id
       WHERE s.user_id = ? AND s.status = 'active' AND s.end_date >= ?
       ORDER BY s.created_at DESC
       LIMIT 1`,
      [userId, today]
    );
    return results[0] || null;
  }
  
  // Get pending subscription for user
  static async getPendingSubscription(userId) {
    const results = await query(
      `SELECT s.*, p.name as plan_name, p.max_branches, p.max_admin, p.price_monthly, p.price_yearly
       FROM subscriptions s
       JOIN subscription_plans p ON s.plan_id = p.id
       WHERE s.user_id = ? AND s.status = 'pending'
       ORDER BY s.created_at DESC
       LIMIT 1`,
      [userId]
    );
    return results[0] || null;
  }
  
  // Create subscription
  static async create({ userId, planId, billingPeriod, startDate, endDate, autoRenew = true }) {
    const result = await query(
      `INSERT INTO subscriptions (user_id, plan_id, billing_period, status, start_date, end_date, auto_renew)
       VALUES (?, ?, ?, 'pending', ?, ?, ?)`,
      [userId, planId, billingPeriod, startDate, endDate, autoRenew]
    );
    return await this.findById(result.insertId);
  }
  
  // Update subscription status
  static async updateStatus(id, status) {
    if (status === 'active') {
      const subscription = await this.findById(id);
      if (!subscription) {
        throw new Error('Subscription not found');
      }

      if (subscription.status === 'active') {
        // Already active, extend it!
        const currentEndDate = new Date(subscription.end_date);
        const newEndDate = new Date(currentEndDate);
        if (subscription.billing_period === 'monthly') {
          newEndDate.setMonth(newEndDate.getMonth() + 1);
        } else {
          newEndDate.setFullYear(newEndDate.getFullYear() + 1);
        }
        await query(
          'UPDATE subscriptions SET end_date = ? WHERE id = ?',
          [newEndDate.toISOString().split('T')[0], id]
        );
      } else {
        // Pending/expired, activate from today
        // Immediate Replace: Mark any other active subscription of this user as expired
        await query(
          "UPDATE subscriptions SET status = 'expired' WHERE user_id = ? AND status = 'active' AND id != ?",
          [subscription.user_id, id]
        );

        const startDate = new Date();
        const endDate = new Date(startDate);
        if (subscription.billing_period === 'monthly') {
          endDate.setMonth(endDate.getMonth() + 1);
        } else {
          endDate.setFullYear(endDate.getFullYear() + 1);
        }
        await query(
          "UPDATE subscriptions SET status = 'active', start_date = ?, end_date = ? WHERE id = ?",
          [startDate.toISOString().split('T')[0], endDate.toISOString().split('T')[0], id]
        );
      }
      return await this.findById(id);
    }

    await query(
      'UPDATE subscriptions SET status = ? WHERE id = ?',
      [status, id]
    );
    return await this.findById(id);
  }
  
  // Update end date
  static async updateEndDate(id, endDate) {
    const subscription = await this.findById(id);
    if (subscription && subscription.end_date) {
      // Ensure date comparison works regardless of whether DB returns Date object or string
      const currentStr = subscription.end_date instanceof Date 
        ? subscription.end_date.toISOString().split('T')[0] 
        : String(subscription.end_date).split('T')[0];
      const targetStr = endDate instanceof Date 
        ? endDate.toISOString().split('T')[0] 
        : String(endDate).split('T')[0];
        
      if (currentStr > targetStr) {
        // Protect extended end date from duplicate controller recalculations
        return subscription;
      }
    }
    await query(
      'UPDATE subscriptions SET end_date = ? WHERE id = ?',
      [endDate, id]
    );
    return await this.findById(id);
  }

  // Activate or extend a subscription
  static async activateOrExtend(id) {
    const subscription = await this.findById(id);
    if (!subscription) {
      throw new Error('Subscription not found');
    }

    if (subscription.status === 'active') {
      // It's already active, so we extend the end_date!
      const currentEndDate = new Date(subscription.end_date);
      const newEndDate = new Date(currentEndDate);
      
      if (subscription.billing_period === 'monthly') {
        newEndDate.setMonth(newEndDate.getMonth() + 1);
      } else {
        newEndDate.setFullYear(newEndDate.getFullYear() + 1);
      }
      
      await query(
        'UPDATE subscriptions SET end_date = ? WHERE id = ?',
        [newEndDate.toISOString().split('T')[0], id]
      );
    } else {
      // It was pending/expired, so we activate it starting from today
      const startDate = new Date();
      const endDate = new Date(startDate);
      
      if (subscription.billing_period === 'monthly') {
        endDate.setMonth(endDate.getMonth() + 1);
      } else {
        endDate.setFullYear(endDate.getFullYear() + 1);
      }
      
      await query(
        "UPDATE subscriptions SET status = 'active', start_date = ?, end_date = ? WHERE id = ?",
        [startDate.toISOString().split('T')[0], endDate.toISOString().split('T')[0], id]
      );
    }
    
    return await this.findById(id);
  }
  
  // Cancel subscription
  static async cancel(id) {
    await query(
      'UPDATE subscriptions SET status = ? WHERE id = ?',
      ['cancelled', id]
    );
    return await this.findById(id);
  }
  
  // Renew subscription
  static async renew(id) {
    const subscription = await this.findById(id);
    if (!subscription) {
      throw new Error('Subscription not found');
    }
    
    // Calculate new end date
    const startDate = new Date(subscription.end_date);
    const endDate = new Date(startDate);
    
    if (subscription.billing_period === 'monthly') {
      endDate.setMonth(endDate.getMonth() + 1);
    } else {
      endDate.setFullYear(endDate.getFullYear() + 1);
    }
    
    await query(
      'UPDATE subscriptions SET start_date = ?, end_date = ?, status = ? WHERE id = ?',
      [startDate.toISOString().split('T')[0], endDate.toISOString().split('T')[0], 'active', id]
    );
    
    return await this.findById(id);
  }
  
  // Check and update expired subscriptions
  static async checkExpiry() {
    const today = new Date().toISOString().split('T')[0];
    const results = await query(
      `UPDATE subscriptions 
       SET status = 'expired' 
       WHERE status = 'active' AND end_date < ?`,
      [today]
    );
    return results.affectedRows;
  }
  
  // Get expired subscriptions
  static async getExpiredSubscriptions() {
    const today = new Date().toISOString().split('T')[0];
    const results = await query(
      `SELECT s.*, p.name as plan_name
       FROM subscriptions s
       JOIN subscription_plans p ON s.plan_id = p.id
       WHERE s.status = 'active' AND s.end_date < ?`,
      [today]
    );
    return results;
  }
}

module.exports = Subscription;

