const express = require('express');
const router = express.Router();
const {
  getOverview,
  getAllUsers,
  createUser,
  updateUser,
  deleteUser,
  resetUserPassword,
  getAllTeams,
  getTeamDetail,
  getAllBranches,
  getAllTransactions,
  getAllCategories,
  getAllActivityLogs,
  getAllSystemLogs,
  getAllPayments,
  getAllSubscriptions,
  getAllPlans,
  createPlan,
  updatePlan,
  deletePlan
} = require('../controllers/masterController');
const { authenticate, authorize } = require('../middleware/auth');

// All routes require authentication and master role
router.use(authenticate);
router.use(authorize('master'));

// Overview statistics
router.get('/overview', getOverview);

// User management
router.get('/users', getAllUsers);
router.post('/users', createUser);
router.put('/users/:id', updateUser);
router.delete('/users/:id', deleteUser);
router.post('/users/:id/reset-password', resetUserPassword);

// Team management
router.get('/teams', getAllTeams);
router.get('/teams/:id', getTeamDetail);

// Branch management
router.get('/branches', getAllBranches);

// Transaction management
router.get('/transactions', getAllTransactions);

// Category management
router.get('/categories', getAllCategories);

// Logs
router.get('/activity-logs', getAllActivityLogs);
router.get('/system-logs', getAllSystemLogs);

// Payments & Subscriptions
router.get('/payments', getAllPayments);
router.get('/subscriptions', getAllSubscriptions);

// Plans/Packages management
router.get('/plans', getAllPlans);
router.post('/plans', createPlan);
router.put('/plans/:id', updatePlan);
router.delete('/plans/:id', deletePlan);

module.exports = router;
