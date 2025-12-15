const express = require('express');
const router = express.Router();
const { authenticate, optionalAuth } = require('../middleware/auth');
const notificationController = require('../controllers/notificationController');

// Register device token (requires auth)
router.post('/register', authenticate, notificationController.register);

// Unregister device token (optional auth - token might be removed during logout)
router.delete('/unregister', optionalAuth, notificationController.unregister);

// Get user's device tokens (requires auth)
router.get('/tokens', authenticate, notificationController.getTokens);

// Send test notification (requires auth)
router.post('/test', authenticate, notificationController.sendTest);

// Check device token status (for debugging)
router.get('/status', authenticate, notificationController.checkStatus);

module.exports = router;

