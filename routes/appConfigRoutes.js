const express = require('express');
const router = express.Router();
const appConfigController = require('../controllers/appConfigController');

// Route ini PUBLIC (tidak butuh authenticate middleware)
router.get('/version', appConfigController.getVersion);

module.exports = router;
