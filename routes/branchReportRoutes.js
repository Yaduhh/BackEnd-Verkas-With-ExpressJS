const express = require('express');
const router = express.Router();
const {
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
} = require('../controllers/branchReportController');
const { authenticate } = require('../middleware/auth');

router.use(authenticate);

// Bagi Hasil Templates routes
router.get('/:branchId/bagi-hasil-templates', getBagiHasilTemplates);
router.post('/:branchId/bagi-hasil-templates', createBagiHasilTemplate);
router.put('/:branchId/bagi-hasil-templates/:templateId', updateBagiHasilTemplate);
router.delete('/:branchId/bagi-hasil-templates/:templateId', deleteBagiHasilTemplate);

// Expense Order Templates routes
router.get('/:branchId/expense-order-templates', getExpenseOrderTemplates);
router.post('/:branchId/expense-order-templates', createExpenseOrderTemplate);
router.put('/:branchId/expense-order-templates/:templateId', updateExpenseOrderTemplate);
router.delete('/:branchId/expense-order-templates/:templateId', deleteExpenseOrderTemplate);

// Consolidated & Group Reports
router.get('/consolidated/report', getConsolidatedReport);
router.get('/consolidated/financial-report', getGroupFinancialReport);
router.get('/consolidated/export', exportGroupPdf);
router.get('/consolidated/export-image', exportGroupImage);
router.get('/group/report', getGroupFinancialReport);
router.get('/group/export', exportGroupPdf);
router.get('/group/export-image', exportGroupImage);

// GET /api/branch-reports/:branchId?month=2&year=2026
router.get('/:branchId', getReport);

// GET /api/branch-reports/:branchId/export?month=2&year=2026&workingDays=25
router.get('/:branchId/export', exportPdf);

// GET /api/branch-reports/:branchId/export-image?month=2&year=2026&workingDays=25
router.get('/:branchId/export-image', exportImage);

// GET /api/branch-reports/:branchId/export-bagi-hasil?month=2&year=2026
router.get('/:branchId/export-bagi-hasil', exportBagiHasilPdf);

// POST & GET /api/branch-reports/:branchId/export-savings-pdf
router.post('/:branchId/export-savings-pdf', exportSavingsPdf);
router.get('/:branchId/export-savings-pdf', exportSavingsPdf);

// PUT /api/branch-reports/:branchId?month=2&year=2026
router.put('/:branchId', updateReport);

module.exports = router;
