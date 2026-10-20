const fs = require('fs');
const Branch = require('../../models/Branch');
const BranchReport = require('../../models/BranchReport');
const Category = require('../../models/Category');
const Transaction = require('../../models/Transaction');
const { getSingleBranchReportExportData } = require('./branchReportCoreController');
const {
    exportFinancialReportToPDF,
    exportFinancialReportToExcel,
    exportPDFToJPEG,
    exportBagiHasilToPDF,
    exportSavingsReportToPDF,
    generateFilename,
    getMimeType
} = require('../../utils/exportHelper');

/**
 * GET /api/branch-reports/:branchId/export-pdf?month=2&year=2026
 */
const exportPdf = async (req, res, next) => {
    try {
        const { branchId } = req.params;
        const month = parseInt(req.query.month) || new Date().getMonth() + 1;
        const year = parseInt(req.query.year) || new Date().getFullYear();
        const workingDays = parseInt(req.query.workingDays) || 25;

        const {
            branch,
            workingDays: actualWorkingDays,
            dataForPdf,
            branchCodeOrName,
            selectedMonthDate
        } = await getSingleBranchReportExportData(branchId, month, year, workingDays, req);

        const filename = generateFilename('PDF', `Laporan_Keuangan_${branchCodeOrName}`);

        try {
            const userName = req.user.name || req.user.email;
            const filepath = await exportFinancialReportToPDF(
                dataForPdf, 
                filename, 
                branchCodeOrName, 
                selectedMonthDate, 
                actualWorkingDays, 
                { 
                    printedBy: userName,
                    branchCode: branch.code,
                    branchName: branch.name
                }
            );

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
        } catch (pdfError) {
            console.error(`[EXPORT] PDF Gen Error:`, pdfError);
            return res.status(500).json({ success: false, message: 'Gagal memproses PDF: ' + pdfError.message });
        }
    } catch (error) {
        if (error.statusCode) {
            return res.status(error.statusCode).json({ success: false, message: error.message });
        }
        console.error(`[EXPORT] Global Controller Error:`, error);
        next(error);
    }
};

/**
 * GET /api/branch-reports/:branchId/export-excel?month=2&year=2026
 */
const exportExcel = async (req, res, next) => {
    try {
        const { branchId } = req.params;
        const month = parseInt(req.query.month) || new Date().getMonth() + 1;
        const year = parseInt(req.query.year) || new Date().getFullYear();
        const workingDays = parseInt(req.query.workingDays) || 25;

        const {
            branch,
            workingDays: actualWorkingDays,
            dataForPdf,
            branchCodeOrName,
            selectedMonthDate
        } = await getSingleBranchReportExportData(branchId, month, year, workingDays, req);

        const filename = generateFilename('EXCEL', `Laporan_Keuangan_${branchCodeOrName}`);

        try {
            const userName = req.user.name || req.user.email;
            const filepath = await exportFinancialReportToExcel(
                dataForPdf, 
                filename, 
                branchCodeOrName, 
                selectedMonthDate, 
                actualWorkingDays, 
                { 
                    printedBy: userName,
                    branchCode: branch.code,
                    branchName: branch.name
                }
            );

            if (!fs.existsSync(filepath)) {
                return res.status(500).json({ success: false, message: 'File Excel gagal dibuat' });
            }

            res.setHeader('Content-Type', getMimeType('EXCEL') || 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
            res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

            const fileStream = fs.createReadStream(filepath);
            fileStream.pipe(res);

            fileStream.on('end', () => {
                setTimeout(() => {
                    fs.unlink(filepath, (err) => {
                        if (err) console.error(`[EXPORT] Error deleting temp Excel file:`, err);
                    });
                }, 10000);
            });
        } catch (excelError) {
            console.error(`[EXPORT] Excel Gen Error:`, excelError);
            return res.status(500).json({ success: false, message: 'Gagal memproses Excel: ' + excelError.message });
        }
    } catch (error) {
        if (error.statusCode) {
            return res.status(error.statusCode).json({ success: false, message: error.message });
        }
        console.error(`[EXPORT] Global Controller Error:`, error);
        next(error);
    }
};

/**
 * GET /api/branch-reports/:branchId/export-image?month=2&year=2026
 */
const exportImage = async (req, res, next) => {
    try {
        const { branchId } = req.params;
        const month = parseInt(req.query.month) || new Date().getMonth() + 1;
        const year = parseInt(req.query.year) || new Date().getFullYear();
        const workingDays = parseInt(req.query.workingDays) || 25;

        const {
            branch,
            workingDays: actualWorkingDays,
            dataForPdf,
            branchCodeOrName,
            selectedMonthDate
        } = await getSingleBranchReportExportData(branchId, month, year, workingDays, req);

        const filename = generateFilename('PDF', `Laporan_Keuangan_${branchCodeOrName}`);

        try {
            const userName = req.user.name || req.user.email;
            const filepath = await exportFinancialReportToPDF(
                dataForPdf, 
                filename, 
                branchCodeOrName, 
                selectedMonthDate, 
                actualWorkingDays, 
                { 
                    printedBy: userName,
                    branchCode: branch.code,
                    branchName: branch.name
                }
            );

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
        if (error.statusCode) {
            return res.status(error.statusCode).json({ success: false, message: error.message });
        }
        console.error(`[EXPORT IMAGE] Global Controller Error:`, error);
        next(error);
    }
};

/**
 * GET /api/branch-reports/:branchId/export-bagi-hasil-pdf?month=2&year=2026
 */
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

        const branchCodeOrName = (branch.code && branch.code.trim()) ? branch.code.trim() : branch.name;
        const filename = generateFilename('PDF', `Bagi_Hasil_${branchCodeOrName}`);
        const selectedMonthDate = new Date(year, month - 1, 1);

        try {
            const filepath = await exportBagiHasilToPDF(report, filename, branchCodeOrName, selectedMonthDate);

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

/**
 * GET /api/branch-reports/:branchId/export-savings-pdf?month=2&year=2026
 */
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

module.exports = {
    exportPdf,
    exportExcel,
    exportImage,
    exportBagiHasilPdf,
    exportSavingsPdf
};
