const express = require('express');
const router = express.Router();
const { getReport, updateReport, exportPdf } = require('../controllers/branchReportController');
const { authenticate } = require('../middleware/auth');

router.use(authenticate);

// GET /api/branch-reports/:branchId?month=2&year=2026
router.get('/:branchId', getReport);

// GET /api/branch-reports/:branchId/export?month=2&year=2026&workingDays=25
router.get('/:branchId/export', exportPdf);

// PUT /api/branch-reports/:branchId?month=2&year=2026
router.put('/:branchId', updateReport);

module.exports = router;
