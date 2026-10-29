const express = require('express');
const router = express.Router();
const {
  getAll,
  getById,
  create,
  update,
  delete: deleteTransfer,
  getAuditLogs
} = require('../controllers/fundTransferController');
const { authenticate } = require('../middleware/auth');

// All routes require authentication
router.use(authenticate);

// Get audit logs feed
router.get('/logs', getAuditLogs);

// Get all fund transfers
router.get('/', getAll);

// Get fund transfer by ID
router.get('/:id', getById);

// Create new fund transfer
router.post('/', create);

// Update fund transfer
router.put('/:id', update);

// Delete fund transfer (soft delete with audit)
router.delete('/:id', deleteTransfer);

module.exports = router;
