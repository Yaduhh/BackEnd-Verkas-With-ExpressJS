const express = require('express');
const router = express.Router();
const { exportReport, exportBukuKas } = require('../controllers/exportController');
const { exportCategoryReport } = require('../controllers/categoryReportController');
const { authenticate } = require('../middleware/auth');
const { optionalBranchContext } = require('../middleware/branchContext');
const { validateExport, validateExportQuery } = require('../middleware/validator');

// All routes require authentication
router.use(authenticate);

// Add branch context (optional, will check in controller)
router.use(optionalBranchContext);

// Export report - support both GET (query params) and POST (body)
router.get('/', validateExportQuery, exportReport);
router.post('/', validateExport, exportReport);

// Export BukuKas - support both GET (query params) and POST (body)
router.get('/bukukas', exportBukuKas);
router.post('/bukukas', exportBukuKas);

// Export Category specific report
router.get('/category', exportCategoryReport);
router.post('/category', exportCategoryReport);

module.exports = router;

