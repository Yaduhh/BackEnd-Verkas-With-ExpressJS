const { query } = require('../config/database');

class Subscription {
  // Find by ID
  static async findById(id) {
    const results = await query(
      `SELECT s.*, p.name as plan_name, p.max_branches, p.price_monthly, p.price_yearly
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
      `SELECT s.*, p.name as plan_name, p.max_branches, p.price_monthly, p.price_yearly
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
      `SELECT s.*, p.name as plan_name, p.max_branches, p.price_monthly, p.price_yearly
       FROM subscriptions s
       JOIN subscription_plans p ON s.plan_id = p.id
       WHERE s.user_id = ? AND s.status = 'active' AND s.end_date >= ?
       ORDER BY s.created_at DESC
       LIMIT 1`,
      [userId, today]
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
    await query(
      'UPDATE subscriptions SET status = ? WHERE id = ?',
      [status, id]
    );
    return await this.findById(id);
  }
  
  // Update end date
  static async updateEndDate(id, endDate) {
    await query(
      'UPDATE subscriptions SET end_date = ? WHERE id = ?',
      [endDate, id]
    );
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

