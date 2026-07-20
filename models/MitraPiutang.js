const { query } = require('../config/database');

class MitraPiutang {
  // Find by ID (with debt stats)
  static async findById(id, branchId) {
    const results = await query(
      `SELECT mp.*, 
              COALESCE(u.name, u.email) as creator_name,
              (
                SELECT COALESCE(SUM(t.remaining_debt), 0)
                FROM transactions t
                WHERE t.mitra_piutang_id = mp.id 
                AND t.status_deleted = false
                AND NOT EXISTS (SELECT 1 FROM transaction_mitra_details WHERE transaction_id = t.id)
              ) + (
                SELECT COALESCE(SUM(tmd.remaining_debt), 0)
                FROM transaction_mitra_details tmd
                JOIN transactions t ON tmd.transaction_id = t.id
                WHERE tmd.mitra_piutang_id = mp.id AND t.status_deleted = false
              ) as total_piutang
       FROM mitra_piutang mp
       LEFT JOIN users u ON mp.created_by = u.id
       WHERE mp.id = ? AND mp.branch_id = ? AND mp.deleted_at IS NULL`,
      [id, branchId]
    );
    return results[0] || null;
  }

  // Find all (with branch isolation and debt stats)
  static async findAll({ branchId, includeDeleted = false, startDate, endDate }) {
    if (!branchId) {
      throw new Error('Branch ID is required for MitraPiutang.findAll');
    }

    const subParams = [];
    let dateFilterSql = '';
    if (startDate) {
      dateFilterSql += ' AND t.transaction_date >= ?';
      subParams.push(startDate + ' 00:00:00');
    }
    if (endDate) {
      dateFilterSql += ' AND t.transaction_date <= ?';
      subParams.push(endDate + ' 23:59:59');
    }

    let repayAfterSql = '0';
    const repayParams = [];
    if (endDate) {
      repayAfterSql = `COALESCE((
        SELECT SUM(tr.amount)
        FROM transaction_repayments tr
        WHERE tr.transaction_id = t.id
        AND tr.mitra_piutang_id = mp.id
        AND tr.payment_date > ?
      ), 0)`;
      repayParams.push(endDate + ' 23:59:59');
    }

    let sql = `
      SELECT mp.*, 
             COALESCE(u.name, u.email) as creator_name,
             (
               SELECT COALESCE(SUM(t.remaining_debt + ${repayAfterSql}), 0)
               FROM transactions t
               WHERE t.mitra_piutang_id = mp.id 
               AND t.status_deleted = false
               AND NOT EXISTS (SELECT 1 FROM transaction_mitra_details WHERE transaction_id = t.id)
               ${dateFilterSql}
             ) + (
               SELECT COALESCE(SUM(tmd.remaining_debt + ${repayAfterSql}), 0)
               FROM transaction_mitra_details tmd
               JOIN transactions t ON tmd.transaction_id = t.id
               WHERE tmd.mitra_piutang_id = mp.id AND t.status_deleted = false
               ${dateFilterSql}
             ) as total_piutang
      FROM mitra_piutang mp
      LEFT JOIN users u ON mp.created_by = u.id
      WHERE mp.branch_id = ?
    `;
    const params = [
      ...(endDate ? repayParams : []),
      ...subParams,
      ...(endDate ? repayParams : []),
      ...subParams,
      branchId
    ];

    if (!includeDeleted) {
      sql += ' AND mp.deleted_at IS NULL';
    }

    sql += ' ORDER BY mp.created_at DESC';

    const results = await query(sql, params);
    return results;
  }

  // Create
  static async create({ branchId, nama, createdBy }) {
    const result = await query(
      `INSERT INTO mitra_piutang (branch_id, nama, created_by)
       VALUES (?, ?, ?)`,
      [branchId, nama, createdBy]
    );
    return await this.findById(result.insertId, branchId);
  }

  // Update
  static async update(id, branchId, { nama }) {
    const updates = [];
    const params = [];

    if (nama !== undefined) {
      updates.push('nama = ?');
      params.push(nama);
    }

    if (updates.length === 0) return await this.findById(id, branchId);

    params.push(id, branchId);
    await query(
      `UPDATE mitra_piutang 
       SET ${updates.join(', ')}, updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND branch_id = ? AND deleted_at IS NULL`,
      params
    );
    return await this.findById(id, branchId);
  }

  // Soft delete
  static async delete(id, branchId) {
    await query(
      `UPDATE mitra_piutang 
       SET deleted_at = CURRENT_TIMESTAMP
       WHERE id = ? AND branch_id = ? AND deleted_at IS NULL`,
      [id, branchId]
    );
    return true;
  }

  // Restore
  static async restore(id, branchId) {
    await query(
      `UPDATE mitra_piutang 
       SET deleted_at = NULL
       WHERE id = ? AND branch_id = ? AND deleted_at IS NOT NULL`,
      [id, branchId]
    );
    return await this.findById(id, branchId);
  }
}

module.exports = MitraPiutang;

