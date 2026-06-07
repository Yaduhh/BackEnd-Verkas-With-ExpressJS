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

// Get all available plans (public)
router.get('/plans', getPlans);

// All other routes require authentication
router.use(authenticate);

// Get current subscription (owner and co-owner)
router.get('/current', authorize('owner', 'co-owner'), getCurrent);

// Get subscription history (owner and co-owner)
router.get('/history', authorize('owner', 'co-owner'), getHistory);

// Create subscription (owner and co-owner)
router.post('/', authorize('owner', 'co-owner'), create);

// Cancel subscription (owner and co-owner)
router.put('/:id/cancel', authorize('owner', 'co-owner'), cancel);

// Get payments for subscription (owner and co-owner)
router.get('/:id/payments', authorize('owner', 'co-owner'), getPayments);

module.exports = router;

