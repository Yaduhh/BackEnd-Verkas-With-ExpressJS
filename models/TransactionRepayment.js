const { query } = require('../config/database');

class TransactionRepayment {
    static async create({ transactionId, mitraPiutangId, userId, amount, paymentDate, note, lampiran }) {
        const results = await query(
            `INSERT INTO transaction_repayments (transaction_id, mitra_piutang_id, user_id, amount, payment_date, note, lampiran)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [transactionId, mitraPiutangId, userId, amount, paymentDate, note || null, lampiran || null]
        );

        return results.insertId;
    }

    static async findByTransactionId(transactionId) {
        return await query(
            `SELECT tr.*, mp.nama as mitra_nama, COALESCE(u.name, u.email) as user_name
       FROM transaction_repayments tr
       JOIN mitra_piutang mp ON tr.mitra_piutang_id = mp.id
       JOIN users u ON tr.user_id = u.id
       WHERE tr.transaction_id = ?
       ORDER BY tr.payment_date DESC, tr.created_at DESC`,
            [transactionId]
        );
    }

    static async findById(id) {
        const results = await query(
            `SELECT tr.*, mp.nama as mitra_nama, COALESCE(u.name, u.email) as user_name
       FROM transaction_repayments tr
       JOIN mitra_piutang mp ON tr.mitra_piutang_id = mp.id
       JOIN users u ON tr.user_id = u.id
       WHERE tr.id = ?`,
            [id]
        );
        return results[0] || null;
    }

    static async update(id, { amount, paymentDate, note, lampiran }) {
        await query(
            `UPDATE transaction_repayments 
       SET amount = ?, payment_date = ?, note = ?, lampiran = ?
       WHERE id = ?`,
            [amount, paymentDate, note || null, lampiran || null, id]
        );
    }

    static async delete(id) {
        await query(`DELETE FROM transaction_repayments WHERE id = ?`, [id]);
    }
}

module.exports = TransactionRepayment;
