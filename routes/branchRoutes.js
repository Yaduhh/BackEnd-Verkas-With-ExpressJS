const express = require('express');
const router = express.Router();
const {
  getAll,
  getById,
  getCurrent,
  create,
  update,
  assignPIC,
  removePIC,
  setPICs,
  softDelete,
  restore,
  checkLimit
} = require('../controllers/branchController');
const { authenticate, authorize } = require('../middleware/auth');

// All routes require authentication
router.use(authenticate);

// Get all branches user has access to
router.get('/', getAll);

// Get current branch (for admin: assigned branch, for owner: from header or first)
router.get('/current', getCurrent);

// Check branch creation limit
router.get('/check-limit', checkLimit);

// Get branch by ID
router.get('/:id', getById);

// Create branch (owner only)
router.post('/', authorize('owner'), create);

// Update branch (owner only)
router.put('/:id', authorize('owner'), update);

// Assign PIC to branch (owner only) - adds to existing PICs
router.post('/:id/assign-pic', authorize('owner'), assignPIC);

// Remove PIC from branch (owner only) - can remove specific PIC or all
router.post('/:id/remove-pic', authorize('owner'), removePIC);

// Set multiple PICs at once (replaces existing) (owner only)
router.put('/:id/pics', authorize('owner'), setPICs);

// Soft delete branch (owner only)
router.delete('/:id', authorize('owner'), softDelete);

// Restore branch (owner only)
router.post('/:id/restore', authorize('owner'), restore);

module.exports = router;

