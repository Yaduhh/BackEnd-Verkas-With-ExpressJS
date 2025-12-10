const express = require('express');
const router = express.Router();
const { login, register, getMe, logout, getAdmins } = require('../controllers/authController');
const { authenticate, authorize } = require('../middleware/auth');
const { validateLogin, handleValidationErrors } = require('../middleware/validator');
const { body } = require('express-validator');

// Validation for register
const validateRegister = [
  body('email')
    .isEmail()
    .withMessage('Email must be valid')
    .normalizeEmail(),
  body('password')
    .notEmpty()
    .withMessage('Password is required')
    .isLength({ min: 6 })
    .withMessage('Password must be at least 6 characters'),
  body('name')
    .optional()
    .trim()
    .isLength({ min: 1 })
    .withMessage('Name must not be empty'),
  body('role')
    .optional()
    .isIn(['owner', 'admin'])
    .withMessage('Role must be owner or admin'),
  handleValidationErrors
];

// Public routes
router.post('/login', validateLogin, login);
router.post('/register', validateRegister, register);
router.post('/logout', authenticate, logout);

// Protected routes
router.get('/me', authenticate, getMe);
router.get('/admins', authenticate, authorize('owner'), getAdmins);

module.exports = router;

