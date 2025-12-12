const express = require('express');
const router = express.Router();
const {
  getPending,
  getAll,
  getById,
  verify,
  updateStatus,
  createXenditPayment,
  getXenditPaymentStatus,
  verifyXenditPayment,
  xenditWebhook,
  simulateXenditPayment
} = require('../controllers/paymentController');
const { authenticate, authorize } = require('../middleware/auth');

// Webhook routes (no auth required, but verified via token)
router.post('/xendit/webhook', xenditWebhook);

// All other routes require authentication
router.use(authenticate);

// Get pending payments (owner and co-owner)
router.get('/pending', authorize('owner', 'co-owner'), getPending);

// Get all payments (owner and co-owner)
router.get('/all', authorize('owner', 'co-owner'), getAll);

// Get payment by ID
router.get('/:id', getById);

// Xendit payment routes
router.post('/:id/xendit/create', createXenditPayment);
router.get('/xendit/:xenditId/status', getXenditPaymentStatus);
router.post('/:id/xendit/verify', verifyXenditPayment);

// Verify payment (webhook - no auth required, but should verify signature)
router.post('/verify', verify);

// Update payment status manually (owner and co-owner)
router.put('/:id/status', authorize('owner', 'co-owner'), updateStatus);

// Simulate Xendit payment (for testing/development only - owner and co-owner)
router.post('/:paymentId/xendit/simulate', authorize('owner', 'co-owner'), simulateXenditPayment);

module.exports = router;

