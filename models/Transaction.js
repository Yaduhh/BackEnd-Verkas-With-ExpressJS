const { query } = require('../config/database');

class Transaction {
  // Find by ID
  static async findById(id) {
    const results = await query(
      `SELECT t.*, c.name as category_name, c.type as category_type
       FROM transactions t
       JOIN categories c ON t.category_id = c.id
       WHERE t.id = ? AND t.status_deleted = false`,
      [id]
    );
    return results[0] || null;
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
    limit = 20
  } = {}) {
    let sql = `
      SELECT t.*, c.name as category_name, c.type as category_type
      FROM transactions t
      JOIN categories c ON t.category_id = c.id
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
    onlyDeleted = false
  } = {}) {
    let sql = `
      SELECT COUNT(*) as total
      FROM transactions t
      JOIN categories c ON t.category_id = c.id
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
    
    const results = await query(sql, params);
    return results[0].total;
  }
  
  // Create transaction
  static async create({ userId, branchId, type, categoryId, amount, note, transactionDate, lampiran }) {
    const result = await query(
      `INSERT INTO transactions (user_id, branch_id, type, category_id, amount, note, transaction_date, lampiran, status_deleted)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, false)`,
      [userId, branchId, type, categoryId, amount, note || null, transactionDate, lampiran || null]
    );
    return await this.findById(result.insertId);
  }
  
  // Update transaction
  static async update(id, { type, categoryId, amount, note, transactionDate, lampiran }) {
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
    
    if (updates.length === 0) return await this.findById(id);
    
    params.push(id);
    await query(
      `UPDATE transactions SET ${updates.join(', ')} WHERE id = ? AND status_deleted = false`,
      params
    );
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
      SELECT t.*, c.name as category_name, c.type as category_type,
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
  static async getSummary({ userId, branchId, startDate, endDate, includeDeleted = false }) {
    let sql = `
      SELECT 
        COALESCE(SUM(CASE WHEN type = 'income' THEN amount ELSE 0 END), 0) as pemasukan,
        COALESCE(SUM(CASE WHEN type = 'expense' THEN amount ELSE 0 END), 0) as pengeluaran
      FROM transactions
      WHERE 1=1
    `;
    const params = [];
    
    // User ID is optional (for dashboard, we want all users in branch)
    if (userId) {
      sql += ' AND user_id = ?';
      params.push(userId);
    }
    
    // Branch ID is required for data isolation
    if (branchId) {
      sql += ' AND branch_id = ?';
      params.push(branchId);
    }
    
    if (!includeDeleted) {
      sql += ' AND status_deleted = false';
    }
    
    if (startDate) {
      sql += ' AND DATE(transaction_date) >= ?';
      params.push(startDate);
    }
    
    if (endDate) {
      sql += ' AND DATE(transaction_date) <= ?';
      params.push(endDate);
    }
    
    const results = await query(sql, params);
    const { pemasukan, pengeluaran } = results[0];
    const saldo = pemasukan - pengeluaran;
    
    return { pemasukan, pengeluaran, saldo };
  }
}

module.exports = Transaction;

