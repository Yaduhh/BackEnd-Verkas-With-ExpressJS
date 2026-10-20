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
  checkLimit,
  assignGroup,
  renameGroup,
  deleteGroup
} = require('../controllers/branchController');
const { getLockedPeriods, toggleLock } = require('../controllers/lockedPeriodController');
const { authenticate, authorize } = require('../middleware/auth');

// All routes require authentication
router.use(authenticate);

// Group management routes (owner & co-owner)
router.post('/group/assign', authorize('owner', 'co-owner'), assignGroup);
router.put('/group/rename', authorize('owner', 'co-owner'), renameGroup);
router.delete('/group/:groupName', authorize('owner', 'co-owner'), deleteGroup);

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

// Update branch (owner and co-owner)
router.put('/:id', authorize('owner', 'co-owner'), update);

// Assign PIC to branch (owner and co-owner) - adds to existing PICs
router.post('/:id/assign-pic', authorize('owner', 'co-owner'), assignPIC);

// Remove PIC from branch (owner and co-owner) - can remove specific PIC or all
router.post('/:id/remove-pic', authorize('owner', 'co-owner'), removePIC);

// Set multiple PICs at once (replaces existing) (owner and co-owner)
router.put('/:id/pics', authorize('owner', 'co-owner'), setPICs);

// Soft delete branch (owner and co-owner)
router.delete('/:id', authorize('owner', 'co-owner'), softDelete);

// Restore branch (owner and co-owner)
router.post('/:id/restore', authorize('owner', 'co-owner'), restore);

// Get locked periods for a branch (requires auth, any role can read)
router.get('/:id/locked-periods', getLockedPeriods);

// Toggle locked period (owner and co-owner only)
router.post('/:id/toggle-lock', authorize('owner', 'co-owner'), toggleLock);

module.exports = router;

