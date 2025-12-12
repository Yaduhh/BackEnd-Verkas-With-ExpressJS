const { query } = require('../config/database');

class DeviceToken {
  // Find by user ID and token
  static async findByUserAndToken(userId, deviceToken) {
    const results = await query(
      'SELECT * FROM device_tokens WHERE user_id = ? AND device_token = ?',
      [userId, deviceToken]
    );
    return results[0] || null;
  }

  // Find all active tokens for a user
  static async findActiveByUserId(userId) {
    return await query(
      'SELECT * FROM device_tokens WHERE user_id = ? AND is_active = true ORDER BY last_used_at DESC, created_at DESC',
      [userId]
    );
  }

  // Find all tokens for a user (including inactive)
  static async findByUserId(userId) {
    return await query(
      'SELECT * FROM device_tokens WHERE user_id = ? ORDER BY is_active DESC, last_used_at DESC, created_at DESC',
      [userId]
    );
  }

  // Register or update device token
  static async register({ userId, deviceToken, platform, deviceName = null, appVersion = null }) {
    // Check if token already exists
    const existing = await this.findByUserAndToken(userId, deviceToken);
    
    if (existing) {
      // Update existing token
      const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
      await query(
        `UPDATE device_tokens 
         SET platform = ?, device_name = ?, app_version = ?, is_active = true, last_used_at = ?, updated_at = ?
         WHERE id = ?`,
        [platform, deviceName, appVersion, now, now, existing.id]
      );
      return await this.findByUserAndToken(userId, deviceToken);
    } else {
      // Create new token
      const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
      const result = await query(
        `INSERT INTO device_tokens (user_id, device_token, platform, device_name, app_version, is_active, last_used_at)
         VALUES (?, ?, ?, ?, ?, true, ?)`,
        [userId, deviceToken, platform, deviceName, appVersion, now]
      );
      return await this.findById(result.insertId);
    }
  }

  // Find by ID
  static async findById(id) {
    const results = await query(
      'SELECT * FROM device_tokens WHERE id = ?',
      [id]
    );
    return results[0] || null;
  }

  // Unregister device token (soft delete - set is_active = false)
  static async unregister(userId, deviceToken) {
    await query(
      'UPDATE device_tokens SET is_active = false WHERE user_id = ? AND device_token = ?',
      [userId, deviceToken]
    );
    return { success: true };
  }

  static async unregisterByToken(deviceToken) {
    await query(
      'UPDATE device_tokens SET is_active = false WHERE device_token = ?',
      [deviceToken]
    );
    return { success: true };
  }

  // Hard delete device token
  static async delete(userId, deviceToken) {
    await query(
      'DELETE FROM device_tokens WHERE user_id = ? AND device_token = ?',
      [userId, deviceToken]
    );
    return { success: true };
  }

  // Update last_used_at for multiple tokens
  static async updateLastUsed(tokenIds) {
    if (!tokenIds || tokenIds.length === 0) return;
    
    const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
    const placeholders = tokenIds.map(() => '?').join(',');
    await query(
      `UPDATE device_tokens SET last_used_at = ? WHERE id IN (${placeholders})`,
      [now, ...tokenIds]
    );
  }

  // Deactivate all tokens for a user (useful for logout)
  static async deactivateAllForUser(userId) {
    await query(
      'UPDATE device_tokens SET is_active = false WHERE user_id = ?',
      [userId]
    );
    return { success: true };
  }

  // Cleanup old inactive tokens (older than 90 days)
  static async cleanupOldTokens() {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - 90);
    const cutoff = cutoffDate.toISOString().slice(0, 19).replace('T', ' ');
    
    const result = await query(
      'DELETE FROM device_tokens WHERE is_active = false AND updated_at < ?',
      [cutoff]
    );
    
    return { deleted: result.affectedRows || 0 };
  }
}

module.exports = DeviceToken;

