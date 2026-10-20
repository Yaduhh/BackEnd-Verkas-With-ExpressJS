const express = require('express');
const router = express.Router();
const multer = require('multer');
const uploadMemory = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }
});

const {
  getProducts,
  getProductById,
  createProduct,
  updateProduct,
  deleteProduct,
  restoreProduct,
  addBrand,
  updateBrand,
  deleteBrand,
  bulkDeleteProducts,
  deleteProductsByCategory,
  bulkAssignCategory,
  downloadTemplate,
  previewExcel,
  importExcel
} = require('../controllers/productController');
const { authenticate } = require('../middleware/auth');
const { optionalBranchContext } = require('../middleware/branchContext');

// All routes require authentication
router.use(authenticate);
router.use(optionalBranchContext);

// Excel template, preview & import (must be registered BEFORE /:id)
router.get('/template-excel', downloadTemplate);
router.post('/preview-excel', uploadMemory.single('file'), previewExcel);
router.post('/import-excel', uploadMemory.single('file'), importExcel);

// Bulk operations (must be registered BEFORE /:id)
router.post('/bulk-delete', bulkDeleteProducts);
router.post('/bulk-assign-category', bulkAssignCategory);
router.delete('/by-category/:categoryId', deleteProductsByCategory);

// Products
router.get('/', getProducts);
router.get('/:id', getProductById);
router.post('/', createProduct);
router.put('/:id', updateProduct);
router.delete('/:id', deleteProduct);
router.post('/:id/restore', restoreProduct);

// Brands under product
router.post('/:productId/brands', addBrand);
router.put('/brands/:brandId', updateBrand);
router.delete('/brands/:brandId', deleteBrand);

module.exports = router;
