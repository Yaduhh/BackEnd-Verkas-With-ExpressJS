const express = require('express');
const router = express.Router();
const multer = require('multer');
const uploadMemory = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 }
});

const {
  getStocks,
  createStock,
  updateStock,
  deleteStock,
  bulkDeleteStocks,
  downloadStockTemplate,
  exportStockExcel,
  previewStockExcel,
  importStockExcel
} = require('../controllers/stockController');
const { authenticate } = require('../middleware/auth');
const { optionalBranchContext } = require('../middleware/branchContext');

router.use(authenticate);
router.use(optionalBranchContext);

// Excel endpoints (must be registered BEFORE /:id)
router.get('/template-excel', downloadStockTemplate);
router.get('/export-excel', exportStockExcel);
router.post('/preview-excel', uploadMemory.single('file'), previewStockExcel);
router.post('/import-excel', uploadMemory.single('file'), importStockExcel);

// Bulk operations
router.post('/bulk-delete', bulkDeleteStocks);

// CRUD
router.get('/', getStocks);
router.post('/', createStock);
router.put('/:id', updateStock);
router.delete('/:id', deleteStock);

module.exports = router;

