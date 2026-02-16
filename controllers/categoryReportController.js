const Transaction = require('../models/Transaction');
const {
    exportCategoryToPDF,
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

        if (!category) {
            return res.status(400).json({
                success: false,
                message: 'Category is required for category report.'
            });
        }

        // Verify branch access
        const Branch = require('../models/Branch');
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
            category: category,
            sort: 'terbaru',
            page: 1,
            limit: 10000
        };

        // Get transactions for this specific category
        const transactions = await Transaction.findAll(queryParams);

        if (transactions.length === 0) {
            return res.status(400).json({
                success: false,
                message: 'No transactions found for the selected period and category'
            });
        }

        // Generate filename
        const filename = generateFilename(format, title || `Laporan_${category.replace(/\s+/g, '_')}`);

        let filepath;

        // Only PDF is requested for this specific feature as per user context
        // But we can support others if needed. For now, focus on PDF.
        if (format.toUpperCase() === 'PDF') {
            // Get branch info
            const branch = await Branch.findById(parseInt(branchId));
            const branchName = branch ? branch.name : 'Branch';

            const selectedDate = from_date ? new Date(from_date) : new Date();

            filepath = await exportCategoryToPDF(transactions, filename, branchName, {
                fromDate: from_date,
                toDate: to_date,
                title: title || `Laporan ${category}`,
                categoryName: category
            });
        } else {
            return res.status(400).json({
                success: false,
                message: 'Only PDF format is currently supported for category reports.'
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
