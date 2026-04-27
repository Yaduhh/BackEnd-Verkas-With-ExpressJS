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

        // 1. Omzet Total (Kas Umum) - Only include regular income (NOT debt payments)
        // SYNC WITH ADD/EDIT: Use (paid_amount if debt else amount) + pb1, AND filter is_umum = true

        // AUDIT LOG: Temukan transaksi yang kategorinya 'Kas Simpanan' tapi is_savings-nya FALSE
        const suspiciousSavings = await query(
            `SELECT t.id, t.amount, t.note, t.transaction_date, c.name as category_name
             FROM transactions t
             JOIN categories c ON t.category_id = c.id
             WHERE t.branch_id = ? 
               AND t.transaction_date BETWEEN ? AND ? 
               AND t.status_deleted = false
               AND (t.is_savings = 0 OR t.is_savings IS NULL)
               AND c.name LIKE '%Kas Simpanan%'`,
            [branchId, startDate, endDate]
        );


        const incomeResult = await query(
            `SELECT SUM(
                CASE 
                    WHEN (t.is_debt_payment = 1 OR t.is_debt_payment = true) THEN COALESCE(t.paid_amount, 0) 
                    ELSE t.amount 
                END + COALESCE(t.pb1, 0)
             ) as total 
             FROM transactions t
             LEFT JOIN categories c ON t.category_id = c.id
             WHERE t.branch_id = ? 
               AND t.type = 'income' 
               AND t.transaction_date BETWEEN ? AND ? 
               AND t.status_deleted = false
               AND t.is_umum = true
               AND (c.name NOT LIKE '%Kas Simpanan%' OR c.name IS NULL)`,
            [branchId, startDate, endDate]
        );

        const systemOmzet = parseFloat(incomeResult[0].total) || 0;

        // 2. Pengeluaran Breakdown (Net per Category)
        // SYNC WITH ADD/EDIT: Use (paid_amount if debt else amount) + pb1 for regular expenses
        const expenseBreakdown = await query(
            `SELECT category_name, SUM(total) as total
             FROM (
                /* 1. Pengeluaran Reguler & Retur (Hanya yang BUKAN transaksi simpanan rincian) */
                SELECT COALESCE(c.name, 'Lain-lain') as category_name, 
                       (CASE 
                            WHEN t.type = 'expense' THEN 
                                (CASE WHEN (t.is_debt_payment = 1 OR t.is_debt_payment = true) THEN COALESCE(t.paid_amount, 0) ELSE t.amount END) + COALESCE(t.pb1, 0)
                            ELSE 
                                -(t.amount + COALESCE(t.pb1, 0))
                        END) as total 
                FROM transactions t 
                LEFT JOIN categories c ON t.category_id = c.id 
                WHERE t.branch_id = ? 
                  AND t.transaction_date BETWEEN ? AND ? 
                  AND t.status_deleted = false
                  AND t.is_umum = true
                  AND (t.is_savings = 0 OR t.is_savings IS NULL)
                  AND (
                    t.type = 'expense' 
                    OR (t.type = 'income' AND t.category_id IN (
                       SELECT DISTINCT category_id FROM transactions WHERE branch_id = ? AND type = 'expense' AND status_deleted = false
                    ))
                  )

                UNION ALL

                /* 2. Rincian Simpanan (Diambil dari tabel detail simpanan) */
                SELECT c.name as category_name,
                       tsd.amount as total
                FROM transaction_savings_details tsd
                JOIN transactions t ON tsd.transaction_id = t.id
                JOIN categories c ON tsd.category_id = c.id
                WHERE t.branch_id = ? 
                  AND t.transaction_date BETWEEN ? AND ? 
                  AND t.status_deleted = false
                  AND t.is_umum = true
                  AND t.type = 'expense'
                  AND t.is_savings = 1
             ) as consolidated
             GROUP BY category_name
             HAVING SUM(total) != 0`,
            [branchId, startDate, endDate, branchId, branchId, startDate, endDate]
        );


        // 3. Pengeluaran Total (MUST match the sum of breakdown items + Mitra Piutang)
        const folderPengeluaran = expenseBreakdown.reduce((sum, item) => sum + (parseFloat(item.total) || 0), 0);

        // Fetch Total Mitra Piutang
        const mitraPiutangResult = await query(
            `SELECT (
                SELECT COALESCE(SUM(t.remaining_debt), 0)
                FROM transactions t
                JOIN mitra_piutang mp ON t.mitra_piutang_id = mp.id
                WHERE mp.branch_id = ? AND t.status_deleted = false AND mp.deleted_at IS NULL
                AND NOT EXISTS (SELECT 1 FROM transaction_mitra_details WHERE transaction_id = t.id)
              ) + (
                SELECT COALESCE(SUM(tmd.remaining_debt), 0)
                FROM transaction_mitra_details tmd
                JOIN transactions t ON tmd.transaction_id = t.id
                JOIN mitra_piutang mp ON tmd.mitra_piutang_id = mp.id
                WHERE mp.branch_id = ? AND t.status_deleted = false AND mp.deleted_at IS NULL
              ) as total_piutang`,
            [branchId, branchId]
        );
        const totalPiutangMitra = parseFloat(mitraPiutangResult[0].total_piutang) || 0;

        const systemPengeluaran = folderPengeluaran + totalPiutangMitra;

        // 4. Pelunasan Piutang Bulan Lalu
        const debtRepaymentResult = await query(
            `SELECT SUM(tr.amount) as total
             FROM transaction_repayments tr
             JOIN transactions t ON tr.transaction_id = t.id
             WHERE tr.payment_date BETWEEN ? AND ?
               AND t.transaction_date < ?
               AND t.branch_id = ?
               AND t.status_deleted = false`,
            [startDate, endDate, startDate, branchId]
        );
        const pelunasanPiutangBulanLalu = parseFloat(debtRepaymentResult[0].total) || 0;

        // 5. Pendapatan Breakdown (By Category) 
        // SYNC WITH ADD/EDIT: Include PB1 and filter is_umum = true
        const incomeBreakdownResult = await query(
            `SELECT 
                COALESCE(c.name, 'Tanpa Kategori') as category_name,
                t.is_debt_payment,
                SUM(t.amount + COALESCE(t.pb1, 0)) as total,
                (SELECT COUNT(*) FROM transactions t2 WHERE t2.category_id = t.category_id AND t2.type = 'expense' AND t2.status_deleted = false AND t2.branch_id = t.branch_id) as has_expense
             FROM transactions t
             LEFT JOIN categories c ON t.category_id = c.id
             WHERE t.branch_id = ?
               AND t.type = 'income'
               AND t.transaction_date BETWEEN ? AND ?
               AND t.status_deleted = false
               AND t.is_umum = true
               AND (c.name NOT LIKE '%Kas Simpanan%' OR c.name IS NULL)
             GROUP BY category_name, t.is_debt_payment, t.category_id`,
            [branchId, startDate, endDate]
        );

        // Group them into the display format
        const groupedIncome = {
            'OMZET PENJUALAN': 0,
            'Lain-lain': 0
        };

        incomeBreakdownResult.forEach(item => {
            const amount = parseFloat(item.total) || 0;
            const hasExpense = parseInt(item.has_expense) > 0;

            if (item.category_name === 'OMZET PENJUALAN') {
                // Untuk Omzet Penjualan, masukkan SEMUA (Cash + Pelunasan)
                groupedIncome['OMZET PENJUALAN'] += amount;
            } else {
                // Untuk kategori lain, balik ke logic awal yang saklek:
                // 1. Bukan pelunasan hutang
                // 2. Kategori tersebut tidak boleh punya transaksi 'expense' (has_expense == 0)
                if ((!item.is_debt_payment || item.is_debt_payment == 0) && !hasExpense) {
                    groupedIncome['Lain-lain'] += amount;
                }
            }
        });

        const incomeBreakdown = Object.entries(groupedIncome).map(([name, total]) => ({
            category_name: name,
            total: total
        }));

        // Total Income = Folders + Previous Month Repayments
        const finalOmzetTotal = incomeBreakdown.reduce((sum, item) => sum + item.total, 0) + pelunasanPiutangBulanLalu;

        const report = await BranchReport.upsert(branchId, month, year, {
            omzetTotal: finalOmzetTotal,
            pengeluaranTotal: systemPengeluaran,
        });

        const finalProfit = finalOmzetTotal - systemPengeluaran;

        return res.json({
            success: true,
            data: {
                report: {
                    ...report,
                    profit: finalProfit,
                    pelunasan_piutang_bulan_lalu: pelunasanPiutangBulanLalu,
                    prev_month_label: prevMonthName,
                    income_breakdown: incomeBreakdown,
                    expense_breakdown: expenseBreakdown // Use raw breakdown from query
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

        const { sales_channels, bagi_hasil, expense_adjustments, expense_order, stok_awal, stok_akhir, working_days } = req.body;

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
            expenseAdjustments: expense_adjustments,
            expenseOrder: expense_order,
            stokAwal: stok_awal !== undefined ? parseFloat(stok_awal) : undefined,
            stokAkhir: stok_akhir !== undefined ? parseFloat(stok_akhir) : undefined,
            workingDays: working_days !== undefined ? parseInt(working_days) : undefined,
        });

        if (!updated) {
            return res.status(404).json({ success: false, message: 'Laporan tidak ditemukan, fetch dulu' });
        }

        // Recalculate profit consistently with getReport
        const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
        const daysInMonth = new Date(year, month, 0).getDate();
        const endDate = `${year}-${String(month).padStart(2, '0')}-${String(daysInMonth).padStart(2, '0')}`;

        const incomeResult = await query(
            `SELECT SUM(
                CASE 
                    WHEN (t.is_debt_payment = 1 OR t.is_debt_payment = true) THEN COALESCE(t.paid_amount, 0) 
                    ELSE t.amount 
                END + COALESCE(t.pb1, 0)
             ) as total 
             FROM transactions t
             LEFT JOIN categories c ON t.category_id = c.id
             WHERE t.branch_id = ? 
               AND t.type = 'income' 
               AND t.transaction_date BETWEEN ? AND ? 
               AND t.status_deleted = false
               AND t.is_umum = true
               AND (c.name NOT LIKE '%Kas Simpanan%' OR c.name IS NULL)`,
            [branchId, startDate, endDate]
        );
        const systemOmzet = parseFloat(incomeResult[0].total) || 0;

        // Recalculate net expense consistently with getReport logic
        const folderResult = await query(
            `SELECT SUM(category_total) as grand_total FROM (
                SELECT SUM(
                    CASE 
                        WHEN t.type = 'expense' THEN 
                            (CASE WHEN (t.is_debt_payment = 1 OR t.is_debt_payment = true) THEN COALESCE(t.paid_amount, 0) ELSE t.amount END) + COALESCE(t.pb1, 0)
                        ELSE 
                            -(t.amount + COALESCE(t.pb1, 0))
                    END
                ) as category_total 
                FROM transactions t 
                LEFT JOIN categories c ON t.category_id = c.id 
                WHERE t.branch_id = ? 
                  AND t.transaction_date BETWEEN ? AND ? 
                  AND t.status_deleted = false
                  AND t.is_umum = true
                  AND (
                    t.type = 'expense' 
                    OR (t.type = 'income' AND t.category_id IN (
                       SELECT DISTINCT category_id FROM transactions WHERE branch_id = ? AND type = 'expense' AND status_deleted = false
                    ))
                  )
                GROUP BY c.name
                HAVING SUM(CASE WHEN t.type = 'expense' THEN 1 ELSE 0 END) > 0
            ) as subtotals`,
            [branchId, startDate, endDate, branchId]
        );
        const folderPengeluaran = parseFloat(folderResult[0].grand_total) || 0;

        const mitraPiutangResult = await query(
            `SELECT (
                SELECT COALESCE(SUM(t.remaining_debt), 0)
                FROM transactions t
                JOIN mitra_piutang mp ON t.mitra_piutang_id = mp.id
                WHERE mp.branch_id = ? AND t.status_deleted = false AND mp.deleted_at IS NULL
                AND NOT EXISTS (SELECT 1 FROM transaction_mitra_details WHERE transaction_id = t.id)
              ) + (
                SELECT COALESCE(SUM(tmd.remaining_debt), 0)
                FROM transaction_mitra_details tmd
                JOIN transactions t ON tmd.transaction_id = t.id
                JOIN mitra_piutang mp ON tmd.mitra_piutang_id = mp.id
                WHERE mp.branch_id = ? AND t.status_deleted = false AND mp.deleted_at IS NULL
              ) as total_piutang`,
            [branchId, branchId]
        );
        const totalPiutangMitra = parseFloat(mitraPiutangResult[0].total_piutang) || 0;
        const systemPengeluaran = folderPengeluaran + totalPiutangMitra;

        const debtRepaymentResult = await query(
            `SELECT SUM(tr.amount) as total FROM transaction_repayments tr JOIN transactions t ON tr.transaction_id = t.id WHERE tr.payment_date BETWEEN ? AND ? AND t.transaction_date < ? AND t.branch_id = ? AND t.status_deleted = false`,
            [startDate, endDate, startDate, branchId]
        );
        const pelunasanPiutangBulanLalu = parseFloat(debtRepaymentResult[0].total) || 0;

        // Total Income = Folders + Previous Month Repayments
        const finalOmzetTotal = systemOmzet + pelunasanPiutangBulanLalu;

        await BranchReport.upsert(branchId, month, year, {
            omzetTotal: finalOmzetTotal,
            pengeluaranTotal: systemPengeluaran
        });

        const finalProfit = finalOmzetTotal - systemPengeluaran;


        return res.json({
            success: true,
            message: 'Laporan berhasil disimpan',
            data: {
                report: {
                    ...updated,
                    omzet_total: finalOmzetTotal,
                    profit: finalProfit,
                    pelunasan_piutang_bulan_lalu: pelunasanPiutangBulanLalu
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
            `SELECT SUM(
                CASE 
                    WHEN (t.is_debt_payment = 1 OR t.is_debt_payment = true) THEN COALESCE(t.paid_amount, 0) 
                    ELSE t.amount 
                END + COALESCE(t.pb1, 0)
             ) as total 
             FROM transactions t
             LEFT JOIN categories c ON t.category_id = c.id
             WHERE t.branch_id = ? 
               AND t.type = 'income' 
               AND t.transaction_date BETWEEN ? AND ? 
               AND t.status_deleted = false
               AND t.is_umum = true
               AND (c.name NOT LIKE '%Kas Simpanan%' OR c.name IS NULL)`,
            [branchId, startDate, endDate]
        );
        const systemOmzet = parseFloat(incomeResult[0].total) || 0;

        const expenseBreakdown = await query(
            `SELECT category_name, SUM(total) as total
             FROM (
                /* 1. Pengeluaran Reguler & Retur (Hanya yang BUKAN transaksi simpanan rincian) */
                SELECT COALESCE(c.name, 'Lain-lain') as category_name, 
                       (CASE 
                            WHEN t.type = 'expense' THEN 
                                (CASE WHEN (t.is_debt_payment = 1 OR t.is_debt_payment = true) THEN COALESCE(t.paid_amount, 0) ELSE t.amount END) + COALESCE(t.pb1, 0)
                            ELSE 
                                -(t.amount + COALESCE(t.pb1, 0))
                        END) as total 
                FROM transactions t 
                LEFT JOIN categories c ON t.category_id = c.id 
                WHERE t.branch_id = ? 
                  AND t.transaction_date BETWEEN ? AND ? 
                  AND t.status_deleted = false
                  AND t.is_umum = true
                  AND (t.is_savings = 0 OR t.is_savings IS NULL)
                  AND (
                    t.type = 'expense' 
                    OR (t.type = 'income' AND t.category_id IN (
                       SELECT DISTINCT category_id FROM transactions WHERE branch_id = ? AND type = 'expense' AND status_deleted = false
                    ))
                  )

                UNION ALL

                /* 2. Rincian Simpanan (Diambil dari tabel detail simpanan) */
                SELECT c.name as category_name,
                       tsd.amount as total
                FROM transaction_savings_details tsd
                JOIN transactions t ON tsd.transaction_id = t.id
                JOIN categories c ON tsd.category_id = c.id
                WHERE t.branch_id = ? 
                  AND t.transaction_date BETWEEN ? AND ? 
                  AND t.status_deleted = false
                  AND t.is_umum = true
                  AND t.type = 'expense'
                  AND t.is_savings = 1
             ) as consolidated
             GROUP BY category_name
             HAVING SUM(total) != 0`,
            [branchId, startDate, endDate, branchId, branchId, startDate, endDate]
        );
        const folderPengeluaran = expenseBreakdown.reduce((sum, item) => sum + (parseFloat(item.total) || 0), 0);

        const mitraPiutangResult = await query(
            `SELECT (
                SELECT COALESCE(SUM(t.remaining_debt), 0)
                FROM transactions t
                JOIN mitra_piutang mp ON t.mitra_piutang_id = mp.id
                WHERE mp.branch_id = ? AND t.status_deleted = false AND mp.deleted_at IS NULL
                AND NOT EXISTS (SELECT 1 FROM transaction_mitra_details WHERE transaction_id = t.id)
              ) + (
                SELECT COALESCE(SUM(tmd.remaining_debt), 0)
                FROM transaction_mitra_details tmd
                JOIN transactions t ON tmd.transaction_id = t.id
                JOIN mitra_piutang mp ON tmd.mitra_piutang_id = mp.id
                WHERE mp.branch_id = ? AND t.status_deleted = false AND mp.deleted_at IS NULL
              ) as total_piutang`,
            [branchId, branchId]
        );
        const totalPiutangMitra = parseFloat(mitraPiutangResult[0].total_piutang) || 0;
        const systemPengeluaran = folderPengeluaran + totalPiutangMitra;

        const debtRepaymentResult = await query(
            `SELECT SUM(tr.amount) as total FROM transaction_repayments tr JOIN transactions t ON tr.transaction_id = t.id WHERE tr.payment_date BETWEEN ? AND ? AND t.transaction_date < ? AND t.branch_id = ? AND t.status_deleted = false`,
            [startDate, endDate, startDate, branchId]
        );
        const pelunasanPiutangBulanLalu = parseFloat(debtRepaymentResult[0].total) || 0;

        const incomeBreakdownRaw = await query(
            `SELECT 
                COALESCE(c.name, 'Lain-lain') as category_name, 
                SUM(t.amount + COALESCE(t.pb1, 0)) as total,
                t.is_debt_payment,
                (SELECT COUNT(*) FROM transactions WHERE category_id = t.category_id AND type = 'expense' AND status_deleted = false) as has_expense
             FROM transactions t 
             LEFT JOIN categories c ON t.category_id = c.id 
             WHERE t.branch_id = ? 
               AND t.type = 'income' 
               AND t.transaction_date BETWEEN ? AND ? 
               AND t.status_deleted = false 
               AND t.is_umum = true
               AND (c.name NOT LIKE '%Kas Simpanan%' OR c.name IS NULL)
             GROUP BY category_name, t.is_debt_payment, t.category_id`,
            [branchId, startDate, endDate]
        );

        const groupedIncome = {
            'OMZET PENJUALAN': 0,
            'Lain-lain': 0
        };

        incomeBreakdownRaw.forEach(item => {
            const amount = parseFloat(item.total) || 0;
            const hasExpense = parseInt(item.has_expense) > 0;

            if (item.category_name === 'OMZET PENJUALAN') {
                groupedIncome['OMZET PENJUALAN'] += amount;
            } else {
                if ((!item.is_debt_payment || item.is_debt_payment == 0) && !hasExpense) {
                    groupedIncome['Lain-lain'] += amount;
                }
            }
        });

        const incomeBreakdown = Object.entries(groupedIncome).map(([name, total]) => ({
            category_name: name,
            total: total
        }));

        // Fetch existing manual report data
        const reportInDb = await BranchReport.findByBranchAndPeriod(branchId, month, year);
        const manualSalesTotal = (reportInDb?.sales_channels || []).reduce((sum, sc) => sum + (Number(sc.amount) || 0), 0);

        const finalOmzetTotal = incomeBreakdown.reduce((sum, item) => sum + item.total, 0) + pelunasanPiutangBulanLalu;
        const finalProfit = finalOmzetTotal - systemPengeluaran;

        const report = await BranchReport.upsert(branchId, month, year, {
            omzetTotal: finalOmzetTotal,
            pengeluaranTotal: systemPengeluaran
        });

        // APPLY EXPENSE ADJUSTMENTS AND SORTING FOR PDF
        const adjustmentsByParent = {};
        if (report.expense_adjustments && report.expense_adjustments.length > 0) {
            report.expense_adjustments.forEach(adj => {
                if (!adjustmentsByParent[adj.parent_category]) {
                    adjustmentsByParent[adj.parent_category] = [];
                }
                adjustmentsByParent[adj.parent_category].push(adj);
            });
        }

        // Initialize processed layout
        let processedExpenseBreakdown = [];

        // 1. Sort the raw categories based on custom order if exists
        let sortedCategories = [...expenseBreakdown];
        
        // Add PIUTANG Mitra to the raw list so it can be sorted/displayed
        const piutangLabel = `PIUTANG ${prevMonthName.toUpperCase()}`;
        if (totalPiutangMitra > 0) {
            sortedCategories.push({
                category_name: piutangLabel,
                total: totalPiutangMitra
            });
        }

        if (report.expense_order && Array.isArray(report.expense_order)) {
            const orderMap = {};
            report.expense_order.forEach((name, idx) => { orderMap[name] = idx; });

            sortedCategories.sort((a, b) => {
                const orderA = orderMap[a.category_name] !== undefined ? orderMap[a.category_name] : 1000;
                const orderB = orderMap[b.category_name] !== undefined ? orderMap[b.category_name] : 1000;
                return orderA - orderB;
            });
        }

        // 2. Build the final flat list with adjustments right after their parents
        sortedCategories.forEach(item => {
            const adjs = adjustmentsByParent[item.category_name] || [];
            const adjTotal = adjs.reduce((sum, a) => sum + (parseFloat(a.amount) || 0), 0);
            const parentTotal = (parseFloat(item.total) || 0) - adjTotal;

            // Only add parent if it has value
            if (Math.abs(parentTotal) > 0.01) {
                processedExpenseBreakdown.push({
                    category_name: item.category_name,
                    total: parentTotal
                });
            }

            // Add adjustments directly under the parent
            adjs.forEach(adj => {
                if (Math.abs(parseFloat(adj.amount) || 0) > 0.01) {
                    processedExpenseBreakdown.push({
                        category_name: adj.name,
                        total: parseFloat(adj.amount) || 0,
                        is_adjustment: true
                    });
                }
            });
        });

        const dataForPdf = {
            ...report,
            omzet_total: finalOmzetTotal,
            pengeluaran_total: systemPengeluaran,
            profit: finalProfit,
            pelunasan_piutang_bulan_lalu: pelunasanPiutangBulanLalu,
            prev_month_label: prevMonthName,
            income_breakdown: incomeBreakdown,
            expense_breakdown: processedExpenseBreakdown
        };

        const { exportFinancialReportToPDF, generateFilename, getMimeType } = require('../utils/exportHelper');
        const filename = generateFilename('PDF', `Laporan_Keuangan_${branch.name}`);
        const selectedMonthDate = new Date(year, month - 1, 1);

        try {
            const filepath = await exportFinancialReportToPDF(dataForPdf, filename, branch.name, selectedMonthDate, report.working_days || workingDays);

            const fs = require('fs');
            if (!fs.existsSync(filepath)) {
                return res.status(500).json({ success: false, message: 'File PDF gagal dibuat' });
            }

            res.setHeader('Content-Type', getMimeType('PDF') || 'application/pdf');
            res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

            const fileStream = fs.createReadStream(filepath);
            fileStream.pipe(res);

            fileStream.on('end', () => {
                setTimeout(() => {
                    fs.unlink(filepath, (err) => {
                        if (err) console.error(`[EXPORT] Error deleting temp file:`, err);
                    });
                }, 10000);
            });

            fileStream.on('error', (streamErr) => {
                console.error(`[EXPORT] Stream Error:`, streamErr);
                if (!res.headersSent) {
                    res.status(500).json({ success: false, message: 'Gagal mengirim file PDF' });
                }
            });

        } catch (pdfError) {
            console.error(`[EXPORT] PDF Gen Error:`, pdfError);
            return res.status(500).json({ success: false, message: 'Gagal memproses PDF: ' + pdfError.message });
        }
    } catch (error) {
        console.error(`[EXPORT] Global Controller Error:`, error);
        next(error);
    }
};

module.exports = { getReport, updateReport, exportPdf };
