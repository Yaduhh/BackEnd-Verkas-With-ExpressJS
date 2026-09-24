const express = require('express');
const router = express.Router();
const { getReport, updateReport, exportPdf, exportBagiHasilPdf, exportSavingsPdf, exportImage } = require('../controllers/branchReportController');
const { authenticate } = require('../middleware/auth');

router.use(authenticate);

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
