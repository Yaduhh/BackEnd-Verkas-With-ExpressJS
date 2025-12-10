const { query } = require('../config/database');

class SubscriptionPlan {
  // Find by ID
  static async findById(id) {
    const results = await query(
      'SELECT * FROM subscription_plans WHERE id = ? AND is_active = true',
      [id]
    );
    return results[0] || null;
  }
  
  // Find all active plans
  static async findAll({ isActive = true } = {}) {
    let sql = 'SELECT * FROM subscription_plans WHERE 1=1';
    const params = [];
    
    if (isActive) {
      sql += ' AND is_active = true';
    }
    
    sql += ' ORDER BY price_monthly ASC';
    
    return await query(sql, params);
  }
  
  // Get default plan (Free plan)
  static async getDefaultPlan() {
    const results = await query(
      'SELECT * FROM subscription_plans WHERE name = ? AND is_active = true',
      ['Free']
    );
    return results[0] || null;
  }
  
  // Get plan by max branches
  static async getByMaxBranches(maxBranches) {
    if (maxBranches === null) {
      // Unlimited
      return await query(
        'SELECT * FROM subscription_plans WHERE max_branches IS NULL AND is_active = true LIMIT 1'
      );
    }
    
    const results = await query(
      'SELECT * FROM subscription_plans WHERE max_branches = ? AND is_active = true LIMIT 1',
      [maxBranches]
    );
    return results[0] || null;
  }
  
  // Create plan (admin only, usually via seed)
  static async create({ name, description, maxBranches, priceMonthly, priceYearly, features }) {
    const result = await query(
      `INSERT INTO subscription_plans (name, description, max_branches, price_monthly, price_yearly, features, is_active)
       VALUES (?, ?, ?, ?, ?, ?, true)`,
      [name, description || null, maxBranches, priceMonthly || null, priceYearly || null, JSON.stringify(features || [])]
    );
    return await this.findById(result.insertId);
  }
  
  // Update plan
  static async update(id, { name, description, maxBranches, priceMonthly, priceYearly, features, isActive }) {
    const updates = [];
    const params = [];
    
    if (name !== undefined) {
      updates.push('name = ?');
      params.push(name);
    }
    if (description !== undefined) {
      updates.push('description = ?');
      params.push(description || null);
    }
    if (maxBranches !== undefined) {
      updates.push('max_branches = ?');
      params.push(maxBranches);
    }
    if (priceMonthly !== undefined) {
      updates.push('price_monthly = ?');
      params.push(priceMonthly || null);
    }
    if (priceYearly !== undefined) {
      updates.push('price_yearly = ?');
      params.push(priceYearly || null);
    }
    if (features !== undefined) {
      updates.push('features = ?');
      params.push(JSON.stringify(features));
    }
    if (isActive !== undefined) {
      updates.push('is_active = ?');
      params.push(isActive);
    }
    
    if (updates.length === 0) return await this.findById(id);
    
    params.push(id);
    await query(
      `UPDATE subscription_plans SET ${updates.join(', ')} WHERE id = ?`,
      params
    );
    return await this.findById(id);
  }
}

module.exports = SubscriptionPlan;

