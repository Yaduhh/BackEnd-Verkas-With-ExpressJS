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
  requestEdit,
  approveEdit,
  rejectEdit,
  getEditRequests
} = require('../controllers/transactionController');
const { authenticate, authorize } = require('../middleware/auth');
const { optionalBranchContext } = require('../middleware/branchContext');
const {
  validateCreateTransaction,
  validateUpdateTransaction
} = require('../middleware/validator');

// All routes require authentication
router.use(authenticate);

// Add branch context (optional, will check in controller)
router.use(optionalBranchContext);

// Get all transactions
router.get('/', getAll);

// Get edit requests
router.get('/edit-requests', getEditRequests);

// Get transaction by ID
router.get('/:id', getById);

// Create transaction
router.post('/', validateCreateTransaction, create);

// Update transaction
router.put('/:id', validateUpdateTransaction, update);

// Soft delete transaction
router.delete('/:id', softDelete);

// Restore transaction
router.post('/:id/restore', restore);

// Hard delete (permanent, admin only)
router.delete('/:id/force', authorize('admin', 'owner'), hardDelete);

// Request edit (admin only)
router.post('/:id/request-edit', requestEdit);

// Approve edit request (owner only)
router.post('/:id/approve-edit', approveEdit);

// Reject edit request (owner only)
router.post('/:id/reject-edit', rejectEdit);

module.exports = router;

