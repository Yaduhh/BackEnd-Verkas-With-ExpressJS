const fs = require('fs');
const Branch = require('../../models/Branch');
const BranchReport = require('../../models/BranchReport');
const GroupReport = require('../../models/GroupReport');
const { query } = require('../../config/database');
const { 
    exportFinancialReportToPDF, 
    exportFinancialReportToExcel, 
    exportPDFToJPEG, 
    exportBagiHasilToPDF,
    generateFilename, 
    getMimeType 
} = require('../../utils/exportHelper');

/**
 * GET /api/branch-reports/consolidated/report?branchIds=9,10&month=10&year=2026
 * or ?group_name=Bahan%20Baku
 *
 * Mengambil ringkasan laporan keuangan gabungan (konsolidasi) beberapa buku kas / grup
 */
const getConsolidatedReport = async (req, res, next) => {
    try {
        const month = parseInt(req.query.month) || new Date().getMonth() + 1;
        const year = parseInt(req.query.year) || new Date().getFullYear();
        const { branchIds, group_name } = req.query;

        const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
        const daysInMonth = new Date(year, month, 0).getDate();
        const endDate = `${year}-${String(month).padStart(2, '0')}-${String(daysInMonth).padStart(2, '0')}`;

        // Get branches accessible to the user
        const accessibleBranches = await Branch.findByUserAccess(req.userId, req.user.role);
        const accessibleIds = accessibleBranches.map(b => b.id);

        let targetBranches = [];
        if (branchIds) {
            const ids = branchIds.split(',').map(id => parseInt(id.trim())).filter(id => !isNaN(id) && accessibleIds.includes(id));
            targetBranches = accessibleBranches.filter(b => ids.includes(b.id));
        } else if (group_name && group_name !== 'Semua') {
            targetBranches = accessibleBranches.filter(b => b.group_name && b.group_name.toLowerCase() === group_name.toLowerCase());
        } else {
            targetBranches = accessibleBranches;
        }

        if (targetBranches.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Tidak ada buku kas yang ditemukan untuk konsolidasi ini'
            });
        }

        // Process each branch
        const branchBreakdowns = [];
        const aggregatedExpensesMap = {};
        let totalOmzet = 0;
        let totalPengeluaran = 0;
        let totalTransaksi = 0;

        for (const branch of targetBranches) {
            const branchId = branch.id;

            // 1. Omzet
            const incomeResult = await query(
                `SELECT 
                    SUM(
                        CASE 
                            WHEN (t.is_debt_payment = 1 OR t.is_debt_payment = true) THEN COALESCE(t.paid_amount, 0) 
                            ELSE (t.amount + COALESCE(future_ref.amount, 0)) 
                        END
                    ) as total_gross,
                    SUM(
                        COALESCE((
                            SELECT SUM(tid.amount_app)
                            FROM transaction_income_details tid
                            JOIN payment_methods pm ON tid.payment_method_id = pm.id
                            WHERE tid.transaction_id = t.id AND pm.is_taxable = 1
                        ), 0)
                    ) as taxable_amount
                 FROM transactions t
                 LEFT JOIN categories c ON t.category_id = c.id
                 LEFT JOIN (
                     SELECT transaction_id, SUM(amount) as amount 
                     FROM transaction_refunds 
                     WHERE refund_date > ? 
                     GROUP BY transaction_id
                 ) future_ref ON t.id = future_ref.transaction_id
                 WHERE t.branch_id = ? 
                   AND t.type = 'income' 
                   AND t.transaction_date BETWEEN ? AND ? 
                   AND t.status_deleted = false AND (t.is_draft = false OR t.is_draft IS NULL)
                   AND t.is_umum = true
                   AND (c.name NOT LIKE '%Kas Simpanan%' OR c.name IS NULL)`,
                [endDate, branchId, startDate, endDate]
            );

            const pastIncomeRefundsResult = await query(
                `SELECT COALESCE(SUM(tr.amount), 0) as total_past_refunds
                 FROM transaction_refunds tr
                 JOIN transactions t ON tr.transaction_id = t.id
                 WHERE t.branch_id = ?
                   AND t.type = 'income'
                   AND tr.refund_date BETWEEN ? AND ?
                   AND t.transaction_date < ?
                   AND t.status_deleted = false AND (t.is_draft = false OR t.is_draft IS NULL)
                   AND t.is_umum = true`,
                [branchId, startDate, endDate, startDate]
            );
            const pastIncomeRefunds = parseFloat(pastIncomeRefundsResult[0]?.total_past_refunds || 0);
            const systemOmzetGross = (parseFloat(incomeResult[0]?.total_gross) || 0) - pastIncomeRefunds;
            const systemTaxable = parseFloat(incomeResult[0]?.taxable_amount) || 0;
            const branchOmzet = systemOmzetGross - Math.round((systemTaxable * 10) / 110);

            // 2. Pengeluaran
            const expenseBreakdown = await query(
                `SELECT category_name, SUM(total) as total
                 FROM (
                    SELECT COALESCE(c.name, 'Lain-lain') as category_name, 
                           (CASE 
                                WHEN t.type = 'expense' THEN 
                                    (CASE WHEN (t.is_debt_payment = 1 OR t.is_debt_payment = true) THEN COALESCE(t.paid_amount, 0) ELSE (t.amount + COALESCE(future_ref.amount, 0)) END) + COALESCE(t.pb1, 0)
                                ELSE 
                                    -(t.amount + COALESCE(future_ref.amount, 0) + COALESCE(t.pb1, 0))
                            END) as total 
                    FROM transactions t 
                    LEFT JOIN categories c ON t.category_id = c.id 
                    LEFT JOIN (
                        SELECT transaction_id, SUM(amount) as amount 
                        FROM transaction_refunds 
                        WHERE refund_date > ? 
                        GROUP BY transaction_id
                    ) future_ref ON t.id = future_ref.transaction_id
                    WHERE t.branch_id = ? 
                      AND t.transaction_date BETWEEN ? AND ? 
                      AND t.status_deleted = false AND (t.is_draft = false OR t.is_draft IS NULL)
                      AND t.is_umum = true
                      AND (t.is_savings = 0 OR t.is_savings IS NULL)
                      AND (
                        t.type = 'expense' 
                        OR (t.type = 'income' AND t.category_id IN (
                           SELECT DISTINCT category_id FROM transactions WHERE branch_id = ? AND type = 'expense' AND status_deleted = false
                        ))
                      )

                    UNION ALL

                    SELECT c.name as category_name,
                           tsd.amount as total
                    FROM transaction_savings_details tsd
                    JOIN transactions t ON tsd.transaction_id = t.id
                    JOIN categories c ON tsd.category_id = c.id
                    WHERE t.branch_id = ? 
                      AND t.transaction_date BETWEEN ? AND ? 
                      AND t.status_deleted = false AND (t.is_draft = false OR t.is_draft IS NULL)
                      AND t.is_umum = true
                      AND t.type = 'expense'
                      AND t.is_savings = 1

                    UNION ALL

                    SELECT COALESCE(c.name, 'Lain-lain') as category_name,
                           -tr.amount as total
                    FROM transaction_refunds tr
                    JOIN transactions t ON tr.transaction_id = t.id
                    LEFT JOIN categories c ON t.category_id = c.id
                    WHERE t.branch_id = ?
                      AND t.type = 'expense'
                      AND tr.refund_date BETWEEN ? AND ?
                      AND t.transaction_date < ?
                      AND t.status_deleted = false AND (t.is_draft = false OR t.is_draft IS NULL)
                      AND t.is_umum = true
                      AND (t.is_savings = 0 OR t.is_savings IS NULL)
                 ) as consolidated
                 GROUP BY category_name
                 HAVING SUM(total) != 0`,
                [endDate, branchId, startDate, endDate, branchId, branchId, startDate, endDate, branchId, startDate, endDate, startDate]
            );

            const folderPengeluaran = expenseBreakdown.reduce((sum, item) => sum + (parseFloat(item.total) || 0), 0);

            // Total Piutang Mitra
            const mitraPiutangResult = await query(
                `SELECT (
                    SELECT COALESCE(SUM(t.remaining_debt + COALESCE((
                      SELECT SUM(tr.amount)
                      FROM transaction_repayments tr
                      WHERE tr.transaction_id = t.id
                        AND tr.payment_date > ?
                    ), 0)), 0)
                    FROM transactions t
                    JOIN mitra_piutang mp ON t.mitra_piutang_id = mp.id
                    WHERE mp.branch_id = ? AND t.status_deleted = false AND (t.is_draft = false OR t.is_draft IS NULL) AND mp.deleted_at IS NULL
                    AND t.transaction_date BETWEEN ? AND ?
                    AND NOT EXISTS (SELECT 1 FROM transaction_mitra_details WHERE transaction_id = t.id)
                  ) + (
                    SELECT COALESCE(SUM(tmd.remaining_debt + COALESCE((
                      SELECT SUM(tr.amount)
                      FROM transaction_repayments tr
                      WHERE tr.transaction_id = t.id
                        AND tr.mitra_piutang_id = mp.id
                        AND tr.payment_date > ?
                    ), 0)), 0)
                    FROM transaction_mitra_details tmd
                    JOIN transactions t ON tmd.transaction_id = t.id
                    JOIN mitra_piutang mp ON tmd.mitra_piutang_id = mp.id
                    WHERE mp.branch_id = ? AND t.status_deleted = false AND (t.is_draft = false OR t.is_draft IS NULL) AND mp.deleted_at IS NULL
                    AND t.transaction_date BETWEEN ? AND ?
                  ) as total_piutang`,
                [
                  endDate + ' 23:59:59', branchId, startDate + ' 00:00:00', endDate + ' 23:59:59',
                  endDate + ' 23:59:59', branchId, startDate + ' 00:00:00', endDate + ' 23:59:59'
                ]
            );
            const totalPiutangMitra = parseFloat(mitraPiutangResult[0]?.total_piutang) || 0;
            const branchPengeluaran = folderPengeluaran + totalPiutangMitra;
            const branchSaldo = branchOmzet - branchPengeluaran;

            // Count transactions
            const countResult = await query(
                `SELECT COUNT(*) as total_count FROM transactions 
                 WHERE branch_id = ? AND transaction_date BETWEEN ? AND ? 
                   AND status_deleted = false AND (is_draft = false OR is_draft IS NULL) AND is_umum = true`,
                [branchId, startDate, endDate]
            );
            const branchTxCount = parseInt(countResult[0]?.total_count) || 0;

            // Aggregate categories
            for (const exp of expenseBreakdown) {
                const cat = exp.category_name;
                const val = parseFloat(exp.total) || 0;
                aggregatedExpensesMap[cat] = (aggregatedExpensesMap[cat] || 0) + val;
            }
            if (totalPiutangMitra > 0) {
                aggregatedExpensesMap['Mitra Piutang'] = (aggregatedExpensesMap['Mitra Piutang'] || 0) + totalPiutangMitra;
            }

            totalOmzet += branchOmzet;
            totalPengeluaran += branchPengeluaran;
            totalTransaksi += branchTxCount;

            branchBreakdowns.push({
                branch_id: branch.id,
                branch_name: branch.name,
                branch_code: branch.code,
                group_name: branch.group_name,
                omzet: branchOmzet,
                pengeluaran: branchPengeluaran,
                saldo: branchSaldo,
                transaction_count: branchTxCount
            });
        }

        // Calculate percentages
        const branchContributions = branchBreakdowns.map(b => ({
            ...b,
            omzet_percentage: totalOmzet > 0 ? Number(((b.omzet / totalOmzet) * 100).toFixed(2)) : 0,
            pengeluaran_percentage: totalPengeluaran > 0 ? Number(((b.pengeluaran / totalPengeluaran) * 100).toFixed(2)) : 0
        }));

        // Sort categories by amount desc
        const categoryBreakdown = Object.entries(aggregatedExpensesMap)
            .map(([name, amount]) => ({
                category_name: name,
                total: amount,
                percentage: totalPengeluaran > 0 ? Number(((amount / totalPengeluaran) * 100).toFixed(2)) : 0
            }))
            .sort((a, b) => b.total - a.total);

        res.json({
            success: true,
            data: {
                period: {
                    month,
                    year,
                    startDate,
                    endDate
                },
                summary: {
                    total_branches: targetBranches.length,
                    total_omzet: totalOmzet,
                    total_pengeluaran: totalPengeluaran,
                    saldo_kas_berjalan: totalOmzet - totalPengeluaran,
                    total_volume_kas: totalOmzet + totalPengeluaran,
                    total_transaksi: totalTransaksi
                },
                branch_breakdown: branchContributions,
                category_breakdown: categoryBreakdown,
                branches: targetBranches.map(b => ({ id: b.id, name: b.name, code: b.code, group_name: b.group_name }))
            }
        });
    } catch (error) {
        next(error);
    }
};

/**
 * GET /api/branch-reports/consolidated/financial-report?group_name=Bahan%20Baku&month=10&year=2026
 *
 * Mengambil Laporan Keuangan Konsolidasi Grup dengan format BranchReport persis seperti cabang tunggal.
 */
const getGroupFinancialReport = async (req, res, next) => {
    try {
        const { group_name, branchIds } = req.query;
        const month = parseInt(req.query.month) || new Date().getMonth() + 1;
        const year = parseInt(req.query.year) || new Date().getFullYear();

        const accessibleBranches = await Branch.findByUserAccess(req.userId, req.user?.role || 'owner');
        const accessibleIds = accessibleBranches.map(b => b.id);

        let targetBranches = [];
        if (branchIds) {
            const ids = (Array.isArray(branchIds) ? branchIds : branchIds.split(',')).map(id => parseInt(id.toString().trim())).filter(id => !isNaN(id) && accessibleIds.includes(id));
            targetBranches = accessibleBranches.filter(b => ids.includes(b.id));
        } else if (group_name && group_name !== 'Semua' && group_name !== 'ALL') {
            targetBranches = accessibleBranches.filter(b => b.group_name && b.group_name.toLowerCase() === group_name.toLowerCase());
        } else {
            targetBranches = accessibleBranches;
        }

        if (targetBranches.length === 0) {
            return res.json({ success: true, data: { report: null } });
        }

        const targetBranchIds = targetBranches.map(b => b.id);
        const targetOwnerId = targetBranches[0]?.owner_id || req.userId;
        const targetGroupName = (group_name && group_name !== 'Semua') ? group_name : (targetBranches[0]?.group_name || 'Gabungan');
        const savedGroupReport = await GroupReport.findByGroupAndPeriod(targetOwnerId, targetGroupName, month, year);

        const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
        const daysInMonth = new Date(year, month, 0).getDate();
        const endDate = `${year}-${String(month).padStart(2, '0')}-${String(daysInMonth).padStart(2, '0')}`;

        const prevMonthDate = new Date(year, month - 2, 1);
        const prevMonthName = prevMonthDate.toLocaleDateString('id-ID', { month: 'long', year: 'numeric' });

        let totalSystemOmzet = 0;
        let totalSystemPengeluaran = 0;
        let totalMitraPiutangGroup = 0;
        let totalPelunasanPiutang = 0;
        let totalUnallocatedOmzet = 0;
        const aggregatedExpensesMap = {};
        const aggregatedIncomeMap = {};
        const aggregatedSalesChannelsMap = {};
        const masterSalesChannelsSet = new Set();
        const branchBreakdowns = [];

        for (const branch of targetBranches) {
            const branchId = branch.id;

            // 1. Omzet
            const incomeResult = await query(
                `SELECT 
                    SUM(
                        CASE 
                            WHEN (t.is_debt_payment = 1 OR t.is_debt_payment = true) THEN COALESCE(t.paid_amount, 0) 
                            ELSE (t.amount + COALESCE(future_ref.amount, 0)) 
                        END
                    ) as total_gross,
                    SUM(
                        COALESCE((
                            SELECT SUM(tid.amount_app)
                            FROM transaction_income_details tid
                            JOIN payment_methods pm ON tid.payment_method_id = pm.id
                            WHERE tid.transaction_id = t.id AND pm.is_taxable = 1
                        ), 0)
                    ) as taxable_amount
                 FROM transactions t
                 LEFT JOIN categories c ON t.category_id = c.id
                 LEFT JOIN (
                     SELECT transaction_id, SUM(amount) as amount 
                     FROM transaction_refunds 
                     WHERE refund_date > ? 
                     GROUP BY transaction_id
                 ) future_ref ON t.id = future_ref.transaction_id
                 WHERE t.branch_id = ? 
                   AND t.type = 'income' 
                   AND t.transaction_date BETWEEN ? AND ? 
                   AND t.status_deleted = false AND (t.is_draft = false OR t.is_draft IS NULL)
                   AND t.is_umum = true
                   AND (c.name NOT LIKE '%Kas Simpanan%' OR c.name IS NULL)`,
                [endDate, branchId, startDate, endDate]
            );

            const pastIncomeRefundsResult = await query(
                `SELECT COALESCE(SUM(tr.amount), 0) as total_past_refunds
                 FROM transaction_refunds tr
                 JOIN transactions t ON tr.transaction_id = t.id
                 WHERE t.branch_id = ?
                   AND t.type = 'income'
                   AND tr.refund_date BETWEEN ? AND ?
                   AND t.transaction_date < ?
                   AND t.status_deleted = false AND (t.is_draft = false OR t.is_draft IS NULL)
                   AND t.is_umum = true`,
                [branchId, startDate, endDate, startDate]
            );
            const pastIncomeRefunds = parseFloat(pastIncomeRefundsResult[0]?.total_past_refunds || 0);
            const systemOmzetGross = (parseFloat(incomeResult[0]?.total_gross) || 0) - pastIncomeRefunds;
            const systemTaxable = parseFloat(incomeResult[0]?.taxable_amount) || 0;
            const branchOmzet = systemOmzetGross - Math.round((systemTaxable * 10) / 110);

            // 2. Expense breakdown
            const expenseBreakdown = await query(
                `SELECT category_name, SUM(total) as total
                 FROM (
                    SELECT COALESCE(c.name, 'Lain-lain') as category_name, 
                           (CASE 
                                WHEN t.type = 'expense' THEN 
                                    (CASE WHEN (t.is_debt_payment = 1 OR t.is_debt_payment = true) THEN COALESCE(t.paid_amount, 0) ELSE (t.amount + COALESCE(future_ref.amount, 0)) END) + COALESCE(t.pb1, 0)
                                ELSE 
                                    -(t.amount + COALESCE(future_ref.amount, 0) + COALESCE(t.pb1, 0))
                            END) as total 
                    FROM transactions t 
                    LEFT JOIN categories c ON t.category_id = c.id 
                    LEFT JOIN (
                        SELECT transaction_id, SUM(amount) as amount 
                        FROM transaction_refunds 
                        WHERE refund_date > ? 
                        GROUP BY transaction_id
                    ) future_ref ON t.id = future_ref.transaction_id
                    WHERE t.branch_id = ? 
                      AND t.transaction_date BETWEEN ? AND ? 
                      AND t.status_deleted = false AND (t.is_draft = false OR t.is_draft IS NULL)
                      AND t.is_umum = true
                      AND (t.is_savings = 0 OR t.is_savings IS NULL)
                      AND (
                        t.type = 'expense' 
                        OR (t.type = 'income' AND t.category_id IN (
                           SELECT DISTINCT category_id FROM transactions WHERE branch_id = ? AND type = 'expense' AND status_deleted = false
                        ))
                      )

                    UNION ALL

                    SELECT c.name as category_name,
                           tsd.amount as total
                    FROM transaction_savings_details tsd
                    JOIN transactions t ON tsd.transaction_id = t.id
                    JOIN categories c ON tsd.category_id = c.id
                    WHERE t.branch_id = ? 
                      AND t.transaction_date BETWEEN ? AND ? 
                      AND t.status_deleted = false AND (t.is_draft = false OR t.is_draft IS NULL)
                      AND t.is_umum = true
                      AND t.type = 'expense'
                      AND t.is_savings = 1

                    UNION ALL

                    SELECT COALESCE(c.name, 'Lain-lain') as category_name,
                           -tr.amount as total
                    FROM transaction_refunds tr
                    JOIN transactions t ON tr.transaction_id = t.id
                    LEFT JOIN categories c ON t.category_id = c.id
                    WHERE t.branch_id = ?
                      AND t.type = 'expense'
                      AND tr.refund_date BETWEEN ? AND ?
                      AND t.transaction_date < ?
                      AND t.status_deleted = false AND (t.is_draft = false OR t.is_draft IS NULL)
                      AND t.is_umum = true
                      AND (t.is_savings = 0 OR t.is_savings IS NULL)
                 ) as consolidated
                 GROUP BY category_name
                 HAVING SUM(total) != 0`,
                [endDate, branchId, startDate, endDate, branchId, branchId, startDate, endDate, branchId, startDate, endDate, startDate]
            );

            // 3. Mitra Piutang
            const folderPengeluaran = expenseBreakdown.reduce((sum, item) => sum + (parseFloat(item.total) || 0), 0);
            const mitraPiutangResult = await query(
                `SELECT (
                    SELECT COALESCE(SUM(t.remaining_debt + COALESCE((
                      SELECT SUM(tr.amount)
                      FROM transaction_repayments tr
                      WHERE tr.transaction_id = t.id
                        AND tr.payment_date > ?
                    ), 0)), 0)
                    FROM transactions t
                    JOIN mitra_piutang mp ON t.mitra_piutang_id = mp.id
                    WHERE mp.branch_id = ? AND t.status_deleted = false AND (t.is_draft = false OR t.is_draft IS NULL) AND mp.deleted_at IS NULL
                    AND t.transaction_date BETWEEN ? AND ?
                    AND NOT EXISTS (SELECT 1 FROM transaction_mitra_details WHERE transaction_id = t.id)
                  ) + (
                    SELECT COALESCE(SUM(tmd.remaining_debt + COALESCE((
                      SELECT SUM(tr.amount)
                      FROM transaction_repayments tr
                      WHERE tr.transaction_id = t.id
                        AND tr.mitra_piutang_id = mp.id
                        AND tr.payment_date > ?
                    ), 0)), 0)
                    FROM transaction_mitra_details tmd
                    JOIN transactions t ON tmd.transaction_id = t.id
                    JOIN mitra_piutang mp ON tmd.mitra_piutang_id = mp.id
                    WHERE mp.branch_id = ? AND t.status_deleted = false AND (t.is_draft = false OR t.is_draft IS NULL) AND mp.deleted_at IS NULL
                    AND t.transaction_date BETWEEN ? AND ?
                  ) as total_piutang`,
                [
                  endDate + ' 23:59:59', branchId, startDate + ' 00:00:00', endDate + ' 23:59:59',
                  endDate + ' 23:59:59', branchId, startDate + ' 00:00:00', endDate + ' 23:59:59'
                ]
            );
            const totalPiutangMitra = parseFloat(mitraPiutangResult[0]?.total_piutang) || 0;
            const branchPengeluaran = folderPengeluaran + totalPiutangMitra;
            const branchSaldo = branchOmzet - branchPengeluaran;

            // 4. Debt repayments (Pelunasan Piutang Bulan Lalu)
            const debtRepaymentResult = await query(
                `SELECT SUM(tr.amount) as total
                 FROM transaction_repayments tr
                 JOIN transactions t ON tr.transaction_id = t.id
                 WHERE tr.payment_date BETWEEN ? AND ?
                   AND t.transaction_date < ?
                   AND t.branch_id = ?
                   AND t.status_deleted = false AND (t.is_draft = false OR t.is_draft IS NULL)`,
                [startDate, endDate, startDate, branchId]
            );
            const branchPelunasan = parseFloat(debtRepaymentResult[0]?.total) || 0;

            // 5. Income Breakdown
            const incomeBreakdownResult = await query(
                `SELECT 
                    t.category_id,
                    COALESCE(c.name, 'Lain-lain') as category_name,
                    SUM(t.amount + COALESCE(future_ref.amount, 0)) as total_gross,
                    SUM(
                        COALESCE((
                            SELECT SUM(tid.amount_app)
                            FROM transaction_income_details tid
                            JOIN payment_methods pm ON tid.payment_method_id = pm.id
                            WHERE tid.transaction_id = t.id AND pm.is_taxable = 1
                        ), 0)
                    ) as taxable_amount,
                    SUM(
                        COALESCE((
                            SELECT ROUND(SUM(tid.amount_app) * 10 / 110)
                            FROM transaction_income_details tid
                            JOIN payment_methods pm ON tid.payment_method_id = pm.id
                            WHERE tid.transaction_id = t.id AND pm.is_taxable = 1
                        ), t.pb1, 0)
                    ) as total_pb1
                 FROM transactions t
                 LEFT JOIN categories c ON t.category_id = c.id
                 LEFT JOIN (
                     SELECT transaction_id, SUM(amount) as amount 
                     FROM transaction_refunds 
                     WHERE refund_date > ? 
                     GROUP BY transaction_id
                 ) future_ref ON t.id = future_ref.transaction_id
                 WHERE t.branch_id = ? 
                   AND t.type = 'income' 
                   AND t.transaction_date BETWEEN ? AND ? 
                   AND t.status_deleted = false AND (t.is_draft = false OR t.is_draft IS NULL)
                   AND t.is_umum = true
                   AND (c.name NOT LIKE '%Kas Simpanan%' OR c.name IS NULL)
                 GROUP BY t.category_id, c.name`,
                [endDate, branchId, startDate, endDate]
            );

            // 6. Sales Channels
            const systemSalesChannelsResult = await query(
                `SELECT 
                    sc.name,
                    SUM(tsc.amount) as gross_amount,
                    SUM(
                        CASE 
                            WHEN pm.is_taxable = 1 THEN ROUND((tsc.amount * 100) / 110)
                            ELSE tsc.amount 
                        END
                    ) as amount
                 FROM transaction_sales_channels tsc
                 JOIN sales_channels sc ON tsc.sales_channel_id = sc.id
                 JOIN transactions t ON tsc.transaction_id = t.id
                 LEFT JOIN (
                     SELECT tid.transaction_id, MAX(pm.is_taxable) as is_taxable
                     FROM transaction_income_details tid
                     JOIN payment_methods pm ON tid.payment_method_id = pm.id
                     GROUP BY tid.transaction_id
                 ) pm ON t.id = pm.transaction_id
                 WHERE t.branch_id = ?
                   AND t.transaction_date BETWEEN ? AND ?
                   AND t.status_deleted = false AND (t.is_draft = false OR t.is_draft IS NULL)
                   AND t.is_umum = true
                 GROUP BY sc.name`,
                [branchId, startDate, endDate]
            );

            const masterSalesChannelsResult = await query(
                `SELECT name FROM sales_channels WHERE branch_id = ? AND status_deleted = 0 AND is_active = 1`,
                [branchId]
            );

            // 7. Unallocated Omzet
            const omzetWithoutChannelsResult = await query(
                `SELECT 
                    SUM(
                        CASE 
                            WHEN (t.is_debt_payment = 1 OR t.is_debt_payment = true) THEN COALESCE(t.paid_amount, 0) 
                            ELSE t.amount 
                        END
                    ) as gross_without_channel,
                    SUM(
                        COALESCE((
                            SELECT SUM(tid.amount_app)
                            FROM transaction_income_details tid
                            JOIN payment_methods pm ON tid.payment_method_id = pm.id
                            WHERE tid.transaction_id = t.id AND pm.is_taxable = 1
                        ), 0)
                    ) as taxable_without_channel
                 FROM transactions t
                 LEFT JOIN categories c ON t.category_id = c.id
                 WHERE t.branch_id = ?
                   AND t.type = 'income'
                   AND t.transaction_date BETWEEN ? AND ?
                   AND t.status_deleted = false AND (t.is_draft = false OR t.is_draft IS NULL)
                   AND t.is_umum = true
                   AND (c.name LIKE '%OMZET%' OR c.name LIKE '%OMSET%')
                   AND t.id NOT IN (
                       SELECT DISTINCT transaction_id FROM transaction_sales_channels
                   )`,
                [branchId, startDate, endDate]
            );
            const grossWithoutChannels = parseFloat(omzetWithoutChannelsResult[0]?.gross_without_channel) || 0;
            const taxableWithoutChannels = parseFloat(omzetWithoutChannelsResult[0]?.taxable_without_channel) || 0;
            const taxWithoutChannels = Math.round((taxableWithoutChannels * 10) / 110);
            const branchUnallocated = Math.max(0, grossWithoutChannels - taxWithoutChannels);

            // Accumulate
            totalSystemOmzet += branchOmzet;
            totalSystemPengeluaran += branchPengeluaran;
            totalPelunasanPiutang += branchPelunasan;
            totalUnallocatedOmzet += branchUnallocated;

            // Aggregated expense map
            for (const exp of expenseBreakdown) {
                const cat = exp.category_name;
                const val = parseFloat(exp.total) || 0;
                aggregatedExpensesMap[cat] = (aggregatedExpensesMap[cat] || 0) + val;
            }
            if (totalPiutangMitra > 0) {
                totalMitraPiutangGroup += totalPiutangMitra;
            }

            // Aggregated income map
            for (const inc of incomeBreakdownResult) {
                const cat = inc.category_name;
                const g = parseFloat(inc.total_gross) || 0;
                const tax = inc.total_pb1 !== undefined && inc.total_pb1 !== null
                    ? parseFloat(inc.total_pb1) || 0
                    : Math.round(((parseFloat(inc.taxable_amount) || 0) * 10) / 110);
                if (!aggregatedIncomeMap[cat]) {
                    aggregatedIncomeMap[cat] = { total: 0, total_tax: 0, total_net: 0 };
                }
                aggregatedIncomeMap[cat].total += g;
                aggregatedIncomeMap[cat].total_tax += tax;
                aggregatedIncomeMap[cat].total_net += (g - tax);
            }

            // Aggregated sales channels map
            for (const sc of systemSalesChannelsResult) {
                const name = sc.name;
                const amt = parseFloat(sc.amount) || 0;
                const gross = parseFloat(sc.gross_amount) || 0;
                if (!aggregatedSalesChannelsMap[name]) {
                    aggregatedSalesChannelsMap[name] = { amount: 0, gross_amount: 0 };
                }
                aggregatedSalesChannelsMap[name].amount += amt;
                aggregatedSalesChannelsMap[name].gross_amount += gross;
            }

            for (const msc of masterSalesChannelsResult) {
                if (msc.name) masterSalesChannelsSet.add(msc.name);
            }

            branchBreakdowns.push({
                id: branch.id,
                name: branch.name,
                code: branch.code,
                group_name: branch.group_name,
                omzet: branchOmzet,
                pengeluaran: branchPengeluaran,
                profit: branchSaldo
            });
        }

        const finalProfit = totalSystemOmzet - totalSystemPengeluaran;

        // Calculate omzet percentages for each branch
        const branchContributions = branchBreakdowns.map(b => ({
            ...b,
            omzet_pct: totalSystemOmzet > 0 ? Number(((b.omzet / totalSystemOmzet) * 100).toFixed(2)) : 0
        }));

        const incomeBreakdown = Object.entries(aggregatedIncomeMap).map(([name, data]) => ({
            category_name: name,
            total: data.total,
            total_tax: data.total_tax,
            total_net: data.total_net
        }));

        const expenseBreakdown = Object.entries(aggregatedExpensesMap)
            .map(([name, val]) => ({ category_name: name, total: val }))
            .sort((a, b) => b.total - a.total);

        const systemSalesChannels = Object.entries(aggregatedSalesChannelsMap)
            .map(([name, data]) => ({
                sales_channel_id: 0,
                name,
                amount: data.amount,
                gross_amount: data.gross_amount
            }))
            .sort((a, b) => b.amount - a.amount);

        const masterSalesChannels = Array.from(masterSalesChannelsSet).map((name, idx) => ({
            id: idx + 1,
            name,
            is_active: 1
        }));

        const disabledList = Array.isArray(savedGroupReport?.disabled_categories) ? savedGroupReport.disabled_categories : [];
        const piutangLabel = `PIUTANG ${new Date(year, month - 1, 1).toLocaleDateString('id-ID', { month: 'long', year: 'numeric' }).toUpperCase()}`;
        const isPiutangDisabled = disabledList.includes(piutangLabel) || disabledList.includes('PIUTANG');

        // Map is_active into expenseBreakdown
        const processedExpenseBreakdown = expenseBreakdown.map(item => ({
            ...item,
            is_active: !disabledList.includes(item.category_name)
        }));

        // Map is_active into incomeBreakdown
        const processedIncomeBreakdown = incomeBreakdown.map(item => ({
            ...item,
            is_active: !disabledList.includes(item.category_name)
        }));

        // Calculate active totals
        const activeExpenseFromBreakdown = processedExpenseBreakdown
            .filter(item => item.is_active)
            .reduce((sum, item) => sum + (parseFloat(item.total) || 0), 0);
        const activePiutang = isPiutangDisabled ? 0 : totalMitraPiutangGroup;
        const activePengeluaranTotal = activeExpenseFromBreakdown + activePiutang;

        // Active Omzet (if any income breakdown category is disabled)
        const hasDisabledIncome = disabledList.some(d => incomeBreakdown.some(i => i.category_name === d));
        const activeOmzetTotal = hasDisabledIncome
            ? processedIncomeBreakdown.filter(item => item.is_active).reduce((sum, item) => sum + (parseFloat(item.total_net) || parseFloat(item.total) || 0), 0)
            : totalSystemOmzet;

        const activeProfit = activeOmzetTotal - activePengeluaranTotal;

        const report = {
            id: 0,
            branch_id: 0,
            group_name: group_name || 'Gabungan',
            is_group: true,
            month,
            year,
            omzet_total: activeOmzetTotal,
            raw_omzet_total: totalSystemOmzet,
            pengeluaran_total: activePengeluaranTotal - activePiutang,
            pure_pengeluaran: activePengeluaranTotal - activePiutang,
            raw_pengeluaran_total: totalSystemPengeluaran - totalMitraPiutangGroup,
            piutang_mitra: activePiutang,
            total_piutang_mitra: activePiutang,
            raw_piutang_mitra: totalMitraPiutangGroup,
            is_piutang_disabled: isPiutangDisabled,
            piutang_label: piutangLabel,
            profit: activeProfit,
            pelunasan_piutang_bulan_lalu: totalPelunasanPiutang,
            prev_month_label: prevMonthName,
            income_breakdown: processedIncomeBreakdown,
            expense_breakdown: processedExpenseBreakdown,
            disabled_categories: disabledList,
            sales_channels: (savedGroupReport?.sales_channels && savedGroupReport.sales_channels.length > 0)
                ? savedGroupReport.sales_channels
                : systemSalesChannels.map(s => ({ name: s.name, amount: s.amount })),
            system_sales_channels: systemSalesChannels,
            master_sales_channels: masterSalesChannels,
            unallocated_omzet: totalUnallocatedOmzet,
            working_days: savedGroupReport?.working_days || 25,
            stok_awal: savedGroupReport ? Number(savedGroupReport.stok_awal) : 0,
            stok_akhir: savedGroupReport ? Number(savedGroupReport.stok_akhir) : 0,
            bagi_hasil: savedGroupReport ? savedGroupReport.bagi_hasil : [],
            expense_adjustments: savedGroupReport ? savedGroupReport.expense_adjustments : [],
            expense_order: savedGroupReport ? savedGroupReport.expense_order : [],
            branches: branchContributions
        };

        if (req._returnReportOnly) {
            return report;
        }

        res.json({
            success: true,
            data: {
                report
            }
        });
    } catch (error) {
        if (req._returnReportOnly) throw error;
        next(error);
    }
};

/**
 * GET /api/branch-reports/consolidated/export?group_name=Bahan%20Baku&month=10&year=2026
 */
const exportGroupPdf = async (req, res, next) => {
    try {
        const { group_name } = req.query;
        const month = parseInt(req.query.month) || new Date().getMonth() + 1;
        const year = parseInt(req.query.year) || new Date().getFullYear();
        const workingDays = parseInt(req.query.workingDays) || 25;

        const fakeReq = { ...req, query: { ...req.query }, _returnReportOnly: true };
        const reportData = await getGroupFinancialReport(fakeReq, res, next);
        if (!reportData) return res.status(404).json({ success: false, message: 'Tidak ada data buku kas dalam grup ini' });

        // helper imported above
        const groupLabel = group_name ? `Grup_${group_name.replace(/\s+/g, '_')}` : 'Grup_Gabungan';
        const filename = generateFilename('PDF', `Laporan_Keuangan_${groupLabel}`);
        const selectedMonthDate = new Date(year, month - 1, 1);

        const dataForPdf = {
            ...reportData,
            working_days: workingDays,
            expense_breakdown: (reportData.expense_breakdown || []).filter(item => item.is_active !== false),
            income_breakdown: (reportData.income_breakdown || []).filter(item => item.is_active !== false),
            piutang_mitra: reportData.is_piutang_disabled ? 0 : reportData.piutang_mitra,
            total_piutang_mitra: reportData.is_piutang_disabled ? 0 : reportData.total_piutang_mitra
        };

        const filepath = await exportFinancialReportToPDF(
            dataForPdf, 
            filename, 
            groupLabel, 
            selectedMonthDate, 
            workingDays, 
            { 
                printedBy: req.user?.name || req.user?.email || 'Owner',
                branchCode: 'GABUNGAN',
                branchName: group_name ? `Grup: ${group_name}` : 'Semua Buku Kas'
            }
        );

        // fs imported above
        if (!fs.existsSync(filepath)) {
            return res.status(500).json({ success: false, message: 'File PDF gagal dibuat' });
        }

        res.setHeader('Content-Type', getMimeType('PDF') || 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

        const fileStream = fs.createReadStream(filepath);
        fileStream.pipe(res);
        fileStream.on('end', () => {
            setTimeout(() => {
                fs.unlink(filepath, () => {});
            }, 10000);
        });
    } catch (error) {
        next(error);
    }
};

/**
 * GET /api/branch-reports/consolidated/export-image?group_name=Bahan%20Baku&month=10&year=2026
 */
const exportGroupImage = async (req, res, next) => {
    try {
        const { group_name } = req.query;
        const month = parseInt(req.query.month) || new Date().getMonth() + 1;
        const year = parseInt(req.query.year) || new Date().getFullYear();
        const workingDays = parseInt(req.query.workingDays) || 25;

        const fakeReq = { ...req, query: { ...req.query }, _returnReportOnly: true };
        const reportData = await getGroupFinancialReport(fakeReq, res, next);
        if (!reportData) return res.status(404).json({ success: false, message: 'Tidak ada data buku kas dalam grup ini' });

        // helper imported above
        const groupLabel = group_name ? `Grup_${group_name.replace(/\s+/g, '_')}` : 'Grup_Gabungan';
        const filename = generateFilename('JPEG', `Laporan_Keuangan_${groupLabel}`);
        const pdfFilename = generateFilename('PDF', `Laporan_Keuangan_${groupLabel}`);
        const selectedMonthDate = new Date(year, month - 1, 1);

        const dataForPdf = {
            ...reportData,
            working_days: workingDays,
            expense_breakdown: (reportData.expense_breakdown || []).filter(item => item.is_active !== false),
            income_breakdown: (reportData.income_breakdown || []).filter(item => item.is_active !== false),
            piutang_mitra: reportData.is_piutang_disabled ? 0 : reportData.piutang_mitra,
            total_piutang_mitra: reportData.is_piutang_disabled ? 0 : reportData.total_piutang_mitra
        };

        const pdfPath = await exportFinancialReportToPDF(
            dataForPdf, 
            pdfFilename, 
            groupLabel, 
            selectedMonthDate, 
            workingDays, 
            { 
                printedBy: req.user?.name || req.user?.email || 'Owner',
                branchCode: 'GABUNGAN',
                branchName: group_name ? `Grup: ${group_name}` : 'Semua Buku Kas'
            }
        );

        const imagePath = await exportPDFToJPEG(pdfPath, filename);
        // fs imported above
        if (!fs.existsSync(imagePath)) {
            return res.status(500).json({ success: false, message: 'File gambar gagal dibuat' });
        }

        res.setHeader('Content-Type', 'image/jpeg');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

        const fileStream = fs.createReadStream(imagePath);
        fileStream.pipe(res);
        fileStream.on('end', () => {
            setTimeout(() => {
                fs.unlink(imagePath, () => {});
                fs.unlink(pdfPath, () => {});
            }, 10000);
        });
    } catch (error) {
        next(error);
    }
};

/**
 * GET /api/branch-reports/consolidated/export-excel?group_name=Bahan%20Baku&month=10&year=2026
 */
const exportGroupExcel = async (req, res, next) => {
    try {
        const { group_name } = req.query;
        const month = parseInt(req.query.month) || new Date().getMonth() + 1;
        const year = parseInt(req.query.year) || new Date().getFullYear();
        const workingDays = parseInt(req.query.workingDays) || 25;

        const fakeReq = { ...req, query: { ...req.query }, _returnReportOnly: true };
        const reportData = await getGroupFinancialReport(fakeReq, res, next);
        if (!reportData) return res.status(404).json({ success: false, message: 'Tidak ada data buku kas dalam grup ini' });

        const { exportFinancialReportToExcel, generateFilename, getMimeType } = require('../utils/exportHelper');
        const groupLabel = group_name ? `Grup_${group_name.replace(/\s+/g, '_')}` : 'Grup_Gabungan';
        const filename = generateFilename('XLS', `Laporan_Keuangan_${groupLabel}`);
        const selectedMonthDate = new Date(year, month - 1, 1);

        const dataForExcel = {
            ...reportData,
            working_days: workingDays,
            expense_breakdown: (reportData.expense_breakdown || []).filter(item => item.is_active !== false),
            income_breakdown: (reportData.income_breakdown || []).filter(item => item.is_active !== false),
            piutang_mitra: reportData.is_piutang_disabled ? 0 : reportData.piutang_mitra,
            total_piutang_mitra: reportData.is_piutang_disabled ? 0 : reportData.total_piutang_mitra
        };

        const filepath = await exportFinancialReportToExcel(
            dataForExcel, 
            filename, 
            groupLabel, 
            selectedMonthDate, 
            workingDays, 
            { 
                printedBy: req.user?.name || req.user?.email || 'Owner',
                branchCode: 'GABUNGAN',
                branchName: group_name ? `Grup: ${group_name}` : 'Semua Buku Kas'
            }
        );

        // fs imported above
        if (!fs.existsSync(filepath)) {
            return res.status(500).json({ success: false, message: 'File Excel gagal dibuat' });
        }

        res.setHeader('Content-Type', getMimeType('XLS'));
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

        const fileStream = fs.createReadStream(filepath);
        fileStream.pipe(res);
        fileStream.on('end', () => {
            setTimeout(() => {
                fs.unlink(filepath, () => {});
            }, 10000);
        });
    } catch (error) {
        next(error);
    }
};

/**
 * PUT /api/branch-reports/consolidated/report?group_name=Bahan%20Baku&month=10&year=2026
 * or PUT /api/branch-reports/consolidated/financial-report
 */
const saveGroupReport = async (req, res, next) => {
    try {
        const { group_name } = req.query;
        const month = parseInt(req.query.month) || new Date().getMonth() + 1;
        const year = parseInt(req.query.year) || new Date().getFullYear();
        const {
            stok_awal,
            stok_akhir,
            bagi_hasil,
            working_days,
            sales_channels,
            expense_adjustments,
            expense_order,
            disabled_categories
        } = req.body;

        const accessibleBranches = await Branch.findByUserAccess(req.userId, req.user?.role || 'owner');
        let targetBranches = [];
        if (group_name && group_name !== 'Semua' && group_name !== 'ALL') {
            targetBranches = accessibleBranches.filter(b => b.group_name && b.group_name.toLowerCase() === group_name.toLowerCase());
        } else {
            targetBranches = accessibleBranches;
        }

        if (targetBranches.length === 0) {
            return res.status(404).json({ success: false, message: 'Grup buku kas tidak ditemukan atau tidak memiliki akses' });
        }

        const targetOwnerId = targetBranches[0]?.owner_id || req.userId;
        const targetGroupName = (group_name && group_name !== 'Semua') ? group_name : (targetBranches[0]?.group_name || 'Gabungan');

        await GroupReport.upsert(targetOwnerId, targetGroupName, month, year, {
            stokAwal: stok_awal !== undefined ? parseFloat(stok_awal) : undefined,
            stokAkhir: stok_akhir !== undefined ? parseFloat(stok_akhir) : undefined,
            bagiHasil: bagi_hasil,
            workingDays: working_days !== undefined ? parseInt(working_days) : undefined,
            salesChannels: sales_channels,
            expenseAdjustments: expense_adjustments,
            expenseOrder: expense_order,
            disabledCategories: disabled_categories
        });

        // Return updated full report
        const fakeReq = { ...req, query: { group_name, month, year }, _returnReportOnly: true };
        const updatedReport = await getGroupFinancialReport(fakeReq, res, next);

        return res.json({
            success: true,
            message: 'Laporan keuangan grup berhasil disimpan',
            data: {
                report: updatedReport
            }
        });
    } catch (error) {
        next(error);
    }
};

/**
 * GET /api/branch-reports/consolidated/export-bagi-hasil-pdf?group_name=Bahan%20Baku&month=10&year=2026
 */
const exportGroupBagiHasilPdf = async (req, res, next) => {
    try {
        const { group_name } = req.query;
        const month = parseInt(req.query.month) || new Date().getMonth() + 1;
        const year = parseInt(req.query.year) || new Date().getFullYear();

        const fakeReq = { ...req, query: { ...req.query }, _returnReportOnly: true };
        const reportData = await getGroupFinancialReport(fakeReq, res, next);
        if (!reportData) return res.status(404).json({ success: false, message: 'Tidak ada data buku kas dalam grup ini' });

        const groupLabel = group_name ? `Grup_${group_name.replace(/\s+/g, '_')}` : 'Grup_Gabungan';
        const filename = generateFilename('PDF', `Bagi_Hasil_${groupLabel}`);
        const selectedMonthDate = new Date(year, month - 1, 1);

        try {
            const filepath = await exportBagiHasilToPDF(reportData, filename, groupLabel, selectedMonthDate);

            res.setHeader('Content-Type', getMimeType('PDF') || 'application/pdf');
            res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

            const fileStream = fs.createReadStream(filepath);
            fileStream.pipe(res);

            fileStream.on('end', () => {
                setTimeout(() => {
                    fs.unlink(filepath, () => {});
                }, 10000);
            });
        } catch (pdfError) {
            console.error(`[EXPORT BH GROUP] PDF Gen Error:`, pdfError);
            return res.status(500).json({ success: false, message: 'Gagal memproses PDF Bagi Hasil: ' + pdfError.message });
        }
    } catch (error) {
        next(error);
    }
};

module.exports = {
    getConsolidatedReport,
    getGroupFinancialReport,
    saveGroupReport,
    exportGroupPdf,
    exportGroupImage,
    exportGroupExcel,
    exportGroupBagiHasilPdf
};
