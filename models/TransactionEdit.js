const { query } = require('../config/database');

class TransactionEdit {
  static async create({ transactionId, requesterId, reason, oldData, newData, status = 'pending' }) {
    const result = await query(
      `INSERT INTO transaction_edits (transaction_id, requester_id, reason, old_data, new_data, status)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [transactionId, requesterId, reason, JSON.stringify(oldData), JSON.stringify(newData), status]
    );
    return result.insertId;
  }

  static async updateStatus(transactionId, status, approverId = null) {
    // Update the latest pending request for this transaction
    await query(
      `UPDATE transaction_edits 
       SET status = ?, approver_id = ?, updated_at = CURRENT_TIMESTAMP
       WHERE transaction_id = ? AND status = 'pending'
       ORDER BY created_at DESC LIMIT 1`,
      [status, approverId, transactionId]
    );
  }

  static async getHistory(transactionId) {
    return await query(
      `SELECT te.*, r.name as requester_name, a.name as approver_name
       FROM transaction_edits te
       JOIN users r ON te.requester_id = r.id
       LEFT JOIN users a ON te.approver_id = a.id
       WHERE te.transaction_id = ?
       ORDER BY te.created_at DESC`,
      [transactionId]
    );
  }
}

module.exports = TransactionEdit;
