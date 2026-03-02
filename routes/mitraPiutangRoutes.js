const express = require('express');
const router = express.Router();
const {
  getAll,
  getById,
  create,
  update,
  delete: deleteMitraPiutang,
  restore
} = require('../controllers/mitraPiutangController');
const { authenticate } = require('../middleware/auth');
const { getCurrentBranch } = require('../middleware/branch');

// All routes require authentication
router.use(authenticate);
router.use(getCurrentBranch);

// Get all mitra piutang
router.get('/', getAll);

// Get mitra piutang by ID
router.get('/:id', getById);

// Create mitra piutang
router.post('/', create);

// Update mitra piutang
router.put('/:id', update);

// Soft delete mitra piutang
router.delete('/:id', deleteMitraPiutang);

// Restore mitra piutang
router.post('/:id/restore', restore);

module.exports = router;

