const express = require('express');
const router = express.Router();
const {
  getSalesChannels,
  getSalesChannelById,
  createSalesChannel,
  updateSalesChannel,
  deleteSalesChannel,
  restoreSalesChannel
} = require('../controllers/salesChannelController');
const { authenticate } = require('../middleware/auth');
const { optionalBranchContext } = require('../middleware/branchContext');

// All routes require authentication
router.use(authenticate);
router.use(optionalBranchContext);

// Get all sales channels
router.get('/', getSalesChannels);

// Get single sales channel
router.get('/:id', getSalesChannelById);

// Create new sales channel
router.post('/', createSalesChannel);

// Update sales channel
router.put('/:id', updateSalesChannel);

// Soft delete sales channel
router.delete('/:id', deleteSalesChannel);

// Restore sales channel
router.post('/:id/restore', restoreSalesChannel);

module.exports = router;
