const express = require('express');
const router = express.Router();
const apiKeyAuth = require('../middleware/apiKeyAuth');
const externalApiController = require('../controllers/externalApiController');

// All external API routes require a valid API key
router.get('/meta', apiKeyAuth('meta:read'), externalApiController.getMeta);
router.post('/transactions', apiKeyAuth('transactions:create'), externalApiController.createTransaction);
router.delete('/transactions', apiKeyAuth('transactions:create'), externalApiController.deleteTransaction);
router.get('/refunds', apiKeyAuth('meta:read'), externalApiController.getRefunds);
router.post('/refunds', apiKeyAuth('transactions:create'), externalApiController.createRefund);
router.put('/refunds/:refundId', apiKeyAuth('transactions:create'), externalApiController.updateRefund);
router.delete('/refunds/:refundId', apiKeyAuth('transactions:create'), externalApiController.deleteRefund);

module.exports = router;

