const { query, transaction: dbTransaction } = require('../config/database');

class Transaction {
  // Find by ID
  static async findById(id, includeDeleted = false) {
    const results = await query(
      `SELECT t.*, c.name as category_name, COALESCE(u.name, u.email) as user_name,
              mp.nama as mitra_piutang_nama
       FROM transactions t
       LEFT JOIN categories c ON t.category_id = c.id
       LEFT JOIN users u ON t.user_id = u.id
       LEFT JOIN mitra_piutang mp ON t.mitra_piutang_id = mp.id
       WHERE t.id = ? ${includeDeleted ? '' : 'AND t.status_deleted = false'}`,
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

    // Fetch savings details
    const savingsDetails = await query(
      `SELECT tsd.*, c.name as category_name
       FROM transaction_savings_details tsd
       JOIN categories c ON tsd.category_id = c.id
       WHERE tsd.transaction_id = ?`,
      [id]
    );
    transaction.savings_details = savingsDetails;

    // Fetch income details
    const incomeDetails = await query(
      `SELECT tid.*, pm.name as payment_method_name
       FROM transaction_income_details tid
       JOIN payment_methods pm ON tid.payment_method_id = pm.id
       WHERE tid.transaction_id = ?`,
      [id]
    );
    transaction.income_details = incomeDetails;

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
    isPb1Payment = undefined,
    paymentMethodId = null,
    paymentMethodCategoryId = null,
    includeIncomeDetails = false
  } = {}) {
    let selectFields = `
      SELECT t.*, c.name as category_name, COALESCE(u.name, u.email) as user_name,
             mp.nama as mitra_piutang_nama,
             tr_notif.transaction_id as parent_transaction_id,
             t_parent.transaction_date as parent_transaction_date,
             COALESCE(tr_sum.total_repayment, 0) as total_repayment,
             /* Standardized dynamic PB1 calculation (10/110) - Using ROUND to match Report logic */
             CASE 
               WHEN t.type = 'income' THEN 
                 COALESCE(
                   (SELECT ROUND(SUM(tid.amount_app) * 10 / 110)
                    FROM transaction_income_details tid
                    JOIN payment_methods pm ON tid.payment_method_id = pm.id
                    WHERE tid.transaction_id = t.id AND pm.is_taxable = 1),
                   t.pb1,
                   0
                 )
               ELSE 0 
             END as pb1
    `;
    let joinDetails = '';
    const params = [];

    const categoryName = (category && typeof category === 'string' && category.trim() !== '') ? category.trim() : null;

    if (categoryName) {
      selectFields += `, 
             /* If filtered by category, use the specific amount from savings details if available */
             CASE 
               WHEN tsd.amount IS NOT NULL THEN tsd.amount 
               ELSE t.amount 
             END as amount`;
      
      joinDetails += ` LEFT JOIN transaction_savings_details tsd ON t.id = tsd.transaction_id AND EXISTS (SELECT 1 FROM categories c2 WHERE c2.id = tsd.category_id AND c2.name = ?)`;
      params.push(categoryName);
    }

    let sql = `
      ${selectFields}
      FROM transactions t
      LEFT JOIN categories c ON t.category_id = c.id
      LEFT JOIN users u ON t.user_id = u.id
      LEFT JOIN mitra_piutang mp ON t.mitra_piutang_id = mp.id
      LEFT JOIN transaction_repayments tr_notif ON t.id = tr_notif.income_transaction_id
      LEFT JOIN transactions t_parent ON tr_notif.transaction_id = t_parent.id
      LEFT JOIN (
        SELECT transaction_id, SUM(amount) as total_repayment 
        FROM transaction_repayments 
        GROUP BY transaction_id
      ) tr_sum ON t.id = tr_sum.transaction_id
      ${joinDetails}
      WHERE 1=1
    `;

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
      sql += ` AND (c.name = ? OR EXISTS (SELECT 1 FROM transaction_savings_details tsd JOIN categories c2 ON tsd.category_id = c2.id WHERE tsd.transaction_id = t.id AND c2.name = ?))`;
      params.push(category.trim(), category.trim());
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
      sql += ` AND (
        t.pb1 > 0 
        OR t.is_pb1_payment = true 
        OR EXISTS (
          SELECT 1 FROM transaction_income_details tid
          JOIN payment_methods pm ON tid.payment_method_id = pm.id
          WHERE tid.transaction_id = t.id AND pm.is_taxable = 1
        )
      )`;
    }

    if (isPb1Payment !== undefined) {
      sql += ' AND t.is_pb1_payment = ?';
      params.push(isPb1Payment === 'true' || isPb1Payment === true || isPb1Payment === 1);
    }

    if (paymentMethodId) {
      sql += ` AND EXISTS (SELECT 1 FROM transaction_income_details tid WHERE tid.transaction_id = t.id AND tid.payment_method_id = ?)`;
      params.push(paymentMethodId);
    }

    if (paymentMethodCategoryId) {
      if (paymentMethodCategoryId === 'null') {
        sql += ` AND EXISTS (
          SELECT 1 FROM transaction_income_details tid 
          JOIN payment_methods pm ON tid.payment_method_id = pm.id 
          WHERE tid.transaction_id = t.id AND pm.category_id IS NULL
        )`;
      } else {
        sql += ` AND EXISTS (
          SELECT 1 FROM transaction_income_details tid 
          JOIN payment_methods pm ON tid.payment_method_id = pm.id 
          WHERE tid.transaction_id = t.id AND pm.category_id = ?
        )`;
        params.push(paymentMethodCategoryId);
      }
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

    const hasInvalidParams = params.some(p => p === undefined || p === null);
    if (hasInvalidParams) {
      console.error('❌ Invalid parameters detected!', params);
      throw new Error('Invalid parameters: undefined or null values detected');
    }

    const transactions = await query(sql, params);

    if (includeIncomeDetails && transactions.length > 0) {
      const transactionIds = transactions.map(t => t.id);
      const placeholders = transactionIds.map(() => '?').join(',');
      const incomeSql = `
        SELECT tid.*, pm.name as payment_method_name, pm.category_id 
        FROM transaction_income_details tid
        LEFT JOIN payment_methods pm ON tid.payment_method_id = pm.id
        WHERE tid.transaction_id IN (${placeholders})
      `;
      const allIncomeDetails = await query(incomeSql, transactionIds);
      
      transactions.forEach(t => {
        t.income_details = allIncomeDetails.filter(d => d.transaction_id === t.id);
      });
    }

    return transactions;
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
    isPb1Payment = undefined,
    paymentMethodId = null,
    paymentMethodCategoryId = null
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
      sql += ` AND (c.name = ? OR EXISTS (SELECT 1 FROM transaction_savings_details tsd JOIN categories c2 ON tsd.category_id = c2.id WHERE tsd.transaction_id = t.id AND c2.name = ?))`;
      params.push(category, category);
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

    if (paymentMethodId) {
      sql += ` AND EXISTS (SELECT 1 FROM transaction_income_details tid WHERE tid.transaction_id = t.id AND tid.payment_method_id = ?)`;
      params.push(paymentMethodId);
    }

    if (paymentMethodCategoryId) {
      if (paymentMethodCategoryId === 'null') {
        sql += ` AND EXISTS (
          SELECT 1 FROM transaction_income_details tid 
          JOIN payment_methods pm ON tid.payment_method_id = pm.id 
          WHERE tid.transaction_id = t.id AND pm.category_id IS NULL
        )`;
      } else {
        sql += ` AND EXISTS (
          SELECT 1 FROM transaction_income_details tid 
          JOIN payment_methods pm ON tid.payment_method_id = pm.id 
          WHERE tid.transaction_id = t.id AND pm.category_id = ?
        )`;
        params.push(paymentMethodCategoryId);
      }
    }

    if (hasPb1) {
      sql += ` AND (
        t.pb1 > 0 
        OR t.is_pb1_payment = true 
        OR EXISTS (
          SELECT 1 FROM transaction_income_details tid
          JOIN payment_methods pm ON tid.payment_method_id = pm.id
          WHERE tid.transaction_id = t.id AND pm.is_taxable = 1
        )
      )`;
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
  static async create({ userId, branchId, type, categoryId, amount, pb1 = null, note, transactionDate, lampiran, isUmum = true, isDebtPayment = false, paidAmount = null, remainingDebt = null, mitraPiutangId = null, mitraDetails = [], savingsDetails = [], incomeDetails = [], isPb1Payment = false }) {
    const transactionId = await dbTransaction(async (conn) => {
      const [result] = await conn.execute(
        `INSERT INTO transactions (user_id, branch_id, type, category_id, amount, pb1, note, transaction_date, lampiran, is_umum, is_debt_payment, is_savings, paid_amount, remaining_debt, mitra_piutang_id, is_pb1_payment, status_deleted)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, false)`,
        [userId, branchId, type, categoryId, amount, pb1, note || null, transactionDate, lampiran || null, isUmum, isDebtPayment, (savingsDetails && savingsDetails.length > 0) || false, paidAmount, remainingDebt, mitraPiutangId, isPb1Payment]
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

      // Insert savings details
      if (savingsDetails && savingsDetails.length > 0) {
        for (const detail of savingsDetails) {
          await conn.execute(
            `INSERT INTO transaction_savings_details (transaction_id, category_id, amount)
             VALUES (?, ?, ?)`,
            [newId, detail.category_id, detail.amount]
          );
        }
      }

      // Insert income details
      if (incomeDetails && incomeDetails.length > 0) {
        for (const detail of incomeDetails) {
          const rowLampiran = detail.lampiran ? (Array.isArray(detail.lampiran) ? JSON.stringify(detail.lampiran) : detail.lampiran) : null;
          await conn.execute(
            `INSERT INTO transaction_income_details (transaction_id, payment_method_id, amount_app, amount_cashier, lampiran)
             VALUES (?, ?, ?, ?, ?)`,
            [newId, detail.payment_method_id, detail.amount_app || 0, detail.amount_cashier || 0, rowLampiran]
          );
        }
      }

      return newId;
    });

    return await this.findById(transactionId);
  }

  // Update transaction
  static async update(id, { type, categoryId, amount, pb1, note, transactionDate, lampiran, isUmum, isDebtPayment, paidAmount, remainingDebt, mitraPiutangId, mitraDetails, savingsDetails, incomeDetails, isPb1Payment }) {
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
      if (savingsDetails !== undefined) {
        updates.push('is_savings = ?');
        params.push(savingsDetails && savingsDetails.length > 0);
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

      // Handle savings details
      if (savingsDetails !== undefined) {
        // Delete old details
        await conn.execute(`DELETE FROM transaction_savings_details WHERE transaction_id = ?`, [id]);

        // Insert new details
        if (savingsDetails && savingsDetails.length > 0) {
          for (const detail of savingsDetails) {
            await conn.execute(
              `INSERT INTO transaction_savings_details (transaction_id, category_id, amount)
               VALUES (?, ?, ?)`,
              [id, detail.category_id, detail.amount]
            );
          }
        }
      }

      // Handle income details
      if (incomeDetails !== undefined) {
        // Delete old details
        await conn.execute(`DELETE FROM transaction_income_details WHERE transaction_id = ?`, [id]);

        // Insert new details
        if (incomeDetails && incomeDetails.length > 0) {
          for (const detail of incomeDetails) {
            const rowLampiran = detail.lampiran ? (Array.isArray(detail.lampiran) ? JSON.stringify(detail.lampiran) : detail.lampiran) : null;
            await conn.execute(
              `INSERT INTO transaction_income_details (transaction_id, payment_method_id, amount_app, amount_cashier, lampiran)
               VALUES (?, ?, ?, ?, ?)`,
              [id, detail.payment_method_id, detail.amount_app || 0, detail.amount_cashier || 0, rowLampiran]
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
       SET edit_reason = ?, edit_requested_by = ?, edit_accepted = 1 
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

  // Request delete (admin only) - set delete_reason and delete_requested_by, delete_accepted = 1 (pengajuan)
  static async requestDelete(id, userId, reason) {
    await query(
      `UPDATE transactions 
       SET delete_reason = ?, delete_requested_by = ?, delete_accepted = 1 
       WHERE id = ? AND status_deleted = false`,
      [reason, userId, id]
    );
    return await this.findById(id);
  }

  // Approve delete request (owner only) - set delete_accepted = 2 (disetujui)
  static async approveDelete(id) {
    await query(
      `UPDATE transactions 
       SET delete_accepted = 2 
       WHERE id = ? AND status_deleted = false`,
      [id]
    );
    return await this.findById(id);
  }

  // Reject delete request (owner only) - set delete_accepted = 3 (ditolak)
  static async rejectDelete(id) {
    await query(
      `UPDATE transactions 
       SET delete_accepted = 3 
       WHERE id = ? AND status_deleted = false`,
      [id]
    );
    return await this.findById(id);
  }

  // Clear delete request
  static async clearDeleteRequest(id) {
    await query(
      `UPDATE transactions 
       SET delete_accepted = 0, delete_reason = NULL, delete_requested_by = NULL 
       WHERE id = ? AND status_deleted = false`,
      [id]
    );
    return await this.findById(id);
  }

  // Soft delete
  static async softDelete(id) {
    const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
    return await dbTransaction(async (conn) => {
      // 1. Get related income transaction IDs from repayments
      const [repayments] = await conn.execute(
        'SELECT income_transaction_id FROM transaction_repayments WHERE transaction_id = ? AND income_transaction_id IS NOT NULL',
        [id]
      );
      const incomeIds = repayments.map(r => r.income_transaction_id);

      // 2. Soft delete the main transaction
      await conn.execute(
        'UPDATE transactions SET status_deleted = true, deleted_at = ? WHERE id = ?',
        [now, id]
      );

      // 3. Soft delete related income transactions (notifications)
      if (incomeIds.length > 0) {
        // Validation: ensure IDs are numbers before joining to prevent SQL injection
        const validIds = incomeIds.filter(id => !isNaN(parseInt(id)));
        if (validIds.length > 0) {
          await conn.execute(
            `UPDATE transactions SET status_deleted = true, deleted_at = ? WHERE id IN (${validIds.join(',')})`,
            [now]
          );
        }
      }

      return { id, deleted_at: now };
    });
  }

  // Restore
  static async restore(id) {
    return await dbTransaction(async (conn) => {
      // 1. Get related income transaction IDs from repayments
      const [repayments] = await conn.execute(
        'SELECT income_transaction_id FROM transaction_repayments WHERE transaction_id = ? AND income_transaction_id IS NOT NULL',
        [id]
      );
      const incomeIds = repayments.map(r => r.income_transaction_id);

      // 2. Restore main transaction
      await conn.execute(
        'UPDATE transactions SET status_deleted = false, deleted_at = NULL WHERE id = ?',
        [id]
      );

      // 3. Restore related income transactions (notifications)
      if (incomeIds.length > 0) {
        const validIds = incomeIds.filter(id => !isNaN(parseInt(id)));
        if (validIds.length > 0) {
          await conn.execute(
            `UPDATE transactions SET status_deleted = false, deleted_at = NULL WHERE id IN (${validIds.join(',')})`
          );
        }
      }

      return await this.findById(id);
    });
  }

  // Hard delete (permanent)
  static async hardDelete(id) {
    return await dbTransaction(async (conn) => {
      // 1. Get related income transaction IDs from repayments
      const [repayments] = await conn.execute(
        'SELECT income_transaction_id FROM transaction_repayments WHERE transaction_id = ? AND income_transaction_id IS NOT NULL',
        [id]
      );
      const incomeIds = repayments.map(r => r.income_transaction_id);

      // 2. Delete main transaction
      // Note: fk_tr_transaction will automatically clean up transaction_repayments records due to ON DELETE CASCADE
      await conn.execute('DELETE FROM transactions WHERE id = ?', [id]);

      // 3. Delete related income transactions (notifications)
      if (incomeIds.length > 0) {
        const validIds = incomeIds.filter(id => !isNaN(parseInt(id)));
        if (validIds.length > 0) {
          await conn.execute(`DELETE FROM transactions WHERE id IN (${validIds.join(',')})`);
        }
      }

      return { id, deleted: true };
    });
  }

  // Get edit requests (for owner: pending requests, for admin: their own requests)
  static async getEditRequests({ userId, branchId, userRole, status }) {
    let sql = `
      SELECT t.*, c.name as category_name,
             COALESCE(ue.name, ud.name) as requester_name, 
             COALESCE(ue.email, ud.email) as requester_email
      FROM transactions t
      LEFT JOIN categories c ON t.category_id = c.id
      LEFT JOIN users ue ON t.edit_requested_by = ue.id
      LEFT JOIN users ud ON t.delete_requested_by = ud.id
      WHERE t.status_deleted = false
      AND (t.edit_requested_by IS NOT NULL OR t.delete_requested_by IS NOT NULL)
    `;
    const params = [];

    // Branch ID filter - if null, filter by user's accessible branches
    if (branchId) {
      sql += ' AND t.branch_id = ?';
      params.push(branchId);
    } else {
      // Retrieve all branches this user has access to (works for owner, co-owner, and admin)
      const Branch = require('./Branch');
      const accessibleBranches = await Branch.findByUserAccess(userId, userRole);
      if (accessibleBranches.length > 0) {
        const branchIds = accessibleBranches.map(b => b.id);
        sql += ` AND t.branch_id IN (${branchIds.map(() => '?').join(',')})`;
        params.push(...branchIds);
      } else {
        // No accessible branches, force empty result
        sql += ' AND 1=0';
      }
    }

    // Filter by status
    // 0 = default, 1 = pengajuan (pending), 2 = disetujui (approved), 3 = ditolak (rejected)
    if (status === 'pending') {
      sql += ' AND (t.edit_accepted = 1 OR t.delete_accepted = 1)';
    } else if (status === 'approved') {
      sql += ' AND (t.edit_accepted = 2 OR t.delete_accepted = 2)';
    } else if (status === 'rejected') {
      sql += ' AND (t.edit_accepted = 3 OR t.delete_accepted = 3)';
    }

    // Role-based filtering
    if (userRole === 'admin') {
      // Admin: only see their own requests
      sql += ' AND (t.edit_requested_by = ? OR t.delete_requested_by = ?)';
      params.push(userId, userId);
    } else if (userRole === 'owner' || userRole === 'co-owner') {
      // Owner and Co-owner: see all requests for their branches (already filtered by branch above)
    }

    // Sort by request date (newest first)
    sql += ' ORDER BY t.updated_at DESC, t.created_at DESC';

    const results = await query(sql, params);

    return results;
  }

  // Get summary for date range
  static async getSummary({ userId, branchId, categoryId, subCategoryId, startDate, endDate, includeDeleted = false, excludeFolders = false, onlyFolders = false, isUmum = undefined }) {
    const params = [];
    
    // Conditionally build portions of the query
    let joinDetails = '';
    let pengeluaranCase = `t.amount`;
    let categoryConditionForIncome = `FALSE`;
    let categoryConditionForExpense = `TRUE`;

    const selectParams = [];
    if (startDate && typeof startDate === 'string' && startDate.includes('-')) {
      const parts = startDate.split('-');
      const startOfMonth = `${parts[0]}-${parts[1]}-01 00:00:00`;
      selectParams.push(startOfMonth);
      selectParams.push(startOfMonth);
    } else {
      selectParams.push(null);
      selectParams.push(null);
    }

    if (categoryId) {
      joinDetails = `
        LEFT JOIN (
          /* Virtual detail amount for specific category summary */
          SELECT transaction_id, category_id, amount FROM transaction_savings_details
        ) tsd_active ON t.id = tsd_active.transaction_id AND (tsd_active.category_id = ? OR EXISTS (SELECT 1 FROM categories c_sub WHERE c_sub.id = tsd_active.category_id AND c_sub.parent_id = ?))
      `;
      params.push(categoryId, categoryId);
      pengeluaranCase = `CASE WHEN tsd_active.amount IS NOT NULL THEN tsd_active.amount ELSE t.amount END`;
      categoryConditionForIncome = `TRUE`;
      categoryConditionForExpense = `FALSE`;
    }

    let sql = `
      SELECT 
        COALESCE(SUM(CASE 
          WHEN t.type = 'income' THEN 
            CASE 
              /* Jika Piutang Utama (ada kategori): Ambil PAID AMOUNT (Nominal terbayar di awal) untuk Omzet Rill */
              WHEN (t.is_debt_payment = 1 OR t.is_debt_payment = true) AND t.category_id IS NOT NULL THEN COALESCE(t.paid_amount, 0)
              
              /* Jika Notifikasi Pelunasan (tanpa kategori): */
              /* Masukkan ke pemasukan HANYA jika pelunasan piutang periode lalu (menambah kas riil periode berjalan) */
              WHEN (t.is_debt_payment = 1 OR t.is_debt_payment = true) AND t.category_id IS NULL THEN
                CASE 
                  WHEN ${startDate ? 't_parent.transaction_date < ?' : 'FALSE'} THEN t.amount
                  ELSE 0
                END
              
              /* Transaksi Normal: Ambil amount penuh */
              ELSE t.amount 
            END
          /* Alokasi Simpanan dari Kas Utama (dianggap pemasukan buat kantong) */
          ${categoryId ? 'WHEN t.type = \'expense\' AND t.is_umum = true THEN COALESCE(tsd_active.amount, t.amount)' : ''}
          ELSE 0 
        END), 0) as pemasukan,
        COALESCE(SUM(CASE 
          WHEN t.type = 'income' AND (t.is_debt_payment = 1 OR t.is_debt_payment = true) AND t.category_id IS NULL AND ${startDate ? 't_parent.transaction_date < ?' : 'FALSE'} THEN t.amount
          ELSE 0
        END), 0) as pelunasan_piutang_lalu,
        COALESCE(SUM(CASE 
          WHEN t.type = 'expense' AND (t.is_umum = false OR ${categoryConditionForExpense}) THEN t.amount
          ELSE 0 
        END), 0) as pengeluaran,
        ROUND(COALESCE(SUM(
          CASE 
            WHEN t.type = 'income' AND (c.name NOT LIKE '%Kas Simpanan%' OR c.name IS NULL) THEN 
              COALESCE(
                (SELECT SUM(tid.amount_app)
                 FROM transaction_income_details tid
                 JOIN payment_methods pm ON tid.payment_method_id = pm.id
                 WHERE tid.transaction_id = t.id AND pm.is_taxable = 1),
                /* Fallback ke kolom pb1 lama dikali 11 (karena pb1 lama itu hasil 10/110, kita butuh nilai taxable-nya buat di-SUM dulu) */
                /* Tapi lebih aman sum pb1 langsung di luar jika tidak ada details */
                t.pb1 * 11, 
                0
              )
            ELSE 0 
          END
        ), 0) * 10 / 110) as total_pb1,
        COALESCE(SUM(CASE WHEN t.type = 'expense' AND t.is_pb1_payment = true THEN t.amount ELSE 0 END), 0) as total_pb1_paid
      FROM transactions t
      LEFT JOIN categories c ON t.category_id = c.id
      /* Join untuk dapet total pelunasan per transaksi */
      LEFT JOIN (
        SELECT transaction_id, SUM(amount) as total_repayment 
        FROM transaction_repayments 
        GROUP BY transaction_id
      ) tr_sum ON t.id = tr_sum.transaction_id
      LEFT JOIN transaction_repayments tr_notif ON t.id = tr_notif.income_transaction_id
      LEFT JOIN transactions t_parent ON tr_notif.transaction_id = t_parent.id
      ${joinDetails}
      WHERE 1=1
    `;

    // User ID
    if (userId) {
      sql += ' AND t.user_id = ?';
      params.push(userId);
    }

    // Branch ID
    if (branchId) {
      sql += ' AND t.branch_id = ?';
      params.push(branchId);
    }

    // Category Filter in WHERE clause
    if (categoryId) {
      if (subCategoryId) {
        sql += ` AND (t.category_id = ? OR tsd_active.category_id = ?)`;
        params.push(subCategoryId, subCategoryId);
      } else {
        sql += ` AND (t.category_id = ? OR c.parent_id = ? OR tsd_active.category_id = ? OR EXISTS (SELECT 1 FROM categories c2 WHERE c2.id = tsd_active.category_id AND c2.parent_id = ?))`;
        params.push(categoryId, categoryId, categoryId, categoryId);
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

    const results = await query(sql, [...selectParams, ...params]);
    const { pemasukan, pelunasan_piutang_lalu, pengeluaran, total_pb1, total_pb1_paid } = results[0];
    const saldo = pemasukan - pengeluaran;
    const saldo_pb1 = (total_pb1 || 0) - (total_pb1_paid || 0);

    return { 
      pemasukan: Number(pemasukan), 
      pelunasan_piutang_lalu: Number(pelunasan_piutang_lalu),
      pengeluaran: Number(pengeluaran), 
      saldo: Number(saldo), 
      total_pb1: Number(total_pb1), 
      total_pb1_paid: Number(total_pb1_paid),
      saldo_pb1: Number(saldo_pb1)
    };
  }
}

module.exports = Transaction;
