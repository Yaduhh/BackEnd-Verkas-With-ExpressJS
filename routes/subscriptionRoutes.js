const express = require('express');
const router = express.Router();
const {
  getPlans,
  getCurrent,
  getHistory,
  create,
  cancel,
  getPayments
} = require('../controllers/subscriptionController');
const { authenticate, authorize } = require('../middleware/auth');

// All routes require authentication
router.use(authenticate);

// Get all available plans (public for authenticated users)
router.get('/plans', getPlans);

// Get current subscription (owner only)
router.get('/current', authorize('owner'), getCurrent);

// Get subscription history (owner only)
router.get('/history', authorize('owner'), getHistory);

// Create subscription (owner only)
router.post('/', authorize('owner'), create);

// Cancel subscription (owner only)
router.put('/:id/cancel', authorize('owner'), cancel);

// Get payments for subscription (owner only)
router.get('/:id/payments', authorize('owner'), getPayments);

module.exports = router;

