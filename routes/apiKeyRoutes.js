const express = require('express');
const router = express.Router();
const apiKeyController = require('../controllers/apiKeyController');
const { authenticate } = require('../middleware/auth');

// All API key management routes require login
router.use(authenticate);

// Allow owner, co-owner, master, and admin to manage API Keys
router.use((req, res, next) => {
  if (!req.user) {
    return res.status(401).json({
      success: false,
      message: 'Authentication required'
    });
  }

  const role = (req.user.role || '').toLowerCase().trim();
  const allowedRoles = ['owner', 'co-owner', 'master', 'admin'];

  if (!allowedRoles.includes(role)) {
    console.warn(`[ApiKeyRoutes 403] User: ${req.user.email} (ID: ${req.user.id}), Role: "${req.user.role}"`);
    return res.status(403).json({
      success: false,
      message: `Akses ditolak: Peran akun Anda (${req.user.role}) tidak memiliki izin mengelola API Key.`
    });
  }

  next();
});

router.get('/', apiKeyController.getAll);
router.post('/', apiKeyController.create);
router.put('/:id/revoke', apiKeyController.revoke);
router.delete('/:id', apiKeyController.delete);

module.exports = router;
