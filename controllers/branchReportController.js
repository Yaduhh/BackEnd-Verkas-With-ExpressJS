const Branch = require('../models/Branch');
const BranchReport = require('../models/BranchReport');
const { query } = require('../config/database');

/**
 * GET /api/branch-reports/:branchId?month=2&year=2026
 *
 * Ambil laporan untuk branch & periode.
 * - Hitung omzet & pengeluaran dari transaksi kas umum (is_umum = true)
 * - Ambil/buat record di branch_reports
 * - Return gabungan data otomatis + data manual
 */
const getReport = async (req, res, next) => {
    try {
        const { branchId } = req.params;
        const month = parseInt(req.query.month) || new Date().getMonth() + 1;
        const year = parseInt(req.query.year) || new Date().getFullYear();

        // Validasi akses
        const hasAccess = await Branch.userHasAccess(req.userId, parseInt(branchId), req.user.role);
        if (!hasAccess) {
            return res.status(403).json({ success: false, message: 'Akses ditolak' });
        }

        // Use transaction_date instead of created_at for better accounting accuracy
        const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
        const daysInMonth = new Date(year, month, 0).getDate();
        const endDate = `${year}-${String(month).padStart(2, '0')}-${String(daysInMonth).padStart(2, '0')}`;

        // Previous month for Pelunasan Piutang label
        const prevMonthDate = new Date(year, month - 2, 1);
        const prevMonthName = prevMonthDate.toLocaleDateString('id-ID', { month: 'long', year: 'numeric' });

        // 1. Omzet Total (Kas Umum)
        const incomeResult = await query(
            `SELECT SUM(CASE 
                WHEN (is_debt_payment = true OR is_debt_payment = 1) 
                THEN COALESCE(paid_amount, 0)
                ELSE amount 
             END) as total
             FROM transactions
             WHERE branch_id = ?
               AND type = 'income'
               AND (is_umum = true OR is_umum IS NULL)
               AND transaction_date BETWEEN ? AND ?
               AND status_deleted = false`,
            [branchId, startDate, endDate]
        );
        const omzetTotal = parseFloat(incomeResult[0].total) || 0;

        // 2. Pengeluaran Total (Kas Umum)
        const expenseResult = await query(
            `SELECT SUM(amount) as total
             FROM transactions
             WHERE branch_id = ?
               AND type = 'expense'
               AND (is_umum = true OR is_umum IS NULL)
               AND transaction_date BETWEEN ? AND ?
               AND status_deleted = false`,
            [branchId, startDate, endDate]
        );
        const pengeluaranTotal = parseFloat(expenseResult[0].total) || 0;

        // 3. Pengeluaran Breakdown (By Category)
        const expenseBreakdown = await query(
            `SELECT COALESCE(c.name, 'Lain-lain') as category_name, SUM(t.amount) as total
             FROM transactions t
             LEFT JOIN categories c ON t.category_id = c.id
             WHERE t.branch_id = ?
               AND t.type = 'expense'
               AND (t.is_umum = true OR t.is_umum IS NULL)
               AND t.transaction_date BETWEEN ? AND ?
               AND t.status_deleted = false
             GROUP BY c.name`,
            [branchId, startDate, endDate]
        );

        // 4. Pelunasan Piutang Bulan Lalu
        // (Uang masuk bulan ini untuk piutang yang dibuat di bulan-bulan sebelumnya)
        const debtRepaymentResult = await query(
            `SELECT SUM(tr.amount) as total
             FROM transaction_repayments tr
             JOIN transactions t ON tr.transaction_id = t.id
             WHERE tr.payment_date BETWEEN ? AND ?
               AND t.transaction_date < ?
               AND t.branch_id = ?`,
            [startDate, endDate, startDate, branchId]
        );
        const pelunasanPiutangBulanLalu = parseFloat(debtRepaymentResult[0].total) || 0;

        // 5. Pendapatan Breakdown (By Category) - Show Folders specifically, group others as 'Lain-lain'
        const incomeBreakdownResult = await query(
            `SELECT 
                CASE WHEN c.is_folder = true THEN c.name ELSE 'Lain-lain' END as category_group,
                SUM(CASE 
                    WHEN (t.is_debt_payment = true OR t.is_debt_payment = 1) 
                    THEN COALESCE(t.paid_amount, 0)
                    ELSE t.amount 
                END) as total
             FROM transactions t
             LEFT JOIN categories c ON t.category_id = c.id
             WHERE t.branch_id = ?
               AND t.type = 'income'
               AND (t.is_umum = true OR t.is_umum IS NULL)
               AND t.transaction_date BETWEEN ? AND ?
               AND t.status_deleted = false
             GROUP BY category_group`,
            [branchId, startDate, endDate]
        );

        // Map to standard format
        const incomeBreakdown = incomeBreakdownResult.map(item => ({
            category_name: item.category_group,
            total: parseFloat(item.total) || 0
        }));

        // Upsert record (mantain manual fields)
        const report = await BranchReport.upsert(branchId, month, year, {
            omzetTotal,
            pengeluaranTotal,
        });

        const profit = omzetTotal - pengeluaranTotal;

        return res.json({
            success: true,
            data: {
                report: {
                    ...report,
                    profit,
                    pelunasan_piutang_bulan_lalu: pelunasanPiutangBulanLalu,
                    prev_month_label: prevMonthName,
                    income_breakdown: incomeBreakdown,
                    expense_breakdown: expenseBreakdown
                },
            },
        });
    } catch (error) {
        next(error);
    }
};

/**
 * PUT /api/branch-reports/:branchId?month=2&year=2026
 *
 * Simpan input manual: sales_channels, bagi_hasil, stok_awal, stok_akhir
 */
const updateReport = async (req, res, next) => {
    try {
        const { branchId } = req.params;
        const month = parseInt(req.query.month) || new Date().getMonth() + 1;
        const year = parseInt(req.query.year) || new Date().getFullYear();

        // Validasi akses
        const hasAccess = await Branch.userHasAccess(req.userId, parseInt(branchId), req.user.role);
        if (!hasAccess) {
            return res.status(403).json({ success: false, message: 'Akses ditolak' });
        }

        const { sales_channels, bagi_hasil, stok_awal, stok_akhir } = req.body;

        // Validasi format
        if (sales_channels !== undefined && !Array.isArray(sales_channels)) {
            return res.status(400).json({ success: false, message: 'sales_channels harus berupa array' });
        }
        if (bagi_hasil !== undefined && !Array.isArray(bagi_hasil)) {
            return res.status(400).json({ success: false, message: 'bagi_hasil harus berupa array' });
        }

        const updated = await BranchReport.updateManual(branchId, month, year, {
            salesChannels: sales_channels,
            bagiHasil: bagi_hasil,
            stokAwal: stok_awal !== undefined ? parseFloat(stok_awal) : undefined,
            stokAkhir: stok_akhir !== undefined ? parseFloat(stok_akhir) : undefined,
        });

        if (!updated) {
            return res.status(404).json({ success: false, message: 'Laporan tidak ditemukan, fetch dulu' });
        }

        const profit = (updated.omzet_total || 0) - (updated.pengeluaran_total || 0);

        return res.json({
            success: true,
            message: 'Laporan berhasil disimpan',
            data: {
                report: {
                    ...updated,
                    profit,
                },
            },
        });
    } catch (error) {
        next(error);
    }
};

const exportPdf = async (req, res, next) => {
    try {
        const { branchId } = req.params;
        const month = parseInt(req.query.month) || new Date().getMonth() + 1;
        const year = parseInt(req.query.year) || new Date().getFullYear();
        const workingDays = parseInt(req.query.workingDays) || 25;

        // Reuse getReport logic but return file
        const branch = await Branch.findById(branchId);
        if (!branch) return res.status(404).json({ success: false, message: 'Branch not found' });

        // Validasi akses
        const hasAccess = await Branch.userHasAccess(req.userId, parseInt(branchId), req.user.role);
        if (!hasAccess) {
            return res.status(403).json({ success: false, message: 'Akses ditolak' });
        }

        // Logic replicate from getReport
        const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
        const daysInMonth = new Date(year, month, 0).getDate();
        const endDate = `${year}-${String(month).padStart(2, '0')}-${String(daysInMonth).padStart(2, '0')}`;
        const prevMonthDate = new Date(year, month - 2, 1);
        const prevMonthName = prevMonthDate.toLocaleDateString('id-ID', { month: 'long', year: 'numeric' });

        const incomeResult = await query(
            `SELECT SUM(CASE WHEN (is_debt_payment = true OR is_debt_payment = 1) THEN COALESCE(paid_amount, 0) ELSE amount END) as total FROM transactions WHERE branch_id = ? AND type = 'income' AND (is_umum = true OR is_umum IS NULL) AND transaction_date BETWEEN ? AND ? AND status_deleted = false`,
            [branchId, startDate, endDate]
        );
        const omzetTotal = parseFloat(incomeResult[0].total) || 0;

        const expenseResult = await query(
            `SELECT SUM(amount) as total FROM transactions WHERE branch_id = ? AND type = 'expense' AND (is_umum = true OR is_umum IS NULL) AND transaction_date BETWEEN ? AND ? AND status_deleted = false`,
            [branchId, startDate, endDate]
        );
        const pengeluaranTotal = parseFloat(expenseResult[0].total) || 0;

        const expenseBreakdown = await query(
            `SELECT COALESCE(c.name, 'Lain-lain') as category_name, SUM(t.amount) as total FROM transactions t LEFT JOIN categories c ON t.category_id = c.id WHERE t.branch_id = ? AND t.type = 'expense' AND (t.is_umum = true OR t.is_umum IS NULL) AND t.transaction_date BETWEEN ? AND ? AND t.status_deleted = false GROUP BY c.name`,
            [branchId, startDate, endDate]
        );

        const debtRepaymentResult = await query(
            `SELECT SUM(tr.amount) as total FROM transaction_repayments tr JOIN transactions t ON tr.transaction_id = t.id WHERE tr.payment_date BETWEEN ? AND ? AND t.transaction_date < ? AND t.branch_id = ?`,
            [startDate, endDate, startDate, branchId]
        );
        const pelunasanPiutangBulanLalu = parseFloat(debtRepaymentResult[0].total) || 0;

        const incomeBreakdownResult = await query(
            `SELECT CASE WHEN c.is_folder = true THEN c.name ELSE 'Lain-lain' END as category_group, SUM(CASE WHEN (t.is_debt_payment = true OR t.is_debt_payment = 1) THEN COALESCE(t.paid_amount, 0) ELSE t.amount END) as total FROM transactions t LEFT JOIN categories c ON t.category_id = c.id WHERE t.branch_id = ? AND t.type = 'income' AND (t.is_umum = true OR t.is_umum IS NULL) AND t.transaction_date BETWEEN ? AND ? AND t.status_deleted = false GROUP BY category_group`,
            [branchId, startDate, endDate]
        );
        const incomeBreakdown = incomeBreakdownResult.map(item => ({ category_name: item.category_group, total: parseFloat(item.total) || 0 }));

        const report = await BranchReport.upsert(branchId, month, year, { omzetTotal, pengeluaranTotal });

        const dataForPdf = {
            ...report,
            omzet_total: omzetTotal,
            pengeluaran_total: pengeluaranTotal,
            pelunasan_piutang_bulan_lalu: pelunasanPiutangBulanLalu,
            prev_month_label: prevMonthName,
            income_breakdown: incomeBreakdown,
            expense_breakdown: expenseBreakdown
        };

        const { exportFinancialReportToPDF, generateFilename, getMimeType } = require('../utils/exportHelper');
        const filename = generateFilename('PDF', `Laporan_Keuangan_${branch.name}`);
        const selectedMonthDate = new Date(year, month - 1, 1);

        const filepath = await exportFinancialReportToPDF(dataForPdf, filename, branch.name, selectedMonthDate, workingDays);

        const fs = require('fs');
        res.setHeader('Content-Type', getMimeType('PDF'));
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

        const fileStream = fs.createReadStream(filepath);
        fileStream.pipe(res);

        fileStream.on('end', () => {
            setTimeout(() => {
                fs.unlink(filepath, (err) => { if (err) console.error(err); });
            }, 5000);
        });
    } catch (error) {
        next(error);
    }
};

module.exports = { getReport, updateReport, exportPdf };
