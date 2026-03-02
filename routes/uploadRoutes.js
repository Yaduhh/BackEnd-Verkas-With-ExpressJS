const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const { uploadFile, uploadFiles, getFile, deleteFile } = require('../controllers/uploadController');

// Upload single file (requires authentication)
router.post('/', authenticate, uploadFile);

// Upload multiple files (requires authentication)
// ?type=income atau ?type=expense untuk menentukan subfolder
router.post('/multiple', authenticate, uploadFiles);

// Get file - support nested path: /upload/branchId/type/filename
router.get('/*', getFile);

// Delete file (requires authentication)
router.delete('/:filename', authenticate, deleteFile);

module.exports = router;
