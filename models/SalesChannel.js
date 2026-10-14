const { query } = require('../config/database');

class SalesChannel {
  // Seed default sales channels for a specific branch if none exist
  static async seedDefaults(branchId) {
    if (!branchId) return;
    const existing = await query(
      'SELECT id FROM sales_channels WHERE branch_id = ? LIMIT 1',
      [parseInt(branchId)]
    );
    if (existing.length > 0) return;

    const defaultChannels = [
      { name: 'Dine In', description: 'Penjualan langsung di outlet/kasir' },
      { name: 'Take Away', description: 'Pesanan bungkus / WhatsApp delivery' },
      { name: 'GrabFood', description: 'Pesanan melalui platform GrabFood' },
      { name: 'ShopeeFood', description: 'Pesanan melalui platform ShopeeFood' },
      { name: 'GoFood', description: 'Pesanan melalui platform GoFood' }
    ];

    // Find default Omzet category for this branch
    const omzetCat = await query(
      `SELECT id FROM categories 
       WHERE branch_id = ? 
         AND (name LIKE '%Omzet%' OR name LIKE '%OMZET%' OR name LIKE '%Omset%' OR name LIKE '%OMSET%')
         AND parent_id IS NULL 
         AND status_deleted = 0 
       LIMIT 1`,
      [parseInt(branchId)]
    );
    const categoryId = omzetCat.length > 0 ? omzetCat[0].id : null;

    for (const ch of defaultChannels) {
      await query(
        `INSERT INTO sales_channels (branch_id, category_id, name, description, is_active, status_deleted)
         VALUES (?, ?, ?, ?, 1, 0)`,
        [parseInt(branchId), categoryId, ch.name, ch.description]
      );
    }
  }

  // Find all sales channels strictly for a specific branch
  static async findAll({ branchId, categoryId, includeInactive = false, onlyDeleted = false } = {}) {
    if (!branchId) {
      return [];
    }

    const parsedBranchId = parseInt(branchId);

    // Auto seed if branch has no channels at all
    if (!onlyDeleted) {
      await this.seedDefaults(parsedBranchId);
    }

    let sql = `
      SELECT sc.*,
        c.name AS category_name,
        c.code AS category_code,
        (
          SELECT COUNT(*)
          FROM transaction_sales_channels tsc
          JOIN transactions t ON tsc.transaction_id = t.id
          WHERE tsc.sales_channel_id = sc.id
            AND t.branch_id = sc.branch_id
            AND t.status_deleted = 0
        ) AS transaction_count
      FROM sales_channels sc
      LEFT JOIN categories c ON sc.category_id = c.id
      WHERE sc.branch_id = ?
    `;
    const params = [parsedBranchId];

    if (categoryId !== undefined && categoryId !== null && categoryId !== '' && categoryId !== 'all') {
      sql += ' AND sc.category_id = ?';
      params.push(parseInt(categoryId));
    }

    if (onlyDeleted) {
      sql += ' AND sc.status_deleted = 1';
    } else {
      sql += ' AND sc.status_deleted = 0';
    }

    if (!includeInactive && !onlyDeleted) {
      sql += ' AND sc.is_active = 1';
    }

    sql += ' ORDER BY sc.category_id ASC, sc.name ASC';
    return await query(sql, params);
  }

  // Find by ID
  static async findById(id) {
    const results = await query(
      `SELECT sc.*,
        c.name AS category_name,
        c.code AS category_code,
        (
          SELECT COUNT(*)
          FROM transaction_sales_channels tsc
          JOIN transactions t ON tsc.transaction_id = t.id
          WHERE tsc.sales_channel_id = sc.id
            AND t.branch_id = sc.branch_id
            AND t.status_deleted = 0
        ) AS transaction_count
       FROM sales_channels sc
       LEFT JOIN categories c ON sc.category_id = c.id
       WHERE sc.id = ?`,
      [id]
    );
    return results[0] || null;
  }

  // Create new sales channel for a branch
  static async create({ branchId, categoryId = null, name, description = null, isActive = true }) {
    if (!branchId) {
      throw new Error('branch_id is required to create a sales channel');
    }

    const result = await query(
      `INSERT INTO sales_channels (branch_id, category_id, name, description, is_active, status_deleted)
       VALUES (?, ?, ?, ?, ?, 0)`,
      [parseInt(branchId), categoryId ? parseInt(categoryId) : null, name.trim(), description ? description.trim() : null, isActive ? 1 : 0]
    );
    return await this.findById(result.insertId);
  }

  // Update sales channel
  static async update(id, { categoryId, name, description, isActive }) {
    const updates = [];
    const params = [];

    if (categoryId !== undefined) {
      updates.push('category_id = ?');
      params.push(categoryId ? parseInt(categoryId) : null);
    }

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
