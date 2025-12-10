const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const { uploadFile, uploadFiles, getFile, deleteFile } = require('../controllers/uploadController');

// Upload single file (requires authentication)
router.post('/', authenticate, uploadFile);

// Upload multiple files (requires authentication)
router.post('/multiple', authenticate, uploadFiles);

// Get file (public access for viewing - files are served statically via /uploads)
router.get('/:filename', getFile);

// Delete file (requires authentication)
router.delete('/:filename', authenticate, deleteFile);

module.exports = router;

