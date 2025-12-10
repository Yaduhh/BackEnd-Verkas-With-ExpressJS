const express = require('express');
const router = express.Router();
const {
  getHarian,
  getMingguan,
  getBulanan,
  getBulananAll,
  getTahunan
} = require('../controllers/dashboardController');
const { authenticate } = require('../middleware/auth');
const { getCurrentBranch } = require('../middleware/branchContext');
const {
  validateDashboardHarian,
  validateDashboardMingguan,
  validateDashboardBulanan,
  validateDashboardTahunan
} = require('../middleware/validator');

// All routes require authentication
router.use(authenticate);

// Add branch context - REQUIRED for dashboard (admin auto-assign, owner from header)
router.use(getCurrentBranch);

// Dashboard endpoints
router.get('/harian', validateDashboardHarian, getHarian);
router.get('/mingguan', validateDashboardMingguan, getMingguan);
router.get('/bulanan', validateDashboardBulanan, getBulanan);
router.get('/bulanan-all', validateDashboardTahunan, getBulananAll); // Uses tahunan validator (year only)
router.get('/tahunan', validateDashboardTahunan, getTahunan);

module.exports = router;

