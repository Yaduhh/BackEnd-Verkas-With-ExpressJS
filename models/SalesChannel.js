const { query } = require('../config/database');

class SalesChannel {
  // Find all sales channels for branch + global defaults
  static async findAll({ branchId, includeInactive = false, onlyDeleted = false } = {}) {
    let sql = `
      SELECT sc.*,
        (SELECT COUNT(*) FROM transaction_sales_channels tsc WHERE tsc.sales_channel_id = sc.id) AS transaction_count
      FROM sales_channels sc
      WHERE 1=1
    `;
    const params = [];

    if (onlyDeleted) {
      sql += ' AND sc.status_deleted = 1';
    } else {
      sql += ' AND sc.status_deleted = 0';
    }

    if (!includeInactive && !onlyDeleted) {
      sql += ' AND sc.is_active = 1';
    }

    if (branchId !== undefined && branchId !== null) {
      sql += ' AND (sc.branch_id = ? OR sc.branch_id IS NULL)';
      params.push(parseInt(branchId));
    }

    sql += ' ORDER BY sc.name ASC';
    return await query(sql, params);
  }

  // Find by ID
  static async findById(id) {
    const results = await query(
      `SELECT sc.*,
        (SELECT COUNT(*) FROM transaction_sales_channels tsc WHERE tsc.sales_channel_id = sc.id) AS transaction_count
       FROM sales_channels sc
       WHERE sc.id = ?`,
      [id]
    );
    return results[0] || null;
  }

  // Create new sales channel
  static async create({ branchId, name, description = null, isActive = true }) {
    const result = await query(
      `INSERT INTO sales_channels (branch_id, name, description, is_active, status_deleted)
       VALUES (?, ?, ?, ?, 0)`,
      [branchId || null, name.trim(), description ? description.trim() : null, isActive ? 1 : 0]
    );
    return await this.findById(result.insertId);
  }

  // Update sales channel
  static async update(id, { name, description, isActive }) {
    const updates = [];
    const params = [];

    if (name !== undefined) {
      updates.push('name = ?');
      params.push(name.trim());
    }

    if (description !== undefined) {
      updates.push('description = ?');
      params.push(description ? description.trim() : null);
    }

    if (isActive !== undefined) {
      updates.push('is_active = ?');
      params.push(isActive ? 1 : 0);
    }

    if (updates.length > 0) {
      params.push(id);
      await query(
        `UPDATE sales_channels SET ${updates.join(', ')} WHERE id = ?`,
        params
      );
    }

    return await this.findById(id);
  }

  // Soft delete sales channel
  static async softDelete(id) {
    await query(
      `UPDATE sales_channels SET status_deleted = 1, deleted_at = NOW() WHERE id = ?`,
      [id]
    );
    return true;
  }

  // Restore soft deleted sales channel
  static async restore(id) {
    await query(
      `UPDATE sales_channels SET status_deleted = 0, deleted_at = NULL WHERE id = ?`,
      [id]
    );
    return await this.findById(id);
  }

  // Hard delete (if needed)
  static async hardDelete(id) {
    return await query('DELETE FROM sales_channels WHERE id = ?', [id]);
  }
}

module.exports = SalesChannel;
