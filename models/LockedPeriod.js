const { query } = require('../config/database');

class LockedPeriod {
  // Find by ID
  static async findById(id) {
    const results = await query(
      `SELECT lp.*, u.name as locked_by_name 
       FROM locked_periods lp 
       LEFT JOIN users u ON lp.locked_by = u.id 
       WHERE lp.id = ?`,
      [id]
    );
    return results[0] || null;
  }

  // Find all for a branch
  static async findAllByBranch(branchId) {
    return await query(
      `SELECT lp.*, u.name as locked_by_name 
       FROM locked_periods lp 
       LEFT JOIN users u ON lp.locked_by = u.id 
       WHERE lp.branch_id = ? 
       ORDER BY lp.year DESC, lp.month DESC`,
      [branchId]
    );
  }

  // Check if a specific month and year is locked for a branch
  static async isLocked(branchId, month, year) {
    const results = await query(
      `SELECT is_locked FROM locked_periods 
       WHERE branch_id = ? AND month = ? AND year = ?`,
      [branchId, month, year]
    );
    if (results.length > 0) {
      return Boolean(results[0].is_locked);
    }
    return false; // Default is not locked
  }

  // Toggle lock for a specific month and year
  static async toggleLock(branchId, month, year, isLocked, userId) {
    // Check if the record exists
    const results = await query(
      `SELECT id FROM locked_periods WHERE branch_id = ? AND month = ? AND year = ?`,
      [branchId, month, year]
    );

    if (results.length > 0) {
      // Update existing record
      await query(
        `UPDATE locked_periods 
         SET is_locked = ?, locked_by = ? 
         WHERE id = ?`,
        [isLocked, userId, results[0].id]
      );
      return await this.findById(results[0].id);
    } else {
      // Create new record
      const result = await query(
        `INSERT INTO locked_periods (branch_id, month, year, is_locked, locked_by)
         VALUES (?, ?, ?, ?, ?)`,
        [branchId, month, year, isLocked, userId]
      );
      return await this.findById(result.insertId);
    }
  }
}

module.exports = LockedPeriod;
