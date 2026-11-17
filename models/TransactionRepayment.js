const { query } = require('../config/database');

let softDeleteColumnsReady = false;

class TransactionRepayment {
    static async ensureSoftDeleteColumns() {
        if (softDeleteColumnsReady) return;
        try {
            const cols = await query(
                `SELECT COLUMN_NAME
                 FROM INFORMATION_SCHEMA.COLUMNS
                 WHERE TABLE_SCHEMA = DATABASE()
                   AND TABLE_NAME = 'transaction_repayments'
                   AND COLUMN_NAME IN ('deleted_at', 'deleted_by')`
            );
            const existing = new Set(cols.map((c) => c.COLUMN_NAME));
            if (!existing.has('deleted_at')) {
                await query(`ALTER TABLE transaction_repayments ADD COLUMN deleted_at DATETIME NULL DEFAULT NULL`);
            }
            if (!existing.has('deleted_by')) {
                await query(`ALTER TABLE transaction_repayments ADD COLUMN deleted_by INT NULL DEFAULT NULL`);
            }
            softDeleteColumnsReady = true;
        } catch (err) {
            console.error('Error ensuring soft delete columns on transaction_repayments:', err);
        }
    }

    static async create({ transactionId, mitraPiutangId, userId, amount, paymentDate, note, lampiran }) {
        const results = await query(
            `INSERT INTO transaction_repayments (transaction_id, mitra_piutang_id, user_id, amount, payment_date, note, lampiran)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [transactionId, mitraPiutangId, userId, amount, paymentDate, note || null, lampiran || null]
        );

        return results.insertId;
    }

    static async findByTransactionId(transactionId) {
        await TransactionRepayment.ensureSoftDeleteColumns();
        return await query(
            `SELECT tr.*, mp.nama as mitra_nama, COALESCE(u.name, u.email) as user_name
       FROM transaction_repayments tr
       JOIN mitra_piutang mp ON tr.mitra_piutang_id = mp.id
       JOIN users u ON tr.user_id = u.id
       WHERE tr.transaction_id = ? AND tr.deleted_at IS NULL
       ORDER BY tr.payment_date DESC, tr.created_at DESC`,
            [transactionId]
        );
    }

    static async findById(id) {
        await TransactionRepayment.ensureSoftDeleteColumns();
        const results = await query(
            `SELECT tr.*, mp.nama as mitra_nama, COALESCE(u.name, u.email) as user_name,
                    t_inc.bank_account_id, ba.name as bank_account_name
       FROM transaction_repayments tr
       JOIN mitra_piutang mp ON tr.mitra_piutang_id = mp.id
       JOIN users u ON tr.user_id = u.id
       LEFT JOIN transactions t_inc ON tr.income_transaction_id = t_inc.id
       LEFT JOIN bank_accounts ba ON t_inc.bank_account_id = ba.id
       WHERE tr.id = ? AND tr.deleted_at IS NULL`,
            [id]
        );
        return results[0] || null;
    }

    static async update(id, { amount, paymentDate, note, lampiran }) {
        await query(
            `UPDATE transaction_repayments 
       SET amount = ?, payment_date = ?, note = ?, lampiran = ?
       WHERE id = ? AND deleted_at IS NULL`,
            [amount, paymentDate, note || null, lampiran || null, id]
        );
    }

    static async delete(id, deletedBy = null) {
        await TransactionRepayment.ensureSoftDeleteColumns();
        await query(
            `UPDATE transaction_repayments SET deleted_at = NOW(), deleted_by = ? WHERE id = ? AND deleted_at IS NULL`,
            [deletedBy, id]
        );
    }
}

module.exports = TransactionRepayment;
