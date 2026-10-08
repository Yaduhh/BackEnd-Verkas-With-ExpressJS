const { query } = require('../config/database');

class TransactionRefund {
  static async create({ transactionId, userId, amount, refundDate, note, lampiran }) {
    const results = await query(
      `INSERT INTO transaction_refunds (transaction_id, user_id, amount, refund_date, note, lampiran)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [transactionId, userId, amount, refundDate, note || null, lampiran || null]
    );

    return results.insertId;
  }

  static async findByTransactionId(transactionId) {
    return await query(
      `SELECT tr.*, COALESCE(u.name, u.email) as user_name
       FROM transaction_refunds tr
       JOIN users u ON tr.user_id = u.id
       WHERE tr.transaction_id = ?
       ORDER BY tr.refund_date DESC, tr.created_at DESC`,
      [transactionId]
    );
  }

  static async findById(id) {
    const results = await query(
      `SELECT tr.*, COALESCE(u.name, u.email) as user_name
       FROM transaction_refunds tr
       JOIN users u ON tr.user_id = u.id
       WHERE tr.id = ?`,
      [id]
    );
    return results[0] || null;
  }

  static async update(id, { amount, refundDate, note, lampiran }) {
    await query(
      `UPDATE transaction_refunds 
       SET amount = ?, refund_date = ?, note = ?, lampiran = ?
       WHERE id = ?`,
      [amount, refundDate, note || null, lampiran || null, id]
    );
  }

  static async delete(id) {
    await query(`DELETE FROM transaction_refunds WHERE id = ?`, [id]);
  }
}

module.exports = TransactionRefund;
