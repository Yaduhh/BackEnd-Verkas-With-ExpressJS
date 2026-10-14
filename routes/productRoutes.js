const express = require('express');
const router = express.Router();
const {
  getProducts,
  getProductById,
  createProduct,
  updateProduct,
  deleteProduct,
  restoreProduct,
  addBrand,
  updateBrand,
  deleteBrand
} = require('../controllers/productController');
const { authenticate } = require('../middleware/auth');
const { optionalBranchContext } = require('../middleware/branchContext');

// All routes require authentication
router.use(authenticate);
router.use(optionalBranchContext);

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
