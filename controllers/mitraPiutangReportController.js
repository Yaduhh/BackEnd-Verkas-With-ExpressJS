const { query, transaction: dbTransaction } = require('../config/database');
const Branch = require('../models/Branch');
const TransactionRepayment = require('../models/TransactionRepayment');
const TransactionEdit = require('../models/TransactionEdit');
const LogService = require('../services/logService');

const getMitraPiutangReport = async (req, res, next) => {
  try {
    await TransactionRepayment.ensureSoftDeleteColumns();
    const branchId = req.branchId || req.headers['x-branch-id'];
    const { startDate, endDate } = req.query;

    if (!branchId) {
      return res.status(400).json({
        success: false,
        message: 'Branch ID is required. Please provide X-Branch-Id header.'
      });
    }

    // Verify branch access
    const hasAccess = await Branch.userHasAccess(req.userId, parseInt(branchId), req.user.role);
    if (!hasAccess) {
      return res.status(403).json({
        success: false,
        message: 'No access to this branch'
      });
    }

    const params = [parseInt(branchId)];
    let sqlFilters = '';

    if (startDate && endDate) {
      sqlFilters += ' AND DATE(tr.payment_date) >= ? AND DATE(tr.payment_date) <= ?';
      params.push(startDate, endDate);
    }

    // Fetch repayment histories along with original transaction date (tanggal piutang)
    const reportData = await query(
      `SELECT 
        tr.id as repayment_id,
        tr.transaction_id,
        tr.mitra_piutang_id,
        tr.bulk_repayment_id,
        mp.nama as mitra_nama,
        tr.amount as repayment_amount,
        COALESCE(tr.is_writeoff, 0) as is_writeoff,
        DATE_FORMAT(tr.payment_date, '%Y-%m-%d') as payment_date,
        DATE_FORMAT(COALESCE(t.transaction_date, mp.initial_balance_date), '%Y-%m-%d') as transaction_date,
        tr.note,
        COALESCE(u.name, u.email) as user_name,
        COALESCE(
          (
            SELECT SUM(tmd.remaining_debt) 
            FROM transaction_mitra_details tmd 
            WHERE tmd.transaction_id = tr.transaction_id AND tmd.mitra_piutang_id = tr.mitra_piutang_id
          ),
          t.remaining_debt,
          GREATEST(0, COALESCE(mp.initial_balance, 0) - COALESCE(mp.initial_balance_paid, 0)),
          0
        ) as remaining_debt
      FROM transaction_repayments tr
      JOIN mitra_piutang mp ON tr.mitra_piutang_id = mp.id
      LEFT JOIN transactions t ON tr.transaction_id = t.id
      LEFT JOIN users u ON tr.user_id = u.id
      WHERE mp.branch_id = ?
        AND mp.deleted_at IS NULL
        AND tr.deleted_at IS NULL
        AND (t.id IS NULL OR t.status_deleted = false)
        ${sqlFilters}
      ORDER BY tr.payment_date ASC, tr.id ASC`,
      params
    );

    const formattedData = reportData.map(row => {
      return {
        repayment_id: row.repayment_id,
        transaction_id: row.transaction_id,
        mitra_id: row.mitra_piutang_id,
        bulk_repayment_id: row.bulk_repayment_id || null,
        mitra_nama: row.mitra_nama || '-',
        amount: parseFloat(row.repayment_amount) || 0,
        is_writeoff: Boolean(row.is_writeoff),
        payment_date: row.payment_date,
        transaction_date: row.transaction_date,
        note: row.note || '',
        user_name: row.user_name || '-',
        sisa: parseFloat(row.remaining_debt) || 0
      };
    });

    res.json({
      success: true,
      data: { report: formattedData }
    });
  } catch (error) {
    next(error);
  }
};

const deleteMitraRepayment = async (req, res, next) => {
  try {
    await TransactionRepayment.ensureSoftDeleteColumns();
    const { repaymentId } = req.params;
    const branchId = req.branchId || req.headers['x-branch-id'];

    if (!branchId) {
      return res.status(400).json({
        success: false,
        message: 'Branch ID is required. Please provide X-Branch-Id header.'
      });
    }

    if (req.user && req.user.role !== 'owner' && req.user.role !== 'master' && req.user.can_delete === false) {
      return res.status(403).json({
        success: false,
        message: 'Anda tidak memiliki izin untuk menghapus data pelunasan'
      });
    }

    const parsedBranchId = parseInt(branchId, 10);
    const hasAccess = await Branch.userHasAccess(req.userId, parsedBranchId, req.user.role);
    if (!hasAccess) {
      return res.status(403).json({
        success: false,
        message: 'No access to this branch'
      });
    }

    let deletedInfo = null;

    await dbTransaction(async (conn) => {
      const [rows] = await conn.execute(
        `SELECT tr.*, mp.branch_id, mp.nama as mitra_nama
         FROM transaction_repayments tr
         JOIN mitra_piutang mp ON tr.mitra_piutang_id = mp.id
         WHERE tr.id = ? AND mp.branch_id = ? AND tr.deleted_at IS NULL
         FOR UPDATE`,
        [parseInt(repaymentId, 10), parsedBranchId]
      );

      const repayment = rows[0];
      if (!repayment) {
        const notFoundErr = new Error('Data pelunasan tidak ditemukan atau sudah dihapus');
        notFoundErr.statusCode = 404;
        throw notFoundErr;
      }

      const amount = parseFloat(repayment.amount) || 0;
      deletedInfo = {
        id: repayment.id,
        transaction_id: repayment.transaction_id,
        mitra_piutang_id: repayment.mitra_piutang_id,
        mitra_nama: repayment.mitra_nama,
        amount
      };

      // 1. Revert piutang balance (Saldo Awal vs Nota Transaksi)
      if (!repayment.transaction_id) {
        await conn.execute(
          `UPDATE mitra_piutang
           SET initial_balance_paid = GREATEST(0, COALESCE(initial_balance_paid, 0) - ?),
               updated_at = CURRENT_TIMESTAMP
           WHERE id = ? AND branch_id = ?`,
          [amount, repayment.mitra_piutang_id, parsedBranchId]
        );
      } else {
        if (repayment.transaction_mitra_detail_id) {
          await conn.execute(
            `UPDATE transaction_mitra_details
             SET paid_amount = GREATEST(0, paid_amount - ?),
                 remaining_debt = remaining_debt + ?
             WHERE id = ?`,
            [amount, amount, repayment.transaction_mitra_detail_id]
          );
        } else {
          await conn.execute(
            `UPDATE transaction_mitra_details
             SET paid_amount = GREATEST(0, paid_amount - ?),
                 remaining_debt = remaining_debt + ?
             WHERE transaction_id = ? AND mitra_piutang_id = ?`,
            [amount, amount, repayment.transaction_id, repayment.mitra_piutang_id]
          );
        }

        await conn.execute(
          `UPDATE transactions
           SET paid_amount = GREATEST(0, paid_amount - ?),
               remaining_debt = remaining_debt + ?
           WHERE id = ?`,
          [amount, amount, repayment.transaction_id]
        );
      }

      // 2. Revert cash income record ONLY for real cash repayments (NOT write-offs)
      let targetIncomeTx = null;
      if (!repayment.is_writeoff) {
        if (repayment.income_transaction_id) {
          const [incRows] = await conn.execute(
            `SELECT id, amount, paid_amount
             FROM transactions
             WHERE id = ? AND status_deleted = false
             FOR UPDATE`,
            [repayment.income_transaction_id]
          );
          targetIncomeTx = incRows[0] || null;
        } else if (repayment.bulk_repayment_id) {
          const [incRows] = await conn.execute(
            `SELECT id, amount, paid_amount
             FROM transactions
             WHERE branch_id = ?
               AND user_id = ?
               AND is_debt_payment = 1
               AND DATE(transaction_date) = DATE(?)
               AND status_deleted = false
               AND amount >= ?
             ORDER BY id DESC
             LIMIT 1
             FOR UPDATE`,
            [parsedBranchId, repayment.user_id, repayment.payment_date, amount]
          );
          targetIncomeTx = incRows[0] || null;
        }
      }

      if (targetIncomeTx) {
        if (repayment.bulk_repayment_id) {
          const newIncomeAmount = Math.max(0, (parseFloat(targetIncomeTx.amount) || 0) - amount);
          if (newIncomeAmount <= 0) {
            await conn.execute(
              `UPDATE transactions SET status_deleted = 1, amount = 0, paid_amount = 0 WHERE id = ?`,
              [targetIncomeTx.id]
            );
          } else {
            await conn.execute(
              `UPDATE transactions SET amount = ?, paid_amount = ? WHERE id = ?`,
              [newIncomeAmount, newIncomeAmount, targetIncomeTx.id]
            );
          }
        } else {
          await conn.execute(
            `UPDATE transactions SET status_deleted = 1 WHERE id = ?`,
            [targetIncomeTx.id]
          );
        }
      }

      // 3. Soft delete the repayment record
      await conn.execute(
        `UPDATE transaction_repayments
         SET deleted_at = NOW(), deleted_by = ?
         WHERE id = ?`,
        [req.userId, repayment.id]
      );
    });

    await LogService.logActivity({
      userId: req.userId,
      branchId: parsedBranchId,
      action: 'Hapus Pelunasan Mitra',
      entityType: 'TransactionRepayment',
      entityId: deletedInfo.id,
      metadata: {
        description: `Menghapus (soft delete) pelunasan Rp ${deletedInfo.amount.toLocaleString('id-ID')} milik mitra ${deletedInfo.mitra_nama}`,
        transaction_id: deletedInfo.transaction_id,
        mitra_piutang_id: deletedInfo.mitra_piutang_id
      }
    });

    if (deletedInfo.transaction_id) {
      await TransactionEdit.create({
        transactionId: deletedInfo.transaction_id,
        requesterId: req.userId,
        reason: 'Hapus Pelunasan Mitra',
        oldData: { repayment_amount: deletedInfo.amount, mitra: deletedInfo.mitra_nama },
        newData: { status: 'deleted' },
        status: 'approved'
      });
    }

    res.json({
      success: true,
      message: 'Pelunasan berhasil dihapus dan sisa piutang telah disesuaikan'
    });
  } catch (error) {
    if (error.statusCode) {
      return res.status(error.statusCode).json({ success: false, message: error.message });
    }
    next(error);
  }
};

module.exports = {
  getMitraPiutangReport,
  deleteMitraRepayment
};
