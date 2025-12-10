const { body, query, param, validationResult } = require('express-validator');

// Validation result handler
const handleValidationErrors = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      message: 'Validation failed',
      errors: errors.array()
    });
  }
  next();
};

// Auth validators
const validateLogin = [
  body('email')
    .isEmail()
    .withMessage('Format email tidak valid')
    .normalizeEmail(),
  body('password')
    .notEmpty()
    .withMessage('Password wajib diisi')
    .isLength({ min: 6 })
    .withMessage('Password minimal 6 karakter'),
  handleValidationErrors
];

// Transaction validators
const validateCreateTransaction = [
  body('type')
    .isIn(['income', 'expense'])
    .withMessage('Type must be income or expense'),
  body('category')
    .notEmpty()
    .withMessage('Category is required')
    .trim(),
  body('amount')
    .isFloat({ min: 0.01 })
    .withMessage('Amount must be a positive number'),
  body('date')
    .isISO8601()
    .withMessage('Date must be valid ISO 8601 format (YYYY-MM-DD)'),
  body('note')
    .optional()
    .trim(),
  body('lampiran')
    .custom((value, { req }) => {
      // Lampiran wajib untuk expense, optional untuk income
      // Bisa berupa array (multiple files) atau string (single file/text)
      if (req.body.type === 'expense') {
        if (!value) {
          throw new Error('Lampiran is required for expense transactions');
        }
        // Check if array
        if (Array.isArray(value)) {
          if (value.length === 0) {
            throw new Error('Lampiran is required for expense transactions');
          }
          // Validate each item in array
          for (const item of value) {
            if (!item || (typeof item === 'string' && item.trim() === '')) {
              throw new Error('Lampiran array cannot contain empty values');
            }
          }
        } else if (typeof value === 'string' && value.trim() === '') {
          throw new Error('Lampiran is required for expense transactions');
        }
      }
      return true;
    })
    .optional(),
  handleValidationErrors
];

const validateUpdateTransaction = [
  param('id')
    .isInt()
    .withMessage('ID must be an integer'),
  body('type')
    .optional()
    .isIn(['income', 'expense'])
    .withMessage('Type must be income or expense'),
  body('category')
    .optional()
    .trim(),
  body('amount')
    .optional()
    .isFloat({ min: 0.01 })
    .withMessage('Amount must be a positive number'),
  body('date')
    .optional()
    .isISO8601()
    .withMessage('Date must be valid ISO 8601 format'),
  body('note')
    .optional()
    .trim(),
  body('lampiran')
    .optional()
    .trim(),
  handleValidationErrors
];

// Category validators
const validateCreateCategory = [
  body('name')
    .notEmpty()
    .withMessage('Name is required')
    .trim()
    .isLength({ min: 1, max: 255 })
    .withMessage('Name must be between 1 and 255 characters'),
  body('type')
    .isIn(['income', 'expense'])
    .withMessage('Type must be income or expense'),
  handleValidationErrors
];

const validateUpdateCategory = [
  param('id')
    .isInt()
    .withMessage('ID must be an integer'),
  body('name')
    .optional()
    .trim()
    .isLength({ min: 1, max: 255 })
    .withMessage('Name must be between 1 and 255 characters'),
  body('type')
    .optional()
    .isIn(['income', 'expense'])
    .withMessage('Type must be income or expense'),
  handleValidationErrors
];

// Dashboard validators
const validateDashboardHarian = [
  query('date')
    .isISO8601()
    .withMessage('Date must be valid ISO 8601 format (YYYY-MM-DD)'),
  handleValidationErrors
];

const validateDashboardMingguan = [
  query('year')
    .isInt({ min: 2000, max: 2100 })
    .withMessage('Year must be between 2000 and 2100'),
  query('month')
    .isInt({ min: 1, max: 12 })
    .withMessage('Month must be between 1 and 12'),
  query('week')
    .optional()
    .isInt({ min: 1, max: 5 })
    .withMessage('Week must be between 1 and 5'),
  handleValidationErrors
];

const validateDashboardBulanan = [
  query('year')
    .isInt({ min: 2000, max: 2100 })
    .withMessage('Year must be between 2000 and 2100'),
  query('month')
    .isInt({ min: 1, max: 12 })
    .withMessage('Month must be between 1 and 12'),
  handleValidationErrors
];

const validateDashboardTahunan = [
  query('year')
    .optional()
    .isInt({ min: 2000, max: 2100 })
    .withMessage('Year must be between 2000 and 2100'),
  handleValidationErrors
];

// Export validators - for POST (body)
const validateExport = [
  body('title')
    .optional()
    .trim(),
  body('from_date')
    .isISO8601()
    .withMessage('from_date must be valid ISO 8601 format'),
  body('to_date')
    .isISO8601()
    .withMessage('to_date must be valid ISO 8601 format'),
  body('category')
    .optional()
    .trim(),
  body('format')
    .optional()
    .isIn(['XLS', 'CSV', 'PDF'])
    .withMessage('Format must be XLS, CSV, or PDF'),
  body('include_deleted')
    .optional()
    .custom((value) => {
      if (value !== undefined && typeof value !== 'boolean' && value !== 'true' && value !== 'false') {
        throw new Error('include_deleted must be boolean');
      }
      return true;
    }),
  handleValidationErrors
];

// Export validators - for GET (query params)
const validateExportQuery = [
  query('title')
    .optional()
    .trim(),
  query('from_date')
    .isISO8601()
    .withMessage('from_date must be valid ISO 8601 format'),
  query('to_date')
    .isISO8601()
    .withMessage('to_date must be valid ISO 8601 format'),
  query('category')
    .optional()
    .trim(),
  query('format')
    .optional()
    .isIn(['XLS', 'CSV', 'PDF'])
    .withMessage('Format must be XLS, CSV, or PDF'),
  query('include_deleted')
    .optional()
    .custom((value) => {
      if (value !== undefined && value !== 'true' && value !== 'false') {
        throw new Error('include_deleted must be boolean');
      }
      return true;
    }),
  handleValidationErrors
];

module.exports = {
  validateLogin,
  validateCreateTransaction,
  validateUpdateTransaction,
  validateCreateCategory,
  validateUpdateCategory,
  validateDashboardHarian,
  validateDashboardMingguan,
  validateDashboardBulanan,
  validateDashboardTahunan,
  validateExport,
  validateExportQuery,
  handleValidationErrors
};

