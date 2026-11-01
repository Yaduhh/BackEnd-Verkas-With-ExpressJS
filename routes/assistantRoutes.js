const express = require('express');
const router = express.Router();
const { chatWithAssistant, generateChartInsight } = require('../controllers/assistantController');
const { authenticate } = require('../middleware/auth');
const { getCurrentBranch } = require('../middleware/branchContext');

// All routes require authentication
router.use(authenticate);

// POST /api/assistant/chat
router.post('/chat', getCurrentBranch, chatWithAssistant);

// POST /api/assistant/chart-insight
router.post('/chart-insight', getCurrentBranch, generateChartInsight);

module.exports = router;
