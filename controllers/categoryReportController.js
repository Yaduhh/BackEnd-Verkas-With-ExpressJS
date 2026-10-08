const Transaction = require('../models/Transaction');
const Branch = require('../models/Branch');
const BranchReport = require('../models/BranchReport');
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
            type: type || 'all',
            workingDays: resolvedWorkingDays
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
