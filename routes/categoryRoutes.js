const express = require('express');
const router = express.Router();
const {
  getAll,
  getById,
  create,
  update,
  softDelete,
  restore,
  hardDelete
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

// Soft delete category
router.delete('/:id', softDelete);

// Restore category
router.post('/:id/restore', restore);

// Hard delete (permanent, admin only)
router.delete('/:id/force', authorize('admin', 'owner'), hardDelete);

module.exports = router;

