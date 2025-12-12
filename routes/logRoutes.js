const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const { requireBranch } = require('../middleware/branch');
const {
  getActivityLogs,
  getBranchActivityLogs,
  getEntityLogs,
  getSystemLogs,
} = require('../controllers/logController');

// All routes require authentication
router.use(authenticate);

// Activity logs routes
router.get('/activity', requireBranch, getActivityLogs);
router.get('/activity/branch/:branchId', getBranchActivityLogs);
router.get('/activity/entity/:entityType/:entityId', requireBranch, getEntityLogs);

// System logs routes (admin only)
router.get('/system', getSystemLogs);

module.exports = router;

