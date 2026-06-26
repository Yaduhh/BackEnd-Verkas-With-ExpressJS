const express = require('express');
const router = express.Router();
const {
  getAll,
  create,
  deleteAccount
} = require('../controllers/bankAccountController');
const { authenticate } = require('../middleware/auth');

// All routes require authentication
router.use(authenticate);

// Get all bank accounts for branch
router.get('/', getAll);

// Create new bank account
router.post('/', create);

// Delete bank account
router.delete('/:id', deleteAccount);

module.exports = router;
