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
                AND (t.is_draft = false OR t.is_draft IS NULL)
                AND NOT EXISTS (SELECT 1 FROM transaction_mitra_details WHERE transaction_id = t.id)
              ) + (
                SELECT COALESCE(SUM(tmd.remaining_debt), 0)
                FROM transaction_mitra_details tmd
                JOIN transactions t ON tmd.transaction_id = t.id
                WHERE tmd.mitra_piutang_id = mp.id AND t.status_deleted = false
                AND (t.is_draft = false OR t.is_draft IS NULL)
              ) + GREATEST(0, COALESCE(mp.initial_balance, 0) - COALESCE(mp.initial_balance_paid, 0)) as total_piutang,
              GREATEST(0, COALESCE(mp.initial_balance, 0) - COALESCE(mp.initial_balance_paid, 0)) as initial_balance_remaining
       FROM mitra_piutang mp
       LEFT JOIN users u ON mp.created_by = u.id
       WHERE mp.id = ? AND mp.branch_id = ? AND mp.deleted_at IS NULL`,
      [id, branchId]
    );
    return results[0] || null;
  }

  // Find all (with branch isolation, cumulative remaining debt as of endDate, and period mutation breakdown)
  static async findAll({ branchId, includeDeleted = false, startDate, endDate }) {
    if (!branchId) {
      throw new Error('Branch ID is required for MitraPiutang.findAll');
    }

    const params = [];

    // 1. Cumulative unpaid transactions up to endDate (never drop prior months' unpaid debt on startDate)
    const txEndFilter = endDate ? ' AND DATE(t.transaction_date) <= ?' : '';
    const repayAfterSql = endDate
      ? `COALESCE((
          SELECT SUM(tr.amount)
          FROM transaction_repayments tr
          WHERE tr.transaction_id = t.id
          AND tr.mitra_piutang_id = mp.id
          AND DATE(tr.payment_date) > ?
          AND tr.deleted_at IS NULL
        ), 0)`
      : '0';

    const initCutOffCond = endDate
      ? '(mp.initial_balance_date IS NULL OR DATE(mp.initial_balance_date) <= ?)'
      : '1=1';

    const initRepayAfterSql = endDate
      ? `COALESCE((
          SELECT SUM(tr_i.amount)
          FROM transaction_repayments tr_i
          WHERE tr_i.transaction_id IS NULL
          AND tr_i.mitra_piutang_id = mp.id
          AND DATE(tr_i.payment_date) > ?
          AND tr_i.deleted_at IS NULL
        ), 0)`
      : '0';

    // 2. Period filters for mutation columns (piutang baru, pelunasan kas, pemutihan)
    let periodTxDateSql = '';
    if (startDate) periodTxDateSql += ' AND DATE(t.transaction_date) >= ?';
    if (endDate) periodTxDateSql += ' AND DATE(t.transaction_date) <= ?';

    let periodRepayDateSql = '';
    if (startDate) periodRepayDateSql += ' AND DATE(tr.payment_date) >= ?';
    if (endDate) periodRepayDateSql += ' AND DATE(tr.payment_date) <= ?';

    let initInPeriodCond = 'mp.initial_balance_date IS NOT NULL';
    if (startDate) initInPeriodCond += ' AND DATE(mp.initial_balance_date) >= ?';
    if (endDate) initInPeriodCond += ' AND DATE(mp.initial_balance_date) <= ?';

    // Build ordered bind parameters matching placeholders in SELECT
    // Single-mitra debt up to endDate
    if (endDate) params.push(endDate);
    if (endDate) params.push(endDate);
    // Multi-mitra debt up to endDate
    if (endDate) params.push(endDate);
    if (endDate) params.push(endDate);
    // Initial balance cutoff & repay after endDate
    if (endDate) {
      params.push(endDate);
      params.push(endDate);
    }
    // Single-mitra period_piutang
    if (startDate) params.push(startDate);
    if (endDate) params.push(endDate);
    // Multi-mitra period_piutang
    if (startDate) params.push(startDate);
    if (endDate) params.push(endDate);
    // Initial balance created in period
    if (startDate) params.push(startDate);
    if (endDate) params.push(endDate);
    // period_pelunasan
    if (startDate) params.push(startDate);
    if (endDate) params.push(endDate);
    // period_pemutihan
    if (startDate) params.push(startDate);
    if (endDate) params.push(endDate);
    // initial_balance_remaining duplicate select
    if (endDate) {
      params.push(endDate);
      params.push(endDate);
    }
    // branch_id
    params.push(branchId);

    let sql = `
      SELECT mp.*,
             COALESCE(u.name, u.email) as creator_name,
             (
               (
                 SELECT COALESCE(SUM(t.remaining_debt + ${repayAfterSql}), 0)
                 FROM transactions t
                 WHERE t.mitra_piutang_id = mp.id
                 AND t.status_deleted = false
                 AND (t.is_draft = false OR t.is_draft IS NULL)
                 AND NOT EXISTS (SELECT 1 FROM transaction_mitra_details WHERE transaction_id = t.id)
                 ${txEndFilter}
               ) + (
                 SELECT COALESCE(SUM(tmd.remaining_debt + ${repayAfterSql}), 0)
                 FROM transaction_mitra_details tmd
                 JOIN transactions t ON tmd.transaction_id = t.id
                 WHERE tmd.mitra_piutang_id = mp.id AND t.status_deleted = false
                 AND (t.is_draft = false OR t.is_draft IS NULL)
                 ${txEndFilter}
               ) + (
                 CASE WHEN ${initCutOffCond}
                   THEN GREATEST(0, COALESCE(mp.initial_balance, 0) - COALESCE(mp.initial_balance_paid, 0) + ${initRepayAfterSql})
                   ELSE 0
                 END
               )
             ) as total_piutang,
             (
               (
                 SELECT COALESCE(SUM(
                   t.remaining_debt + COALESCE((
                     SELECT SUM(tr_all.amount) FROM transaction_repayments tr_all
                     WHERE tr_all.transaction_id = t.id AND tr_all.mitra_piutang_id = mp.id AND tr_all.deleted_at IS NULL
                   ), 0)
                 ), 0)
                 FROM transactions t
                 WHERE t.mitra_piutang_id = mp.id
                 AND t.status_deleted = false
                 AND (t.is_draft = false OR t.is_draft IS NULL)
                 AND NOT EXISTS (SELECT 1 FROM transaction_mitra_details WHERE transaction_id = t.id)
                 ${periodTxDateSql}
               ) + (
                 SELECT COALESCE(SUM(
                   tmd.remaining_debt + COALESCE((
                     SELECT SUM(tr_all.amount) FROM transaction_repayments tr_all
                     WHERE tr_all.transaction_id = t.id AND tr_all.mitra_piutang_id = mp.id AND tr_all.deleted_at IS NULL
                   ), 0)
                 ), 0)
                 FROM transaction_mitra_details tmd
                 JOIN transactions t ON tmd.transaction_id = t.id
                 WHERE tmd.mitra_piutang_id = mp.id AND t.status_deleted = false
                 AND (t.is_draft = false OR t.is_draft IS NULL)
                 ${periodTxDateSql}
               ) + (
                 CASE WHEN ${initInPeriodCond}
                   THEN COALESCE(mp.initial_balance, 0)
                   ELSE 0
                 END
               )
             ) as period_piutang,
             (
               SELECT COALESCE(SUM(tr.amount), 0)
               FROM transaction_repayments tr
               LEFT JOIN transactions t_r ON tr.transaction_id = t_r.id
               WHERE tr.mitra_piutang_id = mp.id
                 AND tr.deleted_at IS NULL
                 AND COALESCE(tr.is_writeoff, 0) = 0
                 AND (t_r.id IS NULL OR t_r.status_deleted = false)
                 ${periodRepayDateSql}
             ) as period_pelunasan,
             (
               SELECT COALESCE(SUM(tr.amount), 0)
               FROM transaction_repayments tr
               LEFT JOIN transactions t_r ON tr.transaction_id = t_r.id
               WHERE tr.mitra_piutang_id = mp.id
                 AND tr.deleted_at IS NULL
                 AND COALESCE(tr.is_writeoff, 0) = 1
                 AND (t_r.id IS NULL OR t_r.status_deleted = false)
                 ${periodRepayDateSql}
             ) as period_pemutihan,
             (
               CASE WHEN ${initCutOffCond}
                 THEN GREATEST(0, COALESCE(mp.initial_balance, 0) - COALESCE(mp.initial_balance_paid, 0) + ${initRepayAfterSql})
                 ELSE 0
               END
             ) as initial_balance_remaining
      FROM mitra_piutang mp
      LEFT JOIN users u ON mp.created_by = u.id
      WHERE mp.branch_id = ?
    `;

    if (!includeDeleted) {
      sql += ' AND mp.deleted_at IS NULL';
    }

    sql += ' ORDER BY mp.created_at DESC';

    const results = await query(sql, params);
    return results;
  }

  // Create
  static async create({ branchId, nama, createdBy, initialBalance = 0, initialBalanceDate = null, initialBalanceNote = null }) {
    const result = await query(
      `INSERT INTO mitra_piutang (branch_id, nama, created_by, initial_balance, initial_balance_date, initial_balance_note, initial_balance_paid)
       VALUES (?, ?, ?, ?, ?, ?, 0.00)`,
      [branchId, nama, createdBy, parseFloat(initialBalance) || 0, initialBalanceDate || null, initialBalanceNote || null]
    );
    return await this.findById(result.insertId, branchId);
  }

  // Update
  static async update(id, branchId, { nama, initialBalance, initialBalanceDate, initialBalanceNote, initialBalancePaid }) {
    const updates = [];
    const params = [];

    if (nama !== undefined) {
      updates.push('nama = ?');
      params.push(nama);
    }
    if (initialBalance !== undefined) {
      updates.push('initial_balance = ?');
      params.push(parseFloat(initialBalance) || 0);
    }
    if (initialBalanceDate !== undefined) {
      updates.push('initial_balance_date = ?');
      params.push(initialBalanceDate || null);
    }
    if (initialBalanceNote !== undefined) {
      updates.push('initial_balance_note = ?');
      params.push(initialBalanceNote || null);
    }
    if (initialBalancePaid !== undefined) {
      updates.push('initial_balance_paid = ?');
      params.push(parseFloat(initialBalancePaid) || 0);
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

