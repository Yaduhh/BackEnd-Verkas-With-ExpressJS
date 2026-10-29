const { query, transaction: dbTransaction } = require('../config/database');

class FundTransfer {
  static async findAll({
    branchId,
    startDate = null,
    endDate = null,
    bankAccountId = null,
    fromBankAccountId = null,
    toBankAccountId = null,
    search = '',
    page = 1,
    limit = 20
  } = {}) {
    let whereClause = 'WHERE ft.branch_id = ? AND ft.status_deleted = 0';
    const params = [branchId];

    if (startDate && endDate) {
      whereClause += ' AND ft.transfer_date BETWEEN ? AND ?';
      params.push(startDate, endDate);
    } else if (startDate) {
      whereClause += ' AND ft.transfer_date >= ?';
      params.push(startDate);
    } else if (endDate) {
      whereClause += ' AND ft.transfer_date <= ?';
      params.push(endDate);
    }

    if (bankAccountId) {
      whereClause += ' AND (ft.from_bank_account_id = ? OR ft.to_bank_account_id = ?)';
      params.push(bankAccountId, bankAccountId);
    }

    if (fromBankAccountId) {
      whereClause += ' AND ft.from_bank_account_id = ?';
      params.push(fromBankAccountId);
    }

    if (toBankAccountId) {
      whereClause += ' AND ft.to_bank_account_id = ?';
      params.push(toBankAccountId);
    }

    if (search && search.trim()) {
      whereClause += ' AND (ft.note LIKE ? OR from_ba.name LIKE ? OR to_ba.name LIKE ?)';
      const s = `%${search.trim()}%`;
      params.push(s, s, s);
    }

    // Total Count
    const countSql = `
      SELECT COUNT(*) as total
      FROM fund_transfers ft
      JOIN bank_accounts from_ba ON ft.from_bank_account_id = from_ba.id
      JOIN bank_accounts to_ba ON ft.to_bank_account_id = to_ba.id
      ${whereClause}
    `;
    const countRes = await query(countSql, params);
    const total = countRes[0]?.total || 0;

    // Total Nominal Summary
    const sumSql = `
      SELECT COALESCE(SUM(ft.amount), 0) as total_amount
      FROM fund_transfers ft
      JOIN bank_accounts from_ba ON ft.from_bank_account_id = from_ba.id
      JOIN bank_accounts to_ba ON ft.to_bank_account_id = to_ba.id
      ${whereClause}
    `;
    const sumRes = await query(sumSql, params);
    const totalAmount = parseFloat(sumRes[0]?.total_amount || 0);

    // Pagination
    const offset = (Math.max(1, page) - 1) * limit;
    const dataSql = `
      SELECT 
        ft.*,
        from_ba.name as from_bank_account_name,
        from_ba.account_number as from_bank_account_number,
        from_ba.type as from_bank_account_type,
        to_ba.name as to_bank_account_name,
        to_ba.account_number as to_bank_account_number,
        to_ba.type as to_bank_account_type,
        COALESCE(u.name, u.email) as user_name,
        u.email as user_email
      FROM fund_transfers ft
      JOIN bank_accounts from_ba ON ft.from_bank_account_id = from_ba.id
      JOIN bank_accounts to_ba ON ft.to_bank_account_id = to_ba.id
      LEFT JOIN users u ON ft.user_id = u.id
      ${whereClause}
      ORDER BY ft.transfer_date DESC, ft.id DESC
      LIMIT ? OFFSET ?
    `;
    const dataParams = [...params, parseInt(limit), parseInt(offset)];
    const transfers = await query(dataSql, dataParams);

    // Parse lampiran
    transfers.forEach(t => {
      try {
        t.lampiran = t.lampiran ? JSON.parse(t.lampiran) : [];
      } catch (e) {
        t.lampiran = t.lampiran ? [t.lampiran] : [];
      }
    });

    return {
      transfers,
      total,
      totalAmount,
      page: parseInt(page),
      limit: parseInt(limit),
      totalPages: Math.ceil(total / limit)
    };
  }

  static async findById(id) {
    const results = await query(
      `SELECT 
        ft.*,
        from_ba.name as from_bank_account_name,
        from_ba.account_number as from_bank_account_number,
        from_ba.type as from_bank_account_type,
        to_ba.name as to_bank_account_name,
        to_ba.account_number as to_bank_account_number,
        to_ba.type as to_bank_account_type,
        COALESCE(u.name, u.email) as user_name,
        u.email as user_email
      FROM fund_transfers ft
      JOIN bank_accounts from_ba ON ft.from_bank_account_id = from_ba.id
      JOIN bank_accounts to_ba ON ft.to_bank_account_id = to_ba.id
      LEFT JOIN users u ON ft.user_id = u.id
      WHERE ft.id = ?`,
      [id]
    );

    if (results.length === 0) return null;
    const transfer = results[0];

    try {
      transfer.lampiran = transfer.lampiran ? JSON.parse(transfer.lampiran) : [];
    } catch (e) {
      transfer.lampiran = transfer.lampiran ? [transfer.lampiran] : [];
    }

    // Fetch audit histories
    const histories = await query(
      `SELECT 
        fth.*,
        COALESCE(u.name, u.email) as user_name,
        u.email as user_email
      FROM fund_transfer_histories fth
      LEFT JOIN users u ON fth.user_id = u.id
      WHERE fth.fund_transfer_id = ?
      ORDER BY fth.created_at DESC`,
      [id]
    );

    histories.forEach(h => {
      try {
        h.old_data = h.old_data ? (typeof h.old_data === 'string' ? JSON.parse(h.old_data) : h.old_data) : null;
      } catch (e) {}
      try {
        h.new_data = h.new_data ? (typeof h.new_data === 'string' ? JSON.parse(h.new_data) : h.new_data) : null;
      } catch (e) {}
    });

    transfer.histories = histories;
    return transfer;
  }

  static async create({
    branchId,
    userId,
    fromBankAccountId,
    toBankAccountId,
    amount,
    transferDate,
    note = null,
    lampiran = null
  }) {
    return await dbTransaction(async (conn) => {
      const lampiranStr = Array.isArray(lampiran) ? JSON.stringify(lampiran) : (lampiran || null);

      const [result] = await conn.execute(
        `INSERT INTO fund_transfers (branch_id, user_id, from_bank_account_id, to_bank_account_id, amount, transfer_date, note, lampiran)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [branchId, userId, fromBankAccountId, toBankAccountId, amount, transferDate, note || null, lampiranStr]
      );

      const newId = result.insertId;

      // Log to fund_transfer_histories
      const auditData = {
        from_bank_account_id: fromBankAccountId,
        to_bank_account_id: toBankAccountId,
        amount,
        transfer_date: transferDate,
        note,
        lampiran: lampiranStr
      };

      await conn.execute(
        `INSERT INTO fund_transfer_histories (fund_transfer_id, user_id, action, reason, new_data)
         VALUES (?, ?, 'create', 'Pembuatan pemindahan dana baru', ?)`,
        [newId, userId, JSON.stringify(auditData)]
      );

      return newId;
    });
  }

  static async update(id, {
    fromBankAccountId,
    toBankAccountId,
    amount,
    transferDate,
    note,
    lampiran
  }, userId, reason = 'Pembaruan data pemindahan dana') {
    return await dbTransaction(async (conn) => {
      // 1. Get old data for audit
      const [oldRows] = await conn.execute(
        'SELECT * FROM fund_transfers WHERE id = ?',
        [id]
      );
      if (oldRows.length === 0) {
        throw new Error('Data pemindahan dana tidak ditemukan');
      }
      const oldTransfer = oldRows[0];

      const updates = [];
      const params = [];
      const newAudit = {};
      const oldAudit = {};

      if (fromBankAccountId !== undefined) {
        updates.push('from_bank_account_id = ?');
        params.push(fromBankAccountId);
        newAudit.from_bank_account_id = fromBankAccountId;
        oldAudit.from_bank_account_id = oldTransfer.from_bank_account_id;
      }
      if (toBankAccountId !== undefined) {
        updates.push('to_bank_account_id = ?');
        params.push(toBankAccountId);
        newAudit.to_bank_account_id = toBankAccountId;
        oldAudit.to_bank_account_id = oldTransfer.to_bank_account_id;
      }
      if (amount !== undefined) {
        updates.push('amount = ?');
        params.push(amount);
        newAudit.amount = amount;
        oldAudit.amount = oldTransfer.amount;
      }
      if (transferDate !== undefined) {
        updates.push('transfer_date = ?');
        params.push(transferDate);
        newAudit.transfer_date = transferDate;
        oldAudit.transfer_date = oldTransfer.transfer_date;
      }
      if (note !== undefined) {
        updates.push('note = ?');
        params.push(note);
        newAudit.note = note;
        oldAudit.note = oldTransfer.note;
      }
      if (lampiran !== undefined) {
        const lampiranStr = Array.isArray(lampiran) ? JSON.stringify(lampiran) : lampiran;
        updates.push('lampiran = ?');
        params.push(lampiranStr);
        newAudit.lampiran = lampiranStr;
        oldAudit.lampiran = oldTransfer.lampiran;
      }

      if (updates.length > 0) {
        params.push(id);
        await conn.execute(
          `UPDATE fund_transfers SET ${updates.join(', ')} WHERE id = ?`,
          params
        );

        // Record history
        await conn.execute(
          `INSERT INTO fund_transfer_histories (fund_transfer_id, user_id, action, reason, old_data, new_data)
           VALUES (?, ?, 'update', ?, ?, ?)`,
          [id, userId, reason || 'Update pemindahan dana', JSON.stringify(oldAudit), JSON.stringify(newAudit)]
        );
      }

      return id;
    });
  }

  static async softDelete(id, userId, reason = 'Penghapusan pemindahan dana') {
    return await dbTransaction(async (conn) => {
      const [oldRows] = await conn.execute(
        'SELECT * FROM fund_transfers WHERE id = ?',
        [id]
      );
      if (oldRows.length === 0) {
        throw new Error('Data pemindahan dana tidak ditemukan');
      }
      const oldTransfer = oldRows[0];

      await conn.execute(
        'UPDATE fund_transfers SET status_deleted = 1, deleted_at = CURRENT_TIMESTAMP, deleted_by = ? WHERE id = ?',
        [userId, id]
      );

      // Record history
      await conn.execute(
        `INSERT INTO fund_transfer_histories (fund_transfer_id, user_id, action, reason, old_data)
         VALUES (?, ?, 'delete', ?, ?)`,
        [id, userId, reason || 'Penghapusan pemindahan dana', JSON.stringify(oldTransfer)]
      );

      return true;
    });
  }

  static async getAuditLogs({
    branchId,
    startDate,
    endDate,
    action,
    search,
    page = 1,
    limit = 20
  }) {
    let whereClause = 'WHERE ft.branch_id = ?';
    const params = [branchId];

    if (startDate) {
      whereClause += ' AND DATE(fth.created_at) >= ?';
      params.push(startDate);
    }
    if (endDate) {
      whereClause += ' AND DATE(fth.created_at) <= ?';
      params.push(endDate);
    }
    if (action && action !== 'all') {
      whereClause += ' AND fth.action = ?';
      params.push(action);
    }
    if (search && search.trim()) {
      const q = `%${search.trim()}%`;
      whereClause += ` AND (
        fth.reason LIKE ? OR
        u.name LIKE ? OR
        u.email LIKE ? OR
        from_ba.name LIKE ? OR
        to_ba.name LIKE ? OR
        ft.note LIKE ?
      )`;
      params.push(q, q, q, q, q, q);
    }

    // Count
    const countSql = `
      SELECT COUNT(*) as total
      FROM fund_transfer_histories fth
      JOIN fund_transfers ft ON fth.fund_transfer_id = ft.id
      LEFT JOIN users u ON fth.user_id = u.id
      LEFT JOIN bank_accounts from_ba ON ft.from_bank_account_id = from_ba.id
      LEFT JOIN bank_accounts to_ba ON ft.to_bank_account_id = to_ba.id
      ${whereClause}
    `;
    const countResult = await query(countSql, params);
    const total = countResult[0]?.total || 0;

    // Summary counts by action
    const statsSql = `
      SELECT 
        COUNT(CASE WHEN fth.action = 'create' THEN 1 END) as total_created,
        COUNT(CASE WHEN fth.action = 'update' THEN 1 END) as total_updated,
        COUNT(CASE WHEN fth.action = 'delete' THEN 1 END) as total_deleted
      FROM fund_transfer_histories fth
      JOIN fund_transfers ft ON fth.fund_transfer_id = ft.id
      WHERE ft.branch_id = ?
    `;
    const statsResult = await query(statsSql, [branchId]);
    const stats = statsResult[0] || { total_created: 0, total_updated: 0, total_deleted: 0 };

    // Data query
    const offset = (Math.max(1, page) - 1) * limit;
    const dataSql = `
      SELECT 
        fth.id,
        fth.fund_transfer_id,
        fth.action,
        fth.reason,
        fth.old_data,
        fth.new_data,
        fth.created_at,
        u.id as user_id,
        COALESCE(u.name, u.email) as user_name,
        u.email as user_email,
        u.role as user_role,
        ft.amount as current_amount,
        ft.transfer_date as current_transfer_date,
        ft.note as current_note,
        ft.lampiran as current_lampiran,
        ft.status_deleted,
        from_ba.id as from_bank_account_id,
        from_ba.name as from_bank_account_name,
        from_ba.account_number as from_bank_account_number,
        from_ba.type as from_bank_account_type,
        to_ba.id as to_bank_account_id,
        to_ba.name as to_bank_account_name,
        to_ba.account_number as to_bank_account_number,
        to_ba.type as to_bank_account_type
      FROM fund_transfer_histories fth
      JOIN fund_transfers ft ON fth.fund_transfer_id = ft.id
      LEFT JOIN users u ON fth.user_id = u.id
      LEFT JOIN bank_accounts from_ba ON ft.from_bank_account_id = from_ba.id
      LEFT JOIN bank_accounts to_ba ON ft.to_bank_account_id = to_ba.id
      ${whereClause}
      ORDER BY fth.created_at DESC, fth.id DESC
      LIMIT ? OFFSET ?
    `;
    const logs = await query(dataSql, [...params, parseInt(limit), parseInt(offset)]);

    const allBankAccounts = await query('SELECT id, name, type, account_number FROM bank_accounts WHERE branch_id = ?', [branchId]);
    const bankMap = new Map();
    allBankAccounts.forEach(ba => bankMap.set(ba.id, ba.name));

    logs.forEach(log => {
      try {
        log.old_data = log.old_data ? (typeof log.old_data === 'string' ? JSON.parse(log.old_data) : log.old_data) : null;
      } catch (e) {}
      try {
        log.new_data = log.new_data ? (typeof log.new_data === 'string' ? JSON.parse(log.new_data) : log.new_data) : null;
      } catch (e) {}

      if (log.old_data) {
        if (log.old_data.from_bank_account_id && bankMap.has(log.old_data.from_bank_account_id)) {
          log.old_data.from_bank_name = bankMap.get(log.old_data.from_bank_account_id);
        }
        if (log.old_data.to_bank_account_id && bankMap.has(log.old_data.to_bank_account_id)) {
          log.old_data.to_bank_name = bankMap.get(log.old_data.to_bank_account_id);
        }
        if (typeof log.old_data.lampiran === 'string') {
          try { log.old_data.lampiran = JSON.parse(log.old_data.lampiran); } catch (e) {}
        }
      }
      if (log.new_data) {
        if (log.new_data.from_bank_account_id && bankMap.has(log.new_data.from_bank_account_id)) {
          log.new_data.from_bank_name = bankMap.get(log.new_data.from_bank_account_id);
        }
        if (log.new_data.to_bank_account_id && bankMap.has(log.new_data.to_bank_account_id)) {
          log.new_data.to_bank_name = bankMap.get(log.new_data.to_bank_account_id);
        }
        if (typeof log.new_data.lampiran === 'string') {
          try { log.new_data.lampiran = JSON.parse(log.new_data.lampiran); } catch (e) {}
        }
      }

      if (log.current_lampiran) {
        try { log.current_lampiran = JSON.parse(log.current_lampiran); } catch (e) {}
      }
    });

    return {
      logs,
      total,
      stats: {
        total_created: parseInt(stats.total_created || 0),
        total_updated: parseInt(stats.total_updated || 0),
        total_deleted: parseInt(stats.total_deleted || 0)
      },
      page: parseInt(page),
      limit: parseInt(limit),
      totalPages: Math.ceil(total / limit)
    };
  }
}

module.exports = FundTransfer;
