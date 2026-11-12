const express = require('express');
const router = express.Router();
const multer = require('multer');
const posUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });
const { decodeId } = require('../utils/obfuscator');
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
  requestDelete,
  approveDelete,
  rejectDelete,
  getEditRequests,
  getSummary,
  getSavingsSummary,
  getHistory,
  createRepayment,
  updateRepayment,
  deleteRepayment,
  createRefund,
  updateRefund,
  deleteRefund,
  parsePosFile
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

// Parameter middleware to automatically decode transaction ID if it is obfuscated
router.param('id', (req, res, next, id) => {
  if (id && !/^\d+$/.test(id)) {
    const decoded = decodeId(id);
    if (isNaN(decoded)) {
      return res.status(400).json({ message: 'Format ID Transaksi tidak valid' });
    }
    req.params.id = decoded.toString();
  }
  next();
});

// Get all transactions
router.get('/', getAll);

// Get summary
router.get('/summary', getSummary);

// Get aggregated Kas Simpanan summary per subcategory
router.get('/savings-summary', getSavingsSummary);

// Get edit requests
router.get('/edit-requests', getEditRequests);

// Parse POS Excel / CSV file for Omzet import
router.post('/parse-pos-file', posUpload.single('file'), parsePosFile);

// Get transaction by ID
router.get('/:id', getById);

// Get transaction history
router.get('/:id/history', getHistory);

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

// Approve edit request (owner and co-owner only)
router.post('/:id/approve-edit', approveEdit);

// Reject edit request (owner and co-owner only)
router.post('/:id/reject-edit', rejectEdit);

// Request delete (admin only)
router.post('/:id/request-delete', requestDelete);

// Approve delete request (owner and co-owner only)
router.post('/:id/approve-delete', approveDelete);

// Reject delete request (owner and co-owner only)
router.post('/:id/reject-delete', rejectDelete);

// Repayment
router.post('/:id/repayment', createRepayment);
router.put('/:id/repayment/:repaymentId', updateRepayment);
router.delete('/:id/repayment/:repaymentId', deleteRepayment);

// Refund
router.post('/:id/refund', createRefund);
router.put('/:id/refund/:refundId', updateRefund);
router.delete('/:id/refund/:refundId', deleteRefund);

module.exports = router;

