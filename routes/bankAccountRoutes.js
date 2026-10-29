const express = require('express');
const router = express.Router();
const {
  getAll,
  create,
  updateAccount,
  deleteAccount,
  getStatement
} = require('../controllers/bankAccountController');
const { authenticate } = require('../middleware/auth');

// All routes require authentication
router.use(authenticate);

// Get all bank accounts for branch
router.get('/', getAll);

// Get bank account statement & breakdown
router.get('/:id/statement', getStatement);

// Create new bank account
router.post('/', create);

// Update bank account
router.put('/:id', updateAccount);

// Delete bank account
router.delete('/:id', deleteAccount);

module.exports = router;
