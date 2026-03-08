const { query, transaction: dbTransaction } = require('../config/database');

class Transaction {
  // Find by ID
  static async findById(id) {
    const results = await query(
      `SELECT t.*, c.name as category_name, COALESCE(u.name, u.email) as user_name,
              mp.nama as mitra_piutang_nama
       FROM transactions t
       LEFT JOIN categories c ON t.category_id = c.id
       LEFT JOIN users u ON t.user_id = u.id
       LEFT JOIN mitra_piutang mp ON t.mitra_piutang_id = mp.id
       WHERE t.id = ? AND t.status_deleted = false`,
      [id]
    );

    if (results.length === 0) return null;

    const transaction = results[0];

    // Fetch multi-mitra details
    const mitraDetails = await query(
      `SELECT tmd.*, mp.nama as mitra_nama
       FROM transaction_mitra_details tmd
       JOIN mitra_piutang mp ON tmd.mitra_piutang_id = mp.id
       WHERE tmd.transaction_id = ?`,
      [id]
    );

    transaction.mitra_details = mitraDetails;

    // SYNC: If it's a debt payment but has no multi-mitra details,
    // synthesize a virtual detail from the main transaction fields
    // to ensure Repayment (Pelunasan) and UI logic work as expected.
    if (transaction.is_debt_payment && transaction.mitra_piutang_id && mitraDetails.length === 0) {
      transaction.mitra_details = [{
        transaction_id: transaction.id,
        mitra_piutang_id: transaction.mitra_piutang_id,
        mitra_nama: transaction.mitra_piutang_nama,
        amount: transaction.amount,
        paid_amount: transaction.paid_amount || 0,
        remaining_debt: transaction.remaining_debt || 0
      }];
    }

    // Fetch repayments
    const repayments = await query(
      `SELECT tr.*, mp.nama as mitra_nama, COALESCE(u.name, u.email) as user_name
       FROM transaction_repayments tr
       JOIN mitra_piutang mp ON tr.mitra_piutang_id = mp.id
       LEFT JOIN users u ON tr.user_id = u.id
       WHERE tr.transaction_id = ?
       ORDER BY tr.payment_date DESC, tr.created_at DESC`,
      [id]
    );
    transaction.repayments = repayments;

    return transaction;
  }

  // Find all (with filters)
  static async findAll({
    userId,
    branchId,  // Required for branch isolation
    type,
    category,
    startDate,
    endDate,
    sort = 'terbaru',
    includeDeleted = false,
    onlyDeleted = false,
    page = 1,
    limit = 20,
    excludeFolders = false,
    onlyFolders = false,
    isUmum = undefined,
    mitraPiutangId = null,
    hasPb1 = false,
    isPb1Payment = undefined
  } = {}) {
    let sql = `
      SELECT t.*, c.name as category_name, COALESCE(u.name, u.email) as user_name,
             mp.nama as mitra_piutang_nama,
             tr_notif.transaction_id as parent_transaction_id
      FROM transactions t
      LEFT JOIN categories c ON t.category_id = c.id
      LEFT JOIN users u ON t.user_id = u.id
      LEFT JOIN mitra_piutang mp ON t.mitra_piutang_id = mp.id
      LEFT JOIN transaction_repayments tr_notif ON t.id = tr_notif.income_transaction_id
      WHERE 1=1
    `;
    const params = [];

    // Branch ID is required for data isolation - ensure it's a valid integer
    if (branchId === undefined || branchId === null) {
      throw new Error('Branch ID is required for Transaction.findAll');
    }
    const validBranchId = parseInt(branchId);
    if (isNaN(validBranchId) || validBranchId <= 0) {
      throw new Error(`Invalid Branch ID: ${branchId}`);
    }
    sql += ' AND t.branch_id = ?';
    params.push(validBranchId);

    if (userId !== undefined && userId !== null) {
      const validUserId = parseInt(userId);
      if (!isNaN(validUserId)) {
        sql += ' AND t.user_id = ?';
        params.push(validUserId);
      }
    }

    if (!includeDeleted && !onlyDeleted) {
      sql += ' AND t.status_deleted = false';
    } else if (onlyDeleted) {
      sql += ' AND t.status_deleted = true';
    }

    if (type && typeof type === 'string' && type.trim() !== '') {
      sql += ' AND t.type = ?';
      params.push(type.trim());
    }

    if (category && typeof category === 'string' && category.trim() !== '') {
      sql += ' AND c.name = ?';
      params.push(category.trim());
    }

    if (startDate && typeof startDate === 'string' && startDate.trim() !== '') {
      // Use simple date comparison without CAST for better compatibility
      sql += ' AND t.transaction_date >= ?';
      params.push(startDate.trim() + ' 00:00:00');
    }

    if (endDate && typeof endDate === 'string' && endDate.trim() !== '') {
      // Use simple date comparison without CAST for better compatibility
      sql += ' AND t.transaction_date <= ?';
      params.push(endDate.trim() + ' 23:59:59');
    }

    if (isUmum !== undefined) {
      sql += ' AND t.is_umum = ?';
      params.push(isUmum === 'true' || isUmum === true || isUmum === 1);
    } else if (excludeFolders) {
      // User requested everything in dashboard, including internal folder transactions
      // So we don't apply the is_umum = true filter here anymore
    } else if (onlyFolders) {
      sql += ' AND t.is_umum = false';
    }

    if (mitraPiutangId !== null && mitraPiutangId !== undefined) {
      sql += ` AND (t.mitra_piutang_id = ? OR EXISTS (SELECT 1 FROM transaction_mitra_details tmd WHERE tmd.transaction_id = t.id AND tmd.mitra_piutang_id = ?))`;
      params.push(mitraPiutangId, mitraPiutangId);
    }

    if (hasPb1) {
      sql += ' AND (t.pb1 > 0 OR t.is_pb1_payment = true)';
    }

    if (isPb1Payment !== undefined) {
      sql += ' AND t.is_pb1_payment = ?';
      params.push(isPb1Payment === 'true' || isPb1Payment === true || isPb1Payment === 1);
    }

    // Sort
    if (sort === 'terbaru') {
      sql += ' ORDER BY t.transaction_date DESC, t.created_at DESC';
    } else {
      sql += ' ORDER BY t.transaction_date ASC, t.created_at ASC';
    }

    // Pagination - ensure limit and offset are valid integers
    const validLimit = parseInt(limit);
    const validPage = parseInt(page);
    const finalLimit = (!isNaN(validLimit) && validLimit > 0) ? validLimit : 20;
    const finalPage = (!isNaN(validPage) && validPage > 0) ? validPage : 1;
    const offset = (finalPage - 1) * finalLimit;

    // Use string interpolation for LIMIT/OFFSET since they're validated integers
    // This avoids issues with prepared statements and LIMIT/OFFSET in some MySQL versions
    sql += ` LIMIT ${finalLimit} OFFSET ${offset}`;

    // Ensure params array matches number of placeholders
    const placeholderCount = (sql.match(/\?/g) || []).length;
    if (params.length !== placeholderCount) {
      console.error('❌ Parameter mismatch!', {
        sql: sql.replace(/\s+/g, ' ').trim(),
        params,
        paramsCount: params.length,
        placeholderCount
      });
      throw new Error(`Parameter count mismatch: ${params.length} params but ${placeholderCount} placeholders`);
    }

    // Check for undefined/null values
    const hasInvalidParams = params.some(p => p === undefined || p === null);
    if (hasInvalidParams) {
      console.error('❌ Invalid parameters detected!', params);
      throw new Error('Invalid parameters: undefined or null values detected');
    }

    return await query(sql, params);
  }

  // Count total (for pagination)
  static async count({
    userId,
    branchId,  // Required for branch isolation
    type,
    category,
    startDate,
    endDate,
    includeDeleted = false,
    onlyDeleted = false,
    excludeFolders = false,
    onlyFolders = false,
    isUmum = undefined,
    mitraPiutangId = null,
    hasPb1 = false,
    isPb1Payment = undefined
  } = {}) {
    let sql = `
      SELECT COUNT(*) as total
      FROM transactions t
      LEFT JOIN categories c ON t.category_id = c.id
      WHERE 1=1
    `;
    const params = [];

    // Branch ID is required for data isolation
    if (branchId) {
      sql += ' AND t.branch_id = ?';
      params.push(branchId);
    }

    if (userId) {
      sql += ' AND t.user_id = ?';
      params.push(userId);
    }

    if (!includeDeleted && !onlyDeleted) {
      sql += ' AND t.status_deleted = false';
    } else if (onlyDeleted) {
      sql += ' AND t.status_deleted = true';
    }

    if (type) {
      sql += ' AND t.type = ?';
      params.push(type);
    }

    if (category) {
      sql += ' AND c.name = ?';
      params.push(category);
    }

    if (startDate) {
      sql += ' AND DATE(t.transaction_date) >= ?';
      params.push(startDate);
    }

    if (endDate) {
      sql += ' AND DATE(t.transaction_date) <= ?';
      params.push(endDate);
    }

    if (isUmum !== undefined) {
      sql += ' AND t.is_umum = ?';
      params.push(isUmum === 'true' || isUmum === true || isUmum === 1);
    } else if (excludeFolders) {
      // User requested everything in dashboard
    } else if (onlyFolders) {
      sql += ' AND t.is_umum = false';
    }

    if (mitraPiutangId !== null && mitraPiutangId !== undefined) {
      sql += ` AND (t.mitra_piutang_id = ? OR EXISTS (SELECT 1 FROM transaction_mitra_details tmd WHERE tmd.transaction_id = t.id AND tmd.mitra_piutang_id = ?))`;
      params.push(mitraPiutangId, mitraPiutangId);
    }

    if (hasPb1) {
      sql += ' AND (t.pb1 > 0 OR t.is_pb1_payment = true)';
    }

    if (isPb1Payment !== undefined) {
      sql += ' AND t.is_pb1_payment = ?';
      params.push(isPb1Payment === 'true' || isPb1Payment === true || isPb1Payment === 1);
    }

    const results = await query(sql, params);
    return results[0].total;
  }

  // Create transaction
  // Create transaction
  static async create({ userId, branchId, type, categoryId, amount, pb1 = null, note, transactionDate, lampiran, isUmum = true, isDebtPayment = false, paidAmount = null, remainingDebt = null, mitraPiutangId = null, mitraDetails = [], isPb1Payment = false }) {
    const transactionId = await dbTransaction(async (conn) => {
      const [result] = await conn.execute(
        `INSERT INTO transactions (user_id, branch_id, type, category_id, amount, pb1, note, transaction_date, lampiran, is_umum, is_debt_payment, paid_amount, remaining_debt, mitra_piutang_id, is_pb1_payment, status_deleted)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, false)`,
        [userId, branchId, type, categoryId, amount, pb1, note || null, transactionDate, lampiran || null, isUmum, isDebtPayment, paidAmount, remainingDebt, mitraPiutangId, isPb1Payment]
      );

      const newId = result.insertId;

      // Insert multi-mitra details
      if ((isDebtPayment === true || isDebtPayment === 1) && mitraDetails && mitraDetails.length > 0) {
        for (const detail of mitraDetails) {
          await conn.execute(
            `INSERT INTO transaction_mitra_details (transaction_id, mitra_piutang_id, amount, paid_amount, remaining_debt)
             VALUES (?, ?, ?, ?, ?)`,
            [newId, detail.mitra_piutang_id, detail.amount, detail.paid_amount || 0, detail.remaining_debt || 0]
          );
        }
      }

      return newId;
    });

    return await this.findById(transactionId);
  }

  // Update transaction
  static async update(id, { type, categoryId, amount, pb1, note, transactionDate, lampiran, isUmum, isDebtPayment, paidAmount, remainingDebt, mitraPiutangId, mitraDetails, isPb1Payment }) {
    await dbTransaction(async (conn) => {
      const updates = [];
      const params = [];

      if (type !== undefined) {
        updates.push('type = ?');
        params.push(type);
      }
      if (categoryId !== undefined) {
        updates.push('category_id = ?');
        params.push(categoryId);
      }
      if (amount !== undefined) {
        updates.push('amount = ?');
        params.push(amount);
      }
      if (pb1 !== undefined) {
        updates.push('pb1 = ?');
        params.push(pb1);
      }
      if (note !== undefined) {
        updates.push('note = ?');
        params.push(note);
      }
      if (transactionDate !== undefined) {
        updates.push('transaction_date = ?');
        params.push(transactionDate);
      }
      if (lampiran !== undefined) {
        updates.push('lampiran = ?');
        params.push(lampiran || null);
      }
      if (isUmum !== undefined) {
        updates.push('is_umum = ?');
        params.push(isUmum);
      }
      if (isDebtPayment !== undefined) {
        updates.push('is_debt_payment = ?');
        params.push(isDebtPayment);
      }
      if (paidAmount !== undefined) {
        updates.push('paid_amount = ?');
        params.push(paidAmount);
      }
      if (remainingDebt !== undefined) {
        updates.push('remaining_debt = ?');
        params.push(remainingDebt);
      }
      if (mitraPiutangId !== undefined) {
        updates.push('mitra_piutang_id = ?');
        params.push(mitraPiutangId);
      }
      if (isPb1Payment !== undefined) {
        updates.push('is_pb1_payment = ?');
        params.push(isPb1Payment === true || isPb1Payment === 'true' || isPb1Payment === 1);
      }

      if (updates.length > 0) {
        params.push(id);
        await conn.execute(
          `UPDATE transactions SET ${updates.join(', ')} WHERE id = ? AND status_deleted = false`,
          params
        );
      }

      // Handle multi-mitra details
      if (mitraDetails !== undefined) {
        // Delete old details
        await conn.execute(`DELETE FROM transaction_mitra_details WHERE transaction_id = ?`, [id]);

        // Insert new details if isDebtPayment is true
        if ((isDebtPayment === true || isDebtPayment === 1) && mitraDetails && mitraDetails.length > 0) {
          for (const detail of mitraDetails) {
            await conn.execute(
              `INSERT INTO transaction_mitra_details (transaction_id, mitra_piutang_id, amount, paid_amount, remaining_debt)
               VALUES (?, ?, ?, ?, ?)`,
              [id, detail.mitra_piutang_id, detail.amount, detail.paid_amount || 0, detail.remaining_debt || 0]
            );
          }
        }
      }
    });

    return await this.findById(id);
  }

  // Request edit (admin only) - set edit_reason and edit_requested_by, edit_accepted = 1 (pengajuan)
  static async requestEdit(id, userId, reason) {
    await query(
      `UPDATE transactions 
       SET edit_reason = ?, edit_requested_by = ?, edit_accepted = 2 
       WHERE id = ? AND status_deleted = false`,
      [reason, userId, id]
    );
    return await this.findById(id);
  }

  // Approve edit request (owner only) - set edit_accepted = 2 (disetujui)
  static async approveEdit(id) {
    await query(
      `UPDATE transactions 
       SET edit_accepted = 2 
       WHERE id = ? AND status_deleted = false`,
      [id]
    );
    return await this.findById(id);
  }

  // Reject edit request (owner only) - set edit_accepted = 3 (ditolak), tetap simpan reason untuk history
  static async rejectEdit(id) {
    await query(
      `UPDATE transactions 
       SET edit_accepted = 3 
       WHERE id = ? AND status_deleted = false`,
      [id]
    );
    return await this.findById(id);
  }

  // Clear edit request after successful edit - reset ke 0 (default)
  static async clearEditRequest(id) {
    await query(
      `UPDATE transactions 
       SET edit_accepted = 0, edit_reason = NULL, edit_requested_by = NULL 
       WHERE id = ? AND status_deleted = false`,
      [id]
    );
    return await this.findById(id);
  }

  // Soft delete
  static async softDelete(id) {
    const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
    await query(
      'UPDATE transactions SET status_deleted = true, deleted_at = ? WHERE id = ?',
      [now, id]
    );
    return { id, deleted_at: now };
  }

  // Restore
  static async restore(id) {
    await query(
      'UPDATE transactions SET status_deleted = false, deleted_at = NULL WHERE id = ?',
      [id]
    );
    return await this.findById(id);
  }

  // Hard delete (permanent)
  static async hardDelete(id) {
    await query('DELETE FROM transactions WHERE id = ?', [id]);
    return { id, deleted: true };
  }

  // Get edit requests (for owner: pending requests, for admin: their own requests)
  static async getEditRequests({ userId, branchId, userRole, status }) {
    let sql = `
      SELECT t.*, c.name as category_name,
             u.name as requester_name, u.email as requester_email
      FROM transactions t
      JOIN categories c ON t.category_id = c.id
      LEFT JOIN users u ON t.edit_requested_by = u.id
      WHERE t.status_deleted = false
      AND t.edit_requested_by IS NOT NULL
    `;
    const params = [];

    // Branch ID filter - if null, filter by user's accessible branches
    if (branchId) {
      sql += ' AND t.branch_id = ?';
      params.push(branchId);
    } else {
      // If no branchId, filter by user's accessible branches
      if (userRole === 'owner') {
        // Owner: get all branches they own
        sql += ` AND t.branch_id IN (
          SELECT id FROM branches WHERE owner_id = ? AND status_deleted = false
        )`;
        params.push(userId);
      } else if (userRole === 'admin') {
        // Admin: get branches where they are PIC
        sql += ` AND t.branch_id IN (
          SELECT id FROM branches WHERE pic_id = ? AND status_deleted = false
        )`;
        params.push(userId);
      }
    }

    // Filter by status
    // 0 = default, 1 = pengajuan (pending), 2 = disetujui (approved), 3 = ditolak (rejected)
    if (status === 'pending') {
      sql += ' AND t.edit_accepted = 1';
    } else if (status === 'approved') {
      sql += ' AND t.edit_accepted = 2';
    } else if (status === 'rejected') {
      sql += ' AND t.edit_accepted = 3';
    }

    // Role-based filtering
    if (userRole === 'admin') {
      // Admin: only see their own requests
      sql += ' AND t.edit_requested_by = ?';
      params.push(userId);
    } else if (userRole === 'owner') {
      // Owner: see all requests for their branches (already filtered by branch above)
    }

    // Sort by request date (newest first)
    sql += ' ORDER BY t.updated_at DESC, t.created_at DESC';

    return await query(sql, params);
  }

  // Get summary for date range
  static async getSummary({ userId, branchId, categoryId, subCategoryId, startDate, endDate, includeDeleted = false, excludeFolders = false, onlyFolders = false, isUmum = undefined }) {
    let sql = `
      SELECT 
        COALESCE(SUM(CASE 
          WHEN t.type = 'income' THEN 
            CASE 
              /* Jika Piutang Utama (ada kategori): Ambil jumlah yang sudah dibayar (paid_amount) */
              WHEN (t.is_debt_payment = 1 OR t.is_debt_payment = true) AND t.category_id IS NOT NULL THEN COALESCE(t.paid_amount, 0)
              /* Jika Notifikasi Pelunasan (tanpa kategori): Jangan dihitung lagi (0) karena sudah masuk di paid_amount Piutang Utama */
              WHEN (t.is_debt_payment = 1 OR t.is_debt_payment = true) AND t.category_id IS NULL THEN 0
              /* Transaksi Normal: Ambil amount penuh */
              ELSE t.amount 
            END
          WHEN t.type = 'expense' AND t.is_umum = true AND ${categoryId ? 'TRUE' : 'FALSE'} THEN t.amount
          ELSE 0 
        END), 0) as pemasukan,
        COALESCE(SUM(CASE 
          WHEN t.type = 'expense' AND (t.is_umum = false OR ${categoryId ? 'FALSE' : 'TRUE'}) THEN t.amount 
          ELSE 0 
        END), 0) as pengeluaran,
        COALESCE(SUM(t.pb1), 0) as total_pb1,
        COALESCE(SUM(CASE WHEN t.type = 'expense' AND t.is_pb1_payment = true THEN t.amount ELSE 0 END), 0) as total_pb1_paid
      FROM transactions t
      LEFT JOIN categories c ON t.category_id = c.id
      WHERE 1=1
    `;
    const params = [];

    // User ID is optional (for dashboard, we want all users in branch)
    if (userId) {
      sql += ' AND t.user_id = ?';
      params.push(userId);
    }

    // Branch ID is required for data isolation
    if (branchId) {
      sql += ' AND t.branch_id = ?';
      params.push(branchId);
    }

    // Category ID filter (including sub-categories if needed)
    if (categoryId) {
      if (subCategoryId) {
        // Specific sub-category
        sql += ' AND t.category_id = ?';
        params.push(subCategoryId);
      } else {
        // All transactions in parent category or specific category
        sql += ' AND (t.category_id = ? OR c.parent_id = ?)';
        params.push(categoryId, categoryId);
      }
    }

    if (!includeDeleted) {
      sql += ' AND t.status_deleted = false';
    }

    if (startDate) {
      sql += ' AND DATE(t.transaction_date) >= ?';
      params.push(startDate);
    }

    if (endDate) {
      sql += ' AND DATE(t.transaction_date) <= ?';
      params.push(endDate);
    }

    if (isUmum !== undefined) {
      sql += ' AND t.is_umum = ?';
      params.push(isUmum === 'true' || isUmum === true || isUmum === 1);
    } else if (excludeFolders) {
      sql += ' AND t.is_umum = true';
    } else if (onlyFolders) {
      sql += ' AND t.is_umum = false';
    }

    const results = await query(sql, params);
    const { pemasukan, pengeluaran, total_pb1, total_pb1_paid } = results[0];
    const saldo = pemasukan - pengeluaran;
    const saldo_pb1 = (total_pb1 || 0) - (total_pb1_paid || 0);

    return { pemasukan, pengeluaran, saldo, total_pb1, total_pb1_paid, saldo_pb1 };
  }
}

module.exports = Transaction;

