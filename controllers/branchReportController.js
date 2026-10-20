const Branch = require('../models/Branch');
const BranchReport = require('../models/BranchReport');
const Category = require('../models/Category');
const Transaction = require('../models/Transaction');
const BagiHasilTemplate = require('../models/BagiHasilTemplate');
const ExpenseOrderTemplate = require('../models/ExpenseOrderTemplate');
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
               AND t.status_deleted = false AND (t.is_draft = false OR t.is_draft IS NULL)
               AND (t.is_savings = 0 OR t.is_savings IS NULL)
               AND c.name LIKE '%Kas Simpanan%'`,
            [branchId, startDate, endDate]
        );


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

        const systemOmzetGross = (parseFloat(incomeResult[0].total_gross) || 0) - pastIncomeRefunds;
        const systemTaxable = parseFloat(incomeResult[0].taxable_amount) || 0;
        const systemOmzet = systemOmzetGross - Math.round((systemTaxable * 10) / 110);

        // 2. Pengeluaran Breakdown (Net per Category, Period-Aware regarding refunds)
        // SYNC WITH ADD/EDIT: Use (paid_amount if debt else amount) + pb1 for regular expenses
        let expenseBreakdown = await query(
            `SELECT category_name, SUM(total) as total
             FROM (
                /* 1. Pengeluaran Reguler & Retur dalam periode */
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

                /* 2. Rincian Simpanan (Diambil dari tabel detail simpanan) */
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

                /* 3. Refund yang terjadi di periode ini untuk transaksi pengeluaran sebelum startDate */
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

        // Fetch product items (Rincian Kategori) for expense transactions (strictly at product level, not brand)
        try {
            const recordedProductItems = await query(
                `SELECT 
                    COALESCE(c.name, pc.name, 'Lain-lain') as category_name,
                    p.id as product_id,
                    p.name as product_name,
                    SUM(tpi.amount) as total_amount
                 FROM transaction_product_items tpi
                 JOIN products p ON tpi.product_id = p.id
                 JOIN transactions t ON tpi.transaction_id = t.id
                 LEFT JOIN categories c ON t.category_id = c.id
                 LEFT JOIN categories pc ON p.category_id = pc.id
                 WHERE t.branch_id = ?
                   AND t.transaction_date BETWEEN ? AND ?
                   AND t.status_deleted = false AND (t.is_draft = false OR t.is_draft IS NULL)
                   AND t.is_umum = true
                   AND t.type = 'expense'
                 GROUP BY category_name, p.id, p.name
                 HAVING total_amount > 0
                 ORDER BY total_amount DESC`,
                [branchId, startDate, endDate]
            );

            const branchProducts = await query(
                `SELECT p.id, p.name, p.category_id, c.name as category_name
                 FROM products p
                 JOIN categories c ON p.category_id = c.id
                 WHERE p.branch_id = ? AND p.status_deleted = 0 AND p.is_active = 1`,
                [branchId]
            );

            const categoryItemsMap = {};
            for (const item of recordedProductItems) {
                const catName = item.category_name;
                if (!categoryItemsMap[catName]) categoryItemsMap[catName] = {};
                const pName = item.product_name.trim();
                categoryItemsMap[catName][pName] = (categoryItemsMap[catName][pName] || 0) + (parseFloat(item.total_amount) || 0);
            }

            expenseBreakdown = expenseBreakdown.map(item => {
                const itemsObj = categoryItemsMap[item.category_name] || {};

                // Get all master products registered for this category
                const catMasterProducts = branchProducts.filter(p => 
                    p.category_name && item.category_name && 
                    p.category_name.toLowerCase().trim() === item.category_name.toLowerCase().trim()
                );

                // Build a combined map: all master products first, then any extra transaction items
                const fullItemsMap = {};

                // 1. Initialize all master products with their amount (or 0 if not transacted)
                for (const mp of catMasterProducts) {
                    const pName = mp.name.trim();
                    fullItemsMap[pName] = itemsObj[pName] !== undefined ? itemsObj[pName] : 0;
                }

                // 2. Add any items from transactions that might not be in master products
                for (const [pName, amt] of Object.entries(itemsObj)) {
                    if (fullItemsMap[pName] === undefined) {
                        fullItemsMap[pName] = amt;
                    }
                }

                const items = Object.entries(fullItemsMap)
                    .map(([pName, amt]) => ({
                        product_name: pName,
                        amount: amt
                    }))
                    .sort((a, b) => {
                        // Sort by amount DESC first, then alphabetical for items with same amount
                        if (b.amount !== a.amount) {
                            return b.amount - a.amount;
                        }
                        return a.product_name.localeCompare(b.product_name);
                    });

                return {
                    ...item,
                    total: parseFloat(item.total) || 0,
                    items: items
                };
            });
        } catch (err) {
            console.error('Error attaching category rincian items:', err);
        }

        // 3. Pengeluaran Total (MUST match the sum of breakdown items + Mitra Piutang)
        const folderPengeluaran = expenseBreakdown.reduce((sum, item) => sum + (parseFloat(item.total) || 0), 0);

        // Fetch Total Mitra Piutang
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
              endDate + ' 23:59:59',
              branchId,
              startDate + ' 00:00:00',
              endDate + ' 23:59:59',
              endDate + ' 23:59:59',
              branchId,
              startDate + ' 00:00:00',
              endDate + ' 23:59:59'
            ]
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
               AND t.status_deleted = false AND (t.is_draft = false OR t.is_draft IS NULL)`,
            [startDate, endDate, startDate, branchId]
        );
        const pelunasanPiutangBulanLalu = parseFloat(debtRepaymentResult[0].total) || 0;

        // 5. Pendapatan Breakdown (By Category) 
        // SYNC WITH ADD/EDIT: Include PB1 and filter is_umum = true
        const incomeBreakdownResult = await query(
            `SELECT 
                t.category_id,
                COALESCE(c.name, 'Lain-lain') as category_name,
                t.is_debt_payment,
                SUM(t.amount + COALESCE(future_ref.amount, 0)) as total_gross,
                SUM(
                    COALESCE((
                        SELECT SUM(tid.amount_app)
                        FROM transaction_income_details tid
                        JOIN payment_methods pm ON tid.payment_method_id = pm.id
                        WHERE tid.transaction_id = t.id AND pm.is_taxable = 1
                    ), 0)
                ) as taxable_amount,
                (SELECT COUNT(*) FROM transactions t2 WHERE t2.category_id = t.category_id AND t2.type = 'expense' AND t2.status_deleted = false AND t2.branch_id = t.branch_id) as has_expense
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
             GROUP BY category_name, t.is_debt_payment, t.category_id`,
            [endDate, branchId, startDate, endDate]
        );

        // Group them into the display format
        const groupedIncome = {
            'OMZET PENJUALAN': { total_net: 0, total_tax: 0, category_id: null },
            'Pendapatan Lain-lain': { total_net: 0, total_tax: 0, category_id: null }
        };
        
        incomeBreakdownResult.forEach(item => {
            const gross = parseFloat(item.total_gross) || 0;
            const taxable = parseFloat(item.taxable_amount) || 0;
            const tax = Math.round((taxable * 10) / 110);
            const net = gross - tax;

            const nameUpper = item.category_name.toUpperCase();
            const hasExpense = parseInt(item.has_expense) > 0;

            // Check if it's an Omzet variation
            const isOmzet = nameUpper.includes('OMZET') || nameUpper.includes('OMSET');

            if (isOmzet) {
                groupedIncome['OMZET PENJUALAN'].total_net += net;
                groupedIncome['OMZET PENJUALAN'].total_tax += tax;
                if (!groupedIncome['OMZET PENJUALAN'].category_id && item.category_id) {
                    groupedIncome['OMZET PENJUALAN'].category_id = item.category_id;
                }
            } else {
                if ((!item.is_debt_payment || item.is_debt_payment == 0) && !hasExpense) {
                    groupedIncome['Pendapatan Lain-lain'].total_net += net;
                    groupedIncome['Pendapatan Lain-lain'].total_tax += tax;
                    if (!groupedIncome['Pendapatan Lain-lain'].category_id && item.category_id) {
                        groupedIncome['Pendapatan Lain-lain'].category_id = item.category_id;
                    }
                }
            }
        });

        const incomeBreakdown = Object.entries(groupedIncome).map(([name, data]) => ({
            category_id: data.category_id,
            category_name: name,
            total_net: data.total_net,
            total_tax: data.total_tax,
            total: data.total_net + data.total_tax // Gross for backward compatibility in some views if needed
        }));

        // Total Income = Folders (NET) + Previous Month Repayments
        const finalOmzetTotal = incomeBreakdown.reduce((sum, item) => sum + item.total_net, 0) + pelunasanPiutangBulanLalu;

        const report = await BranchReport.upsert(branchId, month, year, {
            omzetTotal: finalOmzetTotal,
            pengeluaranTotal: systemPengeluaran,
        });

        // Apply default expense order template if report has no expense order yet
        if ((!report.expense_order || report.expense_order.length === 0)) {
            try {
                const defaultTemplates = await query(
                    `SELECT template_data FROM expense_order_templates WHERE branch_id = ? AND is_default = 1 LIMIT 1`,
                    [branchId]
                );
                if (defaultTemplates.length > 0) {
                    report.expense_order = typeof defaultTemplates[0].template_data === 'string'
                        ? JSON.parse(defaultTemplates[0].template_data)
                        : defaultTemplates[0].template_data;
                }
            } catch (e) {
                console.error('Error applying default expense order template:', e);
            }
        }

        const finalProfit = finalOmzetTotal - systemPengeluaran;

        // 6. Aggregate Sales Channels from recorded transactions in this period (NET after PB1)
        const systemSalesChannelsResult = await query(
            `SELECT 
                sc.id as sales_channel_id,
                sc.name as name,
                COALESCE(SUM(tsc.amount), 0) as gross_amount,
                COALESCE(SUM(
                    CASE 
                        WHEN pm.is_taxable = 1 THEN tsc.amount - ROUND((tsc.amount * 10) / 110)
                        ELSE tsc.amount
                    END
                ), 0) as amount
             FROM sales_channels sc
             JOIN transaction_sales_channels tsc ON sc.id = tsc.sales_channel_id
             JOIN transactions t ON tsc.transaction_id = t.id
             LEFT JOIN payment_methods pm ON COALESCE(
                 tsc.payment_method_id,
                 (SELECT tid.payment_method_id FROM transaction_income_details tid WHERE tid.transaction_id = t.id LIMIT 1)
             ) = pm.id
             WHERE t.branch_id = ?
               AND t.transaction_date BETWEEN ? AND ?
               AND t.status_deleted = false AND (t.is_draft = false OR t.is_draft IS NULL)
               AND t.is_umum = true
               AND t.type = 'income'
             GROUP BY sc.id, sc.name
             HAVING amount > 0
             ORDER BY amount DESC, sc.name ASC`,
            [branchId, startDate, endDate]
        );

        // Fetch active master sales channels for dropdown/selection
        const masterSalesChannelsResult = await query(
            `SELECT id, name, is_active FROM sales_channels
             WHERE branch_id = ?
               AND status_deleted = 0
               AND is_active = 1
             ORDER BY name ASC`,
            [branchId]
        );

        // Calculate omzet transactions without recorded sales channel details (NET after PB1)
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
        const omzetWithoutChannels = Math.max(0, grossWithoutChannels - taxWithoutChannels);

        const systemSalesChannels = systemSalesChannelsResult.map(s => ({
            sales_channel_id: s.sales_channel_id,
            name: s.name,
            amount: parseFloat(s.amount) || 0,
            gross_amount: parseFloat(s.gross_amount) || 0
        }));

        return res.json({
            success: true,
            data: {
                report: {
                    ...report,
                    profit: finalProfit,
                    pelunasan_piutang_bulan_lalu: pelunasanPiutangBulanLalu,
                    prev_month_label: prevMonthName,
                    income_breakdown: incomeBreakdown,
                    expense_breakdown: expenseBreakdown,
                    system_sales_channels: systemSalesChannels,
                    master_sales_channels: masterSalesChannelsResult,
                    unallocated_omzet: omzetWithoutChannels
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

        const systemOmzetGross = (parseFloat(incomeResult[0].total_gross) || 0) - pastIncomeRefunds;
        const systemTaxable = parseFloat(incomeResult[0].taxable_amount) || 0;
        const systemOmzet = systemOmzetGross - Math.round((systemTaxable * 10) / 110);

        // Recalculate net expense consistently with getReport logic
        const folderResult = await query(
            `SELECT SUM(total) as grand_total FROM (
                /* 1. Pengeluaran Reguler & Retur dalam periode */
                SELECT 
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

                /* 2. Rincian Simpanan */
                SELECT tsd.amount as total
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

                /* 3. Refund yang terjadi di periode ini untuk transaksi pengeluaran sebelum startDate */
                SELECT -tr.amount as total
                FROM transaction_refunds tr
                JOIN transactions t ON tr.transaction_id = t.id
                WHERE t.branch_id = ?
                  AND t.type = 'expense'
                  AND tr.refund_date BETWEEN ? AND ?
                  AND t.transaction_date < ?
                  AND t.status_deleted = false AND (t.is_draft = false OR t.is_draft IS NULL)
                  AND t.is_umum = true
                  AND (t.is_savings = 0 OR t.is_savings IS NULL)
            ) as subtotals`,
            [endDate, branchId, startDate, endDate, branchId, branchId, startDate, endDate, branchId, startDate, endDate, startDate]
        );
        const folderPengeluaran = parseFloat(folderResult[0].grand_total) || 0;

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
              endDate + ' 23:59:59',
              branchId,
              startDate + ' 00:00:00',
              endDate + ' 23:59:59',
              endDate + ' 23:59:59',
              branchId,
              startDate + ' 00:00:00',
              endDate + ' 23:59:59'
            ]
        );
        const totalPiutangMitra = parseFloat(mitraPiutangResult[0].total_piutang) || 0;
        const systemPengeluaran = folderPengeluaran + totalPiutangMitra;

        const debtRepaymentResult = await query(
            `SELECT SUM(tr.amount) as total FROM transaction_repayments tr JOIN transactions t ON tr.transaction_id = t.id WHERE tr.payment_date BETWEEN ? AND ? AND t.transaction_date < ? AND t.branch_id = ? AND t.status_deleted = false AND (t.is_draft = false OR t.is_draft IS NULL)`,
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

        // Fetch system sales channels (NET after PB1)
        const systemSalesChannelsResult = await query(
            `SELECT 
                sc.id as sales_channel_id,
                sc.name as name,
                COALESCE(SUM(tsc.amount), 0) as gross_amount,
                COALESCE(SUM(
                    CASE 
                        WHEN pm.is_taxable = 1 THEN tsc.amount - ROUND((tsc.amount * 10) / 110)
                        ELSE tsc.amount
                    END
                ), 0) as amount
             FROM sales_channels sc
             JOIN transaction_sales_channels tsc ON sc.id = tsc.sales_channel_id
             JOIN transactions t ON tsc.transaction_id = t.id
             LEFT JOIN payment_methods pm ON COALESCE(
                 tsc.payment_method_id,
                 (SELECT tid.payment_method_id FROM transaction_income_details tid WHERE tid.transaction_id = t.id LIMIT 1)
             ) = pm.id
             WHERE t.branch_id = ?
               AND t.transaction_date BETWEEN ? AND ?
               AND t.status_deleted = false AND (t.is_draft = false OR t.is_draft IS NULL)
               AND t.is_umum = true
               AND t.type = 'income'
             GROUP BY sc.id, sc.name
             HAVING amount > 0
             ORDER BY amount DESC, sc.name ASC`,
            [branchId, startDate, endDate]
        );

        const masterSalesChannelsResult = await query(
            `SELECT id, name, is_active FROM sales_channels
             WHERE branch_id = ?
               AND status_deleted = 0
               AND is_active = 1
             ORDER BY name ASC`,
            [branchId]
        );

        return res.json({
            success: true,
            message: 'Laporan berhasil disimpan',
            data: {
                report: {
                    ...updated,
                    omzet_total: finalOmzetTotal,
                    profit: finalProfit,
                    pelunasan_piutang_bulan_lalu: pelunasanPiutangBulanLalu,
                    system_sales_channels: systemSalesChannelsResult.map(s => ({
                        sales_channel_id: s.sales_channel_id,
                        name: s.name,
                        amount: parseFloat(s.amount) || 0
                    })),
                    master_sales_channels: masterSalesChannelsResult
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
        const currentMonthDate = new Date(year, month - 1, 1);
        const currentMonthName = currentMonthDate.toLocaleDateString('id-ID', { month: 'long', year: 'numeric' });

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

        const systemOmzetGross = (parseFloat(incomeResult[0].total_gross) || 0) - pastIncomeRefunds;
        const systemTaxable = parseFloat(incomeResult[0].taxable_amount) || 0;
        const systemOmzet = systemOmzetGross - Math.round((systemTaxable * 10) / 110);

        const expenseBreakdown = await query(
            `SELECT category_name, SUM(total) as total
             FROM (
                /* 1. Pengeluaran Reguler & Retur dalam periode */
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

                /* 2. Rincian Simpanan (Diambil dari tabel detail simpanan) */
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

                /* 3. Refund yang terjadi di periode ini untuk transaksi pengeluaran sebelum startDate */
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
              endDate + ' 23:59:59',
              branchId,
              startDate + ' 00:00:00',
              endDate + ' 23:59:59',
              endDate + ' 23:59:59',
              branchId,
              startDate + ' 00:00:00',
              endDate + ' 23:59:59'
            ]
        );
        const totalPiutangMitra = parseFloat(mitraPiutangResult[0].total_piutang) || 0;
        const systemPengeluaran = folderPengeluaran + totalPiutangMitra;

        const debtRepaymentResult = await query(
            `SELECT SUM(tr.amount) as total FROM transaction_repayments tr JOIN transactions t ON tr.transaction_id = t.id WHERE tr.payment_date BETWEEN ? AND ? AND t.transaction_date < ? AND t.branch_id = ? AND t.status_deleted = false AND (t.is_draft = false OR t.is_draft IS NULL)`,
            [startDate, endDate, startDate, branchId]
        );
        const pelunasanPiutangBulanLalu = parseFloat(debtRepaymentResult[0].total) || 0;

        const incomeBreakdownRaw = await query(
            `SELECT 
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
                t.is_debt_payment,
                (SELECT COUNT(*) FROM transactions WHERE category_id = t.category_id AND type = 'expense' AND status_deleted = false) as has_expense
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
             GROUP BY category_name, t.is_debt_payment, t.category_id`,
            [endDate, branchId, startDate, endDate]
        );

        const groupedIncome = {
            'OMZET PENJUALAN': 0,
            'Pendapatan Lain-lain': 0
        };

        incomeBreakdownRaw.forEach(item => {
            const gross = parseFloat(item.total_gross) || 0;
            const taxable = parseFloat(item.taxable_amount) || 0;
            const tax = Math.round((taxable * 10) / 110);
            const net = gross - tax;

            const nameUpper = item.category_name.toUpperCase();
            const hasExpense = parseInt(item.has_expense) > 0;

            // Check if it's an Omzet variation
            const isOmzet = nameUpper.includes('OMZET') || nameUpper.includes('OMSET');

            if (isOmzet) {
                groupedIncome['OMZET PENJUALAN'] += net;
            } else {
                // Original strict logic for Other items:
                if ((!item.is_debt_payment || item.is_debt_payment == 0) && !hasExpense) {
                    groupedIncome['Pendapatan Lain-lain'] += net;
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
        const piutangLabel = `PIUTANG ${currentMonthName.toUpperCase()}`;
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

        // Calculate attachment stats for PDF
        const txsForStats = await query(
            `SELECT t.id, t.lampiran, c.min_attachment as category_min_attachment
             FROM transactions t
             LEFT JOIN categories c ON t.category_id = c.id
             WHERE t.branch_id = ?
               AND t.transaction_date BETWEEN ? AND ?
               AND t.status_deleted = false AND (t.is_draft = false OR t.is_draft IS NULL)
               AND t.is_umum = true
               AND NOT EXISTS (SELECT 1 FROM transaction_repayments tr WHERE tr.income_transaction_id = t.id)`,
            [branchId, startDate, endDate]
        );

        let statTotal = 0;
        let statMerah = 0;
        let statKuning = 0;
        let statHijau = 0;
        let statAbu = 0;
        let statNormal = 0;

        const parseLampiranArray = (lampiranVal) => {
            if (!lampiranVal) return [];
            try {
                const parsed = JSON.parse(lampiranVal);
                if (Array.isArray(parsed)) return parsed;
                return [parsed];
            } catch (e) {
                return [lampiranVal];
            }
        };

        txsForStats.forEach(it => {
            statTotal++;
            const reqCount = it.category_min_attachment || 0;
            const parsedFiles = parseLampiranArray(it.lampiran);
            const filesCount = parsedFiles ? parsedFiles.length : 0;

            if (reqCount > 0) {
                if (filesCount === 0) {
                    statMerah++;
                } else if (filesCount < reqCount) {
                    statKuning++;
                } else {
                    statHijau++;
                }
            } else {
                if (filesCount > 0) {
                    statAbu++;
                } else {
                    statNormal++;
                }
            }
        });

        const systemSalesChannelsResult = await query(
            `SELECT 
                sc.name,
                COALESCE(SUM(
                    CASE 
                        WHEN pm.is_taxable = 1 THEN tsc.amount - ROUND((tsc.amount * 10) / 110)
                        ELSE tsc.amount
                    END
                ), 0) as amount,
                SUM(tsc.amount) as gross_amount
             FROM sales_channels sc
             JOIN transaction_sales_channels tsc ON sc.id = tsc.sales_channel_id
             JOIN transactions t ON tsc.transaction_id = t.id
             LEFT JOIN payment_methods pm ON COALESCE(
                 tsc.payment_method_id,
                 (SELECT tid.payment_method_id FROM transaction_income_details tid WHERE tid.transaction_id = t.id LIMIT 1)
             ) = pm.id
             WHERE t.branch_id = ?
               AND t.transaction_date BETWEEN ? AND ?
               AND t.status_deleted = false AND (t.is_draft = false OR t.is_draft IS NULL)
               AND t.is_umum = true
               AND t.type = 'income'
             GROUP BY sc.id, sc.name
             HAVING amount > 0
             ORDER BY amount DESC, sc.name ASC`,
            [branchId, startDate, endDate]
        );

        const sysNetMap = new Map(systemSalesChannelsResult.map(s => [s.name.toLowerCase().trim(), parseFloat(s.amount) || 0]));
        const sysGrossMap = new Map(systemSalesChannelsResult.map(s => [s.name.toLowerCase().trim(), parseFloat(s.gross_amount) || 0]));

        let exportSalesChannels = report.sales_channels;
        if (!exportSalesChannels || exportSalesChannels.length === 0) {
            if (systemSalesChannelsResult.length > 0) {
                exportSalesChannels = systemSalesChannelsResult.map(s => ({ name: s.name, amount: parseFloat(s.amount) || 0 }));
            }
        } else {
            exportSalesChannels = exportSalesChannels.map(sc => {
                const key = (sc.name || sc.channel_name || '').toLowerCase().trim();
                const savedAmt = Number(sc.amount) || 0;
                const sysGross = sysGrossMap.get(key);
                const sysNet = sysNetMap.get(key);
                // If saved amount was equal to gross amount from system, update it to net amount
                if (sysGross !== undefined && Math.abs(savedAmt - sysGross) < 1 && sysNet !== undefined) {
                    return { ...sc, amount: sysNet };
                }
                return sc;
            });
        }

        const dataForPdf = {
            ...report,
            sales_channels: exportSalesChannels,
            omzet_total: finalOmzetTotal,
            pengeluaran_total: systemPengeluaran,
            profit: finalProfit,
            pelunasan_piutang_bulan_lalu: pelunasanPiutangBulanLalu,
            prev_month_label: prevMonthName,
            income_breakdown: incomeBreakdown,
            expense_breakdown: processedExpenseBreakdown,
            attachment_stats: {
                total: statTotal,
                merah: statMerah,
                kuning: statKuning,
                hijau: statHijau,
                abu: statAbu,
                normal: statNormal
            }
        };

        const { exportFinancialReportToPDF, generateFilename, getMimeType } = require('../utils/exportHelper');
        const branchCodeOrName = (branch.code && branch.code.trim()) ? branch.code.trim() : branch.name;
        const filename = generateFilename('PDF', `Laporan_Keuangan_${branchCodeOrName}`);
        const selectedMonthDate = new Date(year, month - 1, 1);

        try {
            const userName = req.user.name || req.user.email;
            const filepath = await exportFinancialReportToPDF(
                dataForPdf, 
                filename, 
                branchCodeOrName, 
                selectedMonthDate, 
                report.working_days || workingDays, 
                { 
                    printedBy: userName,
                    branchCode: branch.code,
                    branchName: branch.name
                }
            );

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

const exportImage = async (req, res, next) => {
    try {
        const { branchId } = req.params;
        const month = parseInt(req.query.month) || new Date().getMonth() + 1;
        const year = parseInt(req.query.year) || new Date().getFullYear();
        const workingDays = parseInt(req.query.workingDays) || 25;

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
        const currentMonthDate = new Date(year, month - 1, 1);
        const currentMonthName = currentMonthDate.toLocaleDateString('id-ID', { month: 'long', year: 'numeric' });

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

        const systemOmzetGross = (parseFloat(incomeResult[0].total_gross) || 0) - pastIncomeRefunds;
        const systemTaxable = parseFloat(incomeResult[0].taxable_amount) || 0;
        const systemOmzet = systemOmzetGross - Math.round((systemTaxable * 10) / 110);

        const expenseBreakdown = await query(
            `SELECT category_name, SUM(total) as total
             FROM (
                /* 1. Pengeluaran Reguler & Retur dalam periode */
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

                /* 2. Rincian Simpanan (Diambil dari tabel detail simpanan) */
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

                /* 3. Refund yang terjadi di periode ini untuk transaksi pengeluaran sebelum startDate */
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
              endDate + ' 23:59:59',
              branchId,
              startDate + ' 00:00:00',
              endDate + ' 23:59:59',
              endDate + ' 23:59:59',
              branchId,
              startDate + ' 00:00:00',
              endDate + ' 23:59:59'
            ]
        );
        const totalPiutangMitra = parseFloat(mitraPiutangResult[0].total_piutang) || 0;
        const systemPengeluaran = folderPengeluaran + totalPiutangMitra;

        const debtRepaymentResult = await query(
            `SELECT SUM(tr.amount) as total FROM transaction_repayments tr JOIN transactions t ON tr.transaction_id = t.id WHERE tr.payment_date BETWEEN ? AND ? AND t.transaction_date < ? AND t.branch_id = ? AND t.status_deleted = false AND (t.is_draft = false OR t.is_draft IS NULL)`,
            [startDate, endDate, startDate, branchId]
        );
        const pelunasanPiutangBulanLalu = parseFloat(debtRepaymentResult[0].total) || 0;

        const incomeBreakdownRaw = await query(
            `SELECT 
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
                t.is_debt_payment,
                (SELECT COUNT(*) FROM transactions WHERE category_id = t.category_id AND type = 'expense' AND status_deleted = false) as has_expense
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
             GROUP BY category_name, t.is_debt_payment, t.category_id`,
            [endDate, branchId, startDate, endDate]
        );

        const groupedIncome = {
            'OMZET PENJUALAN': 0,
            'Pendapatan Lain-lain': 0
        };

        incomeBreakdownRaw.forEach(item => {
            const gross = parseFloat(item.total_gross) || 0;
            const taxable = parseFloat(item.taxable_amount) || 0;
            const tax = Math.round((taxable * 10) / 110);
            const net = gross - tax;

            const nameUpper = item.category_name.toUpperCase();
            const hasExpense = parseInt(item.has_expense) > 0;

            // Check if it's an Omzet variation
            const isOmzet = nameUpper.includes('OMZET') || nameUpper.includes('OMSET');

            if (isOmzet) {
                groupedIncome['OMZET PENJUALAN'] += net;
            } else {
                // Original strict logic for Other items:
                if ((!item.is_debt_payment || item.is_debt_payment == 0) && !hasExpense) {
                    groupedIncome['Pendapatan Lain-lain'] += net;
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
        const piutangLabel = `PIUTANG ${currentMonthName.toUpperCase()}`;
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

        // Calculate attachment stats for PDF
        const txsForStats = await query(
            `SELECT t.id, t.lampiran, c.min_attachment as category_min_attachment
             FROM transactions t
             LEFT JOIN categories c ON t.category_id = c.id
             WHERE t.branch_id = ?
               AND t.transaction_date BETWEEN ? AND ?
               AND t.status_deleted = false AND (t.is_draft = false OR t.is_draft IS NULL)
               AND t.is_umum = true
               AND NOT EXISTS (SELECT 1 FROM transaction_repayments tr WHERE tr.income_transaction_id = t.id)`,
            [branchId, startDate, endDate]
        );

        let statTotal = 0;
        let statMerah = 0;
        let statKuning = 0;
        let statHijau = 0;
        let statAbu = 0;
        let statNormal = 0;

        const parseLampiranArray = (lampiranVal) => {
            if (!lampiranVal) return [];
            try {
                const parsed = JSON.parse(lampiranVal);
                if (Array.isArray(parsed)) return parsed;
                return [parsed];
            } catch (e) {
                return [lampiranVal];
            }
        };

        txsForStats.forEach(it => {
            statTotal++;
            const reqCount = it.category_min_attachment || 0;
            const parsedFiles = parseLampiranArray(it.lampiran);
            const filesCount = parsedFiles ? parsedFiles.length : 0;

            if (reqCount > 0) {
                if (filesCount === 0) {
                    statMerah++;
                } else if (filesCount < reqCount) {
                    statKuning++;
                } else {
                    statHijau++;
                }
            } else {
                if (filesCount > 0) {
                    statAbu++;
                } else {
                    statNormal++;
                }
            }
        });

        const systemSalesChannelsResult = await query(
            `SELECT 
                sc.name,
                COALESCE(SUM(
                    CASE 
                        WHEN pm.is_taxable = 1 THEN tsc.amount - ROUND((tsc.amount * 10) / 110)
                        ELSE tsc.amount
                    END
                ), 0) as amount,
                SUM(tsc.amount) as gross_amount
             FROM sales_channels sc
             JOIN transaction_sales_channels tsc ON sc.id = tsc.sales_channel_id
             JOIN transactions t ON tsc.transaction_id = t.id
             LEFT JOIN payment_methods pm ON COALESCE(
                 tsc.payment_method_id,
                 (SELECT tid.payment_method_id FROM transaction_income_details tid WHERE tid.transaction_id = t.id LIMIT 1)
             ) = pm.id
             WHERE t.branch_id = ?
               AND t.transaction_date BETWEEN ? AND ?
               AND t.status_deleted = false AND (t.is_draft = false OR t.is_draft IS NULL)
               AND t.is_umum = true
               AND t.type = 'income'
             GROUP BY sc.id, sc.name
             HAVING amount > 0
             ORDER BY amount DESC, sc.name ASC`,
            [branchId, startDate, endDate]
        );

        const sysNetMap = new Map(systemSalesChannelsResult.map(s => [s.name.toLowerCase().trim(), parseFloat(s.amount) || 0]));
        const sysGrossMap = new Map(systemSalesChannelsResult.map(s => [s.name.toLowerCase().trim(), parseFloat(s.gross_amount) || 0]));

        let exportSalesChannels = report.sales_channels;
        if (!exportSalesChannels || exportSalesChannels.length === 0) {
            if (systemSalesChannelsResult.length > 0) {
                exportSalesChannels = systemSalesChannelsResult.map(s => ({ name: s.name, amount: parseFloat(s.amount) || 0 }));
            }
        } else {
            exportSalesChannels = exportSalesChannels.map(sc => {
                const key = (sc.name || sc.channel_name || '').toLowerCase().trim();
                const savedAmt = Number(sc.amount) || 0;
                const sysGross = sysGrossMap.get(key);
                const sysNet = sysNetMap.get(key);
                // If saved amount was equal to gross amount from system, update it to net amount
                if (sysGross !== undefined && Math.abs(savedAmt - sysGross) < 1 && sysNet !== undefined) {
                    return { ...sc, amount: sysNet };
                }
                return sc;
            });
        }

        const dataForPdf = {
            ...report,
            sales_channels: exportSalesChannels,
            omzet_total: finalOmzetTotal,
            pengeluaran_total: systemPengeluaran,
            profit: finalProfit,
            pelunasan_piutang_bulan_lalu: pelunasanPiutangBulanLalu,
            prev_month_label: prevMonthName,
            income_breakdown: incomeBreakdown,
            expense_breakdown: processedExpenseBreakdown,
            attachment_stats: {
                total: statTotal,
                merah: statMerah,
                kuning: statKuning,
                hijau: statHijau,
                abu: statAbu,
                normal: statNormal
            }
        };

        const { exportFinancialReportToPDF, exportPDFToJPEG, generateFilename } = require('../utils/exportHelper');
        const branchCodeOrName = (branch.code && branch.code.trim()) ? branch.code.trim() : branch.name;
        const filename = generateFilename('PDF', `Laporan_Keuangan_${branchCodeOrName}`);
        const selectedMonthDate = new Date(year, month - 1, 1);

        try {
            const userName = req.user.name || req.user.email;
            const filepath = await exportFinancialReportToPDF(
                dataForPdf, 
                filename, 
                branchCodeOrName, 
                selectedMonthDate, 
                report.working_days || workingDays, 
                { 
                    printedBy: userName,
                    branchCode: branch.code,
                    branchName: branch.name
                }
            );

            const fs = require('fs');
            if (!fs.existsSync(filepath)) {
                return res.status(500).json({ success: false, message: 'File PDF gagal dibuat' });
            }

            // Convert PDF to JPEG
            const jpegBuffer = await exportPDFToJPEG(filepath);

            // Clean up PDF immediately
            fs.unlink(filepath, (err) => {
                if (err) console.error(`[EXPORT] Error deleting temp PDF:`, err);
            });

            const jpegFilename = filename.replace(/\.pdf$/i, '.jpg');
            res.setHeader('Content-Type', 'image/jpeg');
            res.setHeader('Content-Disposition', `attachment; filename="${jpegFilename}"`);
            res.end(jpegBuffer);

        } catch (pdfError) {
            console.error(`[EXPORT IMAGE] Image Gen Error:`, pdfError);
            return res.status(500).json({ success: false, message: 'Gagal memproses gambar: ' + pdfError.message });
        }
    } catch (error) {
        console.error(`[EXPORT IMAGE] Global Controller Error:`, error);
        next(error);
    }
};

const exportBagiHasilPdf = async (req, res, next) => {
    try {
        const { branchId } = req.params;
        const month = parseInt(req.query.month) || new Date().getMonth() + 1;
        const year = parseInt(req.query.year) || new Date().getFullYear();

        const branch = await Branch.findById(branchId);
        if (!branch) return res.status(404).json({ success: false, message: 'Branch not found' });

        const hasAccess = await Branch.userHasAccess(req.userId, parseInt(branchId), req.user.role);
        if (!hasAccess) {
            return res.status(403).json({ success: false, message: 'Akses ditolak' });
        }

        const report = await BranchReport.findByBranchAndPeriod(branchId, month, year);
        if (!report) return res.status(404).json({ success: false, message: 'Laporan tidak ditemukan' });

        const { exportBagiHasilToPDF, generateFilename, getMimeType } = require('../utils/exportHelper');
        const branchCodeOrName = (branch.code && branch.code.trim()) ? branch.code.trim() : branch.name;
        const filename = generateFilename('PDF', `Bagi_Hasil_${branchCodeOrName}`);
        const selectedMonthDate = new Date(year, month - 1, 1);

        try {
            const filepath = await exportBagiHasilToPDF(report, filename, branchCodeOrName, selectedMonthDate);

            const fs = require('fs');
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
        } catch (pdfError) {
            console.error(`[EXPORT BH] PDF Gen Error:`, pdfError);
            return res.status(500).json({ success: false, message: 'Gagal memproses PDF: ' + pdfError.message });
        }
    } catch (error) {
        next(error);
    }
};

const exportSavingsPdf = async (req, res, next) => {
    try {
        const { branchId } = req.params;
        const source = req.method === 'POST' ? req.body : req.query;
        const month = parseInt(source.month) || new Date().getMonth() + 1;
        const year = parseInt(source.year) || new Date().getFullYear();
        const workingDays = parseInt(source.workingDays) || 30;
        let categoryIds = source.categoryIds;

        if (typeof categoryIds === 'string') {
            try {
                categoryIds = JSON.parse(categoryIds);
            } catch (e) {
                categoryIds = categoryIds.split(',').map(id => parseInt(id.trim())).filter(Boolean);
            }
        }

        const branch = await Branch.findById(branchId);
        if (!branch) return res.status(404).json({ success: false, message: 'Branch not found' });

        const hasAccess = await Branch.userHasAccess(req.userId, parseInt(branchId), req.user.role);
        if (!hasAccess) {
            return res.status(403).json({ success: false, message: 'Akses ditolak' });
        }

        // Get categories to export
        let targetCategories = [];
        if (Array.isArray(categoryIds) && categoryIds.length > 0) {
            for (const catId of categoryIds) {
                const cat = await Category.findById(catId);
                if (cat) targetCategories.push(cat);
            }
        } else {
            // Default to all subcategories (parent_id IS NOT NULL) in this branch
            const allCats = await Category.findAll({ branchId: parseInt(branchId) });
            targetCategories = allCats.filter(c => c.parent_id !== null && c.parent_id !== undefined);
        }

        if (targetCategories.length === 0) {
            return res.status(400).json({ success: false, message: 'Tidak ada kategori simpanan yang dipilih' });
        }

        const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
        const daysInMonth = new Date(year, month, 0).getDate();
        const endDate = `${year}-${String(month).padStart(2, '0')}-${String(daysInMonth).padStart(2, '0')}`;
        const selectedMonthDate = new Date(year, month - 1, 1);

        const categoriesData = [];

        for (const cat of targetCategories) {
            // Get all history for this category in this branch
            const allHistory = await Transaction.findAll({
                branchId: parseInt(branchId),
                category: cat.name,
                limit: 50000
            });

            // Base filtered: only savings pure or allocation from kas utama (umum expense)
            const baseFiltered = allHistory.filter(t => !t.is_umum || (t.is_umum && t.type === 'expense'));

            // 1. Saldo Awal (transactions before startDate)
            const beforeStartTxs = baseFiltered.filter(t => t.transaction_date < startDate);
            const totalAllocBefore = beforeStartTxs
                .filter(t => t.is_umum && t.type === 'expense')
                .reduce((sum, t) => sum + Math.abs(Number(t.amount)), 0);
            const totalIncomeBefore = beforeStartTxs
                .filter(t => t.type === 'income')
                .reduce((sum, t) => sum + Math.abs(Number(t.amount)), 0);
            const totalSpendBefore = beforeStartTxs
                .filter(t => !t.is_umum && t.type === 'expense')
                .reduce((sum, t) => sum + Math.abs(Number(t.amount)), 0);
            const saldoAwal = totalAllocBefore + totalIncomeBefore - totalSpendBefore;

            // 2. Transaksi Bulan Berjalan (between startDate and endDate)
            const monthTxs = baseFiltered.filter(t => t.transaction_date >= startDate && t.transaction_date <= endDate);

            // Penambahan Bulan Berjalan (Alokasi Masuk / Income)
            const penambahan = monthTxs
                .filter(t => t.type === 'income' || (t.is_umum && t.type === 'expense'))
                .reduce((sum, t) => sum + Math.abs(Number(t.amount)), 0);

            // Pengeluaran Bulan Berjalan (Expenses)
            const expenseTxs = monthTxs
                .filter(t => !t.is_umum && t.type === 'expense')
                .sort((a, b) => {
                    const dateA = new Date(a.transaction_date).getTime();
                    const dateB = new Date(b.transaction_date).getTime();
                    if (dateA !== dateB) return dateA - dateB;
                    return a.id - b.id;
                });

            const expensesList = expenseTxs.map(t => {
                const dateObj = new Date(t.transaction_date);
                const day = String(dateObj.getDate()).padStart(2, '0');
                const cleanNote = (t.note || cat.name).replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim();
                return {
                    day,
                    note: cleanNote,
                    amount: Math.abs(Number(t.amount))
                };
            });

            const totalPengeluaran = expensesList.reduce((sum, e) => sum + e.amount, 0);
            const saldoAkhir = saldoAwal + penambahan - totalPengeluaran;

            categoriesData.push({
                id: cat.id,
                name: cat.name,
                saldoAwal,
                penambahan,
                expenses: expensesList,
                totalPengeluaran,
                saldoAkhir
            });
        }

        const { exportSavingsReportToPDF, generateFilename, getMimeType } = require('../utils/exportHelper');
        const branchCodeOrName = (branch.code && branch.code.trim()) ? branch.code.trim() : branch.name;
        const filename = generateFilename('PDF', `Laporan_Simpanan_${branchCodeOrName}`);

        try {
            const filepath = await exportSavingsReportToPDF(
                { categories: categoriesData },
                filename,
                branchCodeOrName,
                selectedMonthDate,
                workingDays
            );

            const fs = require('fs');
            res.setHeader('Content-Type', getMimeType('PDF') || 'application/pdf');
            res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

            const fileStream = fs.createReadStream(filepath);
            fileStream.pipe(res);

            fileStream.on('end', () => {
                setTimeout(() => {
                    fs.unlink(filepath, (err) => {
                        if (err) console.error(`[EXPORT SAVINGS] Error deleting temp file:`, err);
                    });
                }, 10000);
            });
        } catch (pdfError) {
            console.error(`[EXPORT SAVINGS] PDF Gen Error:`, pdfError);
            return res.status(500).json({ success: false, message: 'Gagal memproses PDF: ' + pdfError.message });
        }
    } catch (error) {
        next(error);
    }
};

const getBagiHasilTemplates = async (req, res, next) => {
    try {
        const { branchId } = req.params;
        const hasAccess = await Branch.userHasAccess(req.userId, parseInt(branchId), req.user.role);
        if (!hasAccess) {
            return res.status(403).json({ success: false, message: 'Akses ditolak' });
        }

        const templates = await BagiHasilTemplate.findByBranchId(parseInt(branchId));
        return res.json({ success: true, data: templates });
    } catch (error) {
        next(error);
    }
};

const createBagiHasilTemplate = async (req, res, next) => {
    try {
        const { branchId } = req.params;
        const { name, templateData, isDefault } = req.body;

        const hasAccess = await Branch.userHasAccess(req.userId, parseInt(branchId), req.user.role);
        if (!hasAccess) {
            return res.status(403).json({ success: false, message: 'Akses ditolak' });
        }

        if (!name || !name.trim()) {
            return res.status(400).json({ success: false, message: 'Nama template wajib diisi' });
        }

        if (!templateData || !Array.isArray(templateData) || templateData.length === 0) {
            return res.status(400).json({ success: false, message: 'Data template tidak boleh kosong' });
        }

        const template = await BagiHasilTemplate.create({
            branchId: parseInt(branchId),
            name: name.trim(),
            templateData,
            isDefault: Boolean(isDefault)
        });

        return res.status(201).json({
            success: true,
            message: 'Template bagi hasil berhasil disimpan',
            data: template
        });
    } catch (error) {
        next(error);
    }
};

const updateBagiHasilTemplate = async (req, res, next) => {
    try {
        const { branchId, templateId } = req.params;
        const { name, templateData, isDefault } = req.body;

        const hasAccess = await Branch.userHasAccess(req.userId, parseInt(branchId), req.user.role);
        if (!hasAccess) {
            return res.status(403).json({ success: false, message: 'Akses ditolak' });
        }

        const template = await BagiHasilTemplate.findById(parseInt(templateId));
        if (!template || template.branch_id !== parseInt(branchId)) {
            return res.status(404).json({ success: false, message: 'Template tidak ditemukan' });
        }

        const updated = await BagiHasilTemplate.update(parseInt(templateId), {
            name: name ? name.trim() : undefined,
            templateData,
            isDefault: isDefault !== undefined ? Boolean(isDefault) : undefined
        });

        return res.json({
            success: true,
            message: 'Template berhasil diperbarui',
            data: updated
        });
    } catch (error) {
        next(error);
    }
};

const deleteBagiHasilTemplate = async (req, res, next) => {
    try {
        const { branchId, templateId } = req.params;

        const hasAccess = await Branch.userHasAccess(req.userId, parseInt(branchId), req.user.role);
        if (!hasAccess) {
            return res.status(403).json({ success: false, message: 'Akses ditolak' });
        }

        const template = await BagiHasilTemplate.findById(parseInt(templateId));
        if (!template || template.branch_id !== parseInt(branchId)) {
            return res.status(404).json({ success: false, message: 'Template tidak ditemukan' });
        }

        await BagiHasilTemplate.delete(parseInt(templateId));

        return res.json({
            success: true,
            message: 'Template berhasil dihapus'
        });
    } catch (error) {
        next(error);
    }
};

const getExpenseOrderTemplates = async (req, res, next) => {
    try {
        const { branchId } = req.params;
        const hasAccess = await Branch.userHasAccess(req.userId, parseInt(branchId), req.user.role);
        if (!hasAccess) {
            return res.status(403).json({ success: false, message: 'Akses ditolak' });
        }

        const templates = await ExpenseOrderTemplate.findByBranchId(parseInt(branchId));
        return res.json({ success: true, data: templates });
    } catch (error) {
        next(error);
    }
};

const createExpenseOrderTemplate = async (req, res, next) => {
    try {
        const { branchId } = req.params;
        const { name, templateData, isDefault } = req.body;

        const hasAccess = await Branch.userHasAccess(req.userId, parseInt(branchId), req.user.role);
        if (!hasAccess) {
            return res.status(403).json({ success: false, message: 'Akses ditolak' });
        }

        if (!name || !name.trim()) {
            return res.status(400).json({ success: false, message: 'Nama template wajib diisi' });
        }

        if (!templateData || !Array.isArray(templateData) || templateData.length === 0) {
            return res.status(400).json({ success: false, message: 'Data template tidak boleh kosong' });
        }

        const template = await ExpenseOrderTemplate.create({
            branchId: parseInt(branchId),
            name: name.trim(),
            templateData,
            isDefault: Boolean(isDefault)
        });

        return res.status(201).json({
            success: true,
            message: 'Template urutan pengeluaran berhasil disimpan',
            data: template
        });
    } catch (error) {
        next(error);
    }
};

const updateExpenseOrderTemplate = async (req, res, next) => {
    try {
        const { branchId, templateId } = req.params;
        const { name, templateData, isDefault } = req.body;

        const hasAccess = await Branch.userHasAccess(req.userId, parseInt(branchId), req.user.role);
        if (!hasAccess) {
            return res.status(403).json({ success: false, message: 'Akses ditolak' });
        }

        const template = await ExpenseOrderTemplate.findById(parseInt(templateId));
        if (!template || template.branch_id !== parseInt(branchId)) {
            return res.status(404).json({ success: false, message: 'Template tidak ditemukan' });
        }

        const updated = await ExpenseOrderTemplate.update(parseInt(templateId), {
            name: name ? name.trim() : undefined,
            templateData,
            isDefault: isDefault !== undefined ? Boolean(isDefault) : undefined
        });

        return res.json({
            success: true,
            message: 'Template berhasil diperbarui',
            data: updated
        });
    } catch (error) {
        next(error);
    }
};

const deleteExpenseOrderTemplate = async (req, res, next) => {
    try {
        const { branchId, templateId } = req.params;

        const hasAccess = await Branch.userHasAccess(req.userId, parseInt(branchId), req.user.role);
        if (!hasAccess) {
            return res.status(403).json({ success: false, message: 'Akses ditolak' });
        }

        const template = await ExpenseOrderTemplate.findById(parseInt(templateId));
        if (!template || template.branch_id !== parseInt(branchId)) {
            return res.status(404).json({ success: false, message: 'Template tidak ditemukan' });
        }

        await ExpenseOrderTemplate.delete(parseInt(templateId));

        return res.json({
            success: true,
            message: 'Template berhasil dihapus'
        });
    } catch (error) {
        next(error);
    }
};

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
        const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
        const daysInMonth = new Date(year, month, 0).getDate();
        const endDate = `${year}-${String(month).padStart(2, '0')}-${String(daysInMonth).padStart(2, '0')}`;

        const prevMonthDate = new Date(year, month - 2, 1);
        const prevMonthName = prevMonthDate.toLocaleDateString('id-ID', { month: 'long', year: 'numeric' });

        let totalSystemOmzet = 0;
        let totalSystemPengeluaran = 0;
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
                aggregatedExpensesMap['Mitra Piutang'] = (aggregatedExpensesMap['Mitra Piutang'] || 0) + totalPiutangMitra;
            }

            // Aggregated income map
            for (const inc of incomeBreakdownResult) {
                const cat = inc.category_name;
                const g = parseFloat(inc.total_gross) || 0;
                const tax = Math.round(((parseFloat(inc.taxable_amount) || 0) * 10) / 110);
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

        const report = {
            id: 0,
            branch_id: 0,
            group_name: group_name || 'Gabungan',
            is_group: true,
            month,
            year,
            omzet_total: totalSystemOmzet,
            pengeluaran_total: totalSystemPengeluaran,
            profit: finalProfit,
            pelunasan_piutang_bulan_lalu: totalPelunasanPiutang,
            prev_month_label: prevMonthName,
            income_breakdown: incomeBreakdown,
            expense_breakdown: expenseBreakdown,
            sales_channels: systemSalesChannels.map(s => ({ name: s.name, amount: s.amount })),
            system_sales_channels: systemSalesChannels,
            master_sales_channels: masterSalesChannels,
            unallocated_omzet: totalUnallocatedOmzet,
            working_days: 25,
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

        const { exportFinancialReportToPDF, generateFilename, getMimeType } = require('../utils/exportHelper');
        const groupLabel = group_name ? `Grup_${group_name.replace(/\s+/g, '_')}` : 'Grup_Gabungan';
        const filename = generateFilename('PDF', `Laporan_Keuangan_${groupLabel}`);
        const selectedMonthDate = new Date(year, month - 1, 1);

        const dataForPdf = {
            ...reportData,
            working_days: workingDays
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

        const { exportFinancialReportToPDF, exportPDFToJPEG, generateFilename } = require('../utils/exportHelper');
        const groupLabel = group_name ? `Grup_${group_name.replace(/\s+/g, '_')}` : 'Grup_Gabungan';
        const filename = generateFilename('JPEG', `Laporan_Keuangan_${groupLabel}`);
        const pdfFilename = generateFilename('PDF', `Laporan_Keuangan_${groupLabel}`);
        const selectedMonthDate = new Date(year, month - 1, 1);

        const dataForPdf = {
            ...reportData,
            working_days: workingDays
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
        const fs = require('fs');
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

module.exports = {
    getReport,
    getConsolidatedReport,
    getGroupFinancialReport,
    exportGroupPdf,
    exportGroupImage,
    updateReport,
    exportPdf,
    exportBagiHasilPdf,
    exportSavingsPdf,
    exportImage,
    getBagiHasilTemplates,
    createBagiHasilTemplate,
    updateBagiHasilTemplate,
    deleteBagiHasilTemplate,
    getExpenseOrderTemplates,
    createExpenseOrderTemplate,
    updateExpenseOrderTemplate,
    deleteExpenseOrderTemplate
};


