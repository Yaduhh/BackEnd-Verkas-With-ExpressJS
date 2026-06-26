const express = require('express');
const router = express.Router();
const {
  getAll,
  getById,
  create,
  update,
  softDelete,
  restore,
  hardDelete,
  getAllocations,
  updateAllocations
} = require('../controllers/categoryController');
const { authenticate, authorize } = require('../middleware/auth');
const {
  validateCreateCategory,
  validateUpdateCategory
} = require('../middleware/validator');

// All routes require authentication
router.use(authenticate);

// Get all categories
router.get('/', getAll);

// Get category by ID
router.get('/:id', getById);

// Create category
router.post('/', validateCreateCategory, create);

// Update category
router.put('/:id', validateUpdateCategory, update);

// Get savings account allocations
router.get('/:id/allocations', getAllocations);

// Update savings account allocations
router.put('/:id/allocations', updateAllocations);

// Soft delete category
router.delete('/:id', softDelete);

// Restore category
router.post('/:id/restore', restore);

// Hard delete (permanent, admin only)
router.delete('/:id/force', authorize('admin', 'owner'), hardDelete);

module.exports = router;

