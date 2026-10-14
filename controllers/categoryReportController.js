const Transaction = require('../models/Transaction');
const Branch = require('../models/Branch');
const BranchReport = require('../models/BranchReport');
const { query } = require('../config/database');
const {
    exportCategoryToPDF,
    exportCategoryToExcel,
    exportToCSV,
    generateFilename,
    getMimeType
} = require('../utils/exportHelper');
const fs = require('fs');

// Export category specific report
const exportCategoryReport = async (req, res, next) => {
    try {
        // Support both GET (query params) and POST (body)
        const source = req.method === 'GET' ? req.query : req.body;

        const {
            title,
            from_date,
            to_date,
            category,
            type,
            working_days,
            format = 'PDF'
        } = source;

        const userId = req.userId;
        const branchId = req.branchId || req.headers['x-branch-id'];

        if (!branchId) {
            return res.status(400).json({
                success: false,
                message: 'Branch ID is required. Please provide X-Branch-Id header.'
            });
        }

        // Verify branch access
        const hasAccess = await Branch.userHasAccess(userId, parseInt(branchId), req.user.role);
        if (!hasAccess) {
            return res.status(403).json({
                success: false,
                message: 'No access to this branch'
            });
        }

        // Build query
        const queryParams = {
            branchId: parseInt(branchId),
            startDate: from_date,
            endDate: to_date,
            sort: 'terlama', // Oldest first (01 -> 31) to match standard daily statement
            page: 1,
            limit: 10000
        };

        if (category && category !== 'Semua Kategori' && category !== 'all') {
            queryParams.category = category;
        }

        // Apply type filter if specified (income / expense)
        if (type && (type === 'income' || type === 'expense')) {
            queryParams.type = type;
        }

        // Get transactions for this specific category / filter
        let transactions = await Transaction.findAll(queryParams);

        // Filter out transactions with zero or invalid nominal
        transactions = transactions.filter(t => {
            const val = Math.abs(parseFloat(t.net_amount !== undefined ? t.net_amount : t.amount || 0));
            return val > 0.001;
        });

        if (transactions.length === 0) {
            return res.status(400).json({
                success: false,
                message: 'Tidak ada transaksi dengan nominal valid yang ditemukan untuk periode dan filter yang dipilih'
            });
        }

        // Generate filename
        const cleanCatName = (category && category !== 'Semua Kategori') ? category.replace(/\s+/g, '_') : 'Transaksi';
        const filename = generateFilename(format, title || `Laporan_${cleanCatName}`);

        // Get branch info
        const branch = await Branch.findById(parseInt(branchId));
        const branchName = branch ? branch.name : 'Branch';

        // Resolve category code & hierarchy if a specific category is requested
        let categoryCode = null;
        let resolvedCategoryTitle = null;
        let activeSalesChannels = [];

        if (category && category !== 'Semua Kategori' && category !== 'all') {
            const catRows = await query(
                `SELECT c.id, c.name, c.code, p.name AS parent_name, p.code AS parent_code
                 FROM categories c 
                 LEFT JOIN categories p ON c.parent_id = p.id
                 WHERE c.name = ? 
                   AND (c.branch_id = ? OR c.branch_id IS NULL) 
                   AND c.status_deleted = false 
                 ORDER BY (c.branch_id = ?) DESC, c.id DESC 
                 LIMIT 1`,
                [category, parseInt(branchId), parseInt(branchId)]
            );
            if (catRows.length > 0) {
                const cat = catRows[0];
                categoryCode = cat.code ? cat.code.trim() : null;
                if (cat.parent_name) {
                    const parentPrefix = cat.parent_code ? `${cat.parent_code.trim()}. ` : '';
                    resolvedCategoryTitle = `${parentPrefix}${cat.parent_name.trim().toUpperCase()} - ${cat.name.trim().toUpperCase()}`;
                } else if (categoryCode) {
                    resolvedCategoryTitle = `${categoryCode}. ${cat.name.trim().toUpperCase()}`;
                } else {
                    resolvedCategoryTitle = cat.name.trim().toUpperCase();
                }

                // Query active sales channels for this category
                activeSalesChannels = await query(
                    `SELECT id, name, description, category_id 
                     FROM sales_channels 
                     WHERE branch_id = ? 
                       AND status_deleted = 0 
                       AND is_active = 1 
                       AND category_id = ?
                     ORDER BY id ASC`,
                    [parseInt(branchId), cat.id]
                );

                // Fallback for Omzet category if channels have NULL category_id
                if (activeSalesChannels.length === 0 && /omzet|omset/i.test(cat.name || category)) {
                    activeSalesChannels = await query(
                        `SELECT id, name, description, category_id 
                         FROM sales_channels 
                         WHERE branch_id = ? 
                           AND status_deleted = 0 
                           AND is_active = 1 
                           AND (category_id = ? OR category_id IS NULL)
                         ORDER BY id ASC`,
                        [parseInt(branchId), cat.id]
                    );
                }
            }
        }

        // Sort sales channels naturally (by leading number if present, e.g. 1., 2., 3., 4.)
        if (activeSalesChannels.length > 0) {
            activeSalesChannels.sort((a, b) => {
                const matchA = (a.name || '').match(/^(\d+)/);
                const matchB = (b.name || '').match(/^(\d+)/);
                if (matchA && matchB) {
                    return parseInt(matchA[1], 10) - parseInt(matchB[1], 10);
                }
                return (a.id || 0) - (b.id || 0);
            });

            // Fetch transaction_sales_channels for all transactions in this report with PB1 deduction
            const transactionIds = transactions.map(t => t.id).filter(Boolean);
            if (transactionIds.length > 0) {
                const placeholders = transactionIds.map(() => '?').join(', ');
                const tscRows = await query(
                    `SELECT 
                        tsc.transaction_id, 
                        tsc.sales_channel_id, 
                        tsc.amount AS gross_amount,
                        CASE 
                            WHEN pm.is_taxable = 1 THEN tsc.amount - ROUND((tsc.amount * 10) / 110)
                            ELSE tsc.amount
                        END AS amount,
                        CASE 
                            WHEN pm.is_taxable = 1 THEN ROUND((tsc.amount * 10) / 110)
                            ELSE 0
                        END AS pb1_amount,
                        COALESCE(pm.is_taxable, 0) AS is_taxable,
                        sc.name AS sales_channel_name
                     FROM transaction_sales_channels tsc
                     JOIN sales_channels sc ON tsc.sales_channel_id = sc.id
                     JOIN transactions t ON tsc.transaction_id = t.id
                     LEFT JOIN transaction_income_details tid_direct ON tsc.transaction_income_detail_id = tid_direct.id
                     LEFT JOIN payment_methods pm ON COALESCE(
                         tsc.payment_method_id,
                         tid_direct.payment_method_id,
                         (SELECT tid.payment_method_id FROM transaction_income_details tid WHERE tid.transaction_id = t.id LIMIT 1)
                     ) = pm.id
                     WHERE tsc.transaction_id IN (${placeholders})`,
                    transactionIds
                );

                const tscMap = new Map();
                for (const row of tscRows) {
                    if (!tscMap.has(row.transaction_id)) {
                        tscMap.set(row.transaction_id, []);
                    }
                    tscMap.get(row.transaction_id).push(row);
                }

                transactions.forEach(t => {
                    t.sales_channel_details = tscMap.get(t.id) || [];
                    if (t.sales_channel_details.length > 0) {
                        const scNetTotal = t.sales_channel_details.reduce((sum, scd) => sum + parseFloat(scd.amount || 0), 0);
                        t.net_amount = scNetTotal;
                        t.amount = scNetTotal;
                    } else {
                        const futureRef = parseFloat(t.future_refund || 0);
                        const effectiveAmount = parseFloat(t.amount || 0) + futureRef;
                        const pb1Val = parseFloat(t.pb1 || 0);
                        if (t.type === 'income' && pb1Val > 0) {
                            t.gross_amount = effectiveAmount;
                            t.net_amount = Math.max(0, Math.abs(t.gross_amount) - pb1Val);
                            t.amount = t.net_amount;
                        } else {
                            t.gross_amount = effectiveAmount;
                            t.net_amount = Math.abs(t.gross_amount);
                            t.amount = t.net_amount;
                        }
                    }
                });
            }
        } else {
            transactions.forEach(t => {
                const futureRef = parseFloat(t.future_refund || 0);
                const effectiveAmount = parseFloat(t.amount || 0) + futureRef;
                const pb1Val = parseFloat(t.pb1 || 0);
                if (t.type === 'income' && pb1Val > 0) {
                    t.gross_amount = effectiveAmount;
                    t.net_amount = Math.max(0, Math.abs(t.gross_amount) - pb1Val);
                    t.amount = t.net_amount;
                } else {
                    t.gross_amount = effectiveAmount;
                    t.net_amount = Math.abs(t.gross_amount);
                    t.amount = t.net_amount;
                }
            });
        }

        // Resolve working days
        let resolvedWorkingDays = working_days ? parseInt(working_days) : null;
        if (!resolvedWorkingDays) {
            const selectedDate = from_date ? new Date(from_date) : new Date();
            const reportInDb = await BranchReport.findByBranchAndPeriod(
                parseInt(branchId),
                selectedDate.getMonth() + 1,
                selectedDate.getFullYear()
            );
            resolvedWorkingDays = reportInDb?.working_days || 25;
        }

        const exportOptions = {
            fromDate: from_date,
            toDate: to_date,
            title: title || `Laporan ${category || 'Transaksi'}`,
            categoryName: (category && category !== 'Semua Kategori') ? category : 'SEMUA KATEGORI',
            categoryCode: categoryCode,
            categoryTitle: resolvedCategoryTitle,
            type: type || 'all',
            workingDays: resolvedWorkingDays,
            branchCode: branch ? branch.code : null,
            branchName: branchName,
            salesChannels: activeSalesChannels,
            hasSalesChannels: activeSalesChannels.length > 0
        };

        let filepath;
        const fmtUpper = format.toUpperCase();

        if (fmtUpper === 'PDF') {
            filepath = await exportCategoryToPDF(transactions, filename, branchName, exportOptions);
        } else if (fmtUpper === 'XLS' || fmtUpper === 'XLSX') {
            filepath = await exportCategoryToExcel(transactions, filename, branchName, exportOptions);
        } else if (fmtUpper === 'CSV') {
            filepath = await exportToCSV(transactions, filename);
        } else {
            return res.status(400).json({
                success: false,
                message: `Format ${format} tidak didukung untuk laporan kategori.`
            });
        }

        // Send file
        res.setHeader('Content-Type', getMimeType(format));
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

        const fileStream = fs.createReadStream(filepath);
        fileStream.pipe(res);

        fileStream.on('end', () => {
            setTimeout(() => {
                fs.unlink(filepath, (err) => {
                    if (err) console.error('Error deleting export file:', err);
                });
            }, 5000);
        });

    } catch (error) {
        next(error);
    }
};

module.exports = {
    exportCategoryReport
};
