const { query } = require('../config/database');
const Branch = require('../models/Branch');

const getMitraPiutangReport = async (req, res, next) => {
  try {
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
      sqlFilters += ' AND tr.payment_date >= ? AND tr.payment_date <= ?';
      params.push(startDate, endDate);
    }

    // Fetch repayment histories along with original transaction date (tanggal piutang)
    const reportData = await query(
      `SELECT 
        tr.id as repayment_id,
        tr.transaction_id,
        tr.mitra_piutang_id,
        mp.nama as mitra_nama,
        tr.amount as repayment_amount,
        DATE_FORMAT(tr.payment_date, '%Y-%m-%d') as payment_date,
        DATE_FORMAT(t.transaction_date, '%Y-%m-%d') as transaction_date,
        tr.note,
        COALESCE(u.name, u.email) as user_name,
        COALESCE(
          (
            SELECT tmd.remaining_debt 
            FROM transaction_mitra_details tmd 
            WHERE tmd.transaction_id = tr.transaction_id AND tmd.mitra_piutang_id = tr.mitra_piutang_id
          ),
          t.remaining_debt,
          0
        ) as remaining_debt
      FROM transaction_repayments tr
      JOIN mitra_piutang mp ON tr.mitra_piutang_id = mp.id
      JOIN transactions t ON tr.transaction_id = t.id
      LEFT JOIN users u ON tr.user_id = u.id
      WHERE mp.branch_id = ? ${sqlFilters}
      ORDER BY tr.payment_date ASC, tr.id ASC`,
      params
    );

    const formattedData = reportData.map(row => {
      return {
        repayment_id: row.repayment_id,
        transaction_id: row.transaction_id,
        mitra_id: row.mitra_piutang_id,
        mitra_nama: row.mitra_nama || '-',
        amount: parseFloat(row.repayment_amount) || 0,
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

module.exports = {
  getMitraPiutangReport
};
