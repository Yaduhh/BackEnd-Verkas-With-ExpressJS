const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const { uploadFile, uploadFiles, getFile, deleteFile } = require('../controllers/uploadController');

// Upload single file (requires authentication)
router.post('/', authenticate, uploadFile);

// Upload multiple files (requires authentication)
// ?type=income atau ?type=expense untuk menentukan subfolder
router.post('/multiple', authenticate, uploadFiles);

// Get file - support nested path: /upload/branchId/type/filename (requires authorization)
const Branch = require('../models/Branch');
const config = require('../config/config');

const sendAuthError = (res, req, status, title, message) => {
  const acceptHeader = req.headers.accept || '';
  if (acceptHeader.includes('application/json')) {
    return res.status(status).json({ success: false, message });
  }
  
  let redirectUrl = config.corsOrigin || 'http://localhost:5173';
  if (redirectUrl.includes(':8081') || redirectUrl.includes(':19006')) {
    redirectUrl = 'http://localhost:5173';
  }

  return res.status(status).send(`
<!DOCTYPE html>
<html lang="id">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${status} - ${title}</title>
    <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;600;800&display=swap" rel="stylesheet">
    <style>
        body {
            font-family: 'Plus Jakarta Sans', sans-serif;
            background-color: #0a0c0e;
            color: #ffffff;
            display: flex;
            align-items: center;
            justify-content: center;
            min-height: 100vh;
            margin: 0;
            padding: 24px;
            box-sizing: border-box;
        }
        .card {
            background: rgba(255, 255, 255, 0.02);
            border: 1px solid rgba(255, 255, 255, 0.08);
            border-radius: 28px;
            padding: 48px 32px;
            max-width: 440px;
            width: 100%;
            text-align: center;
            backdrop-filter: blur(20px);
            box-shadow: 0 24px 50px rgba(0, 0, 0, 0.5);
        }
        .icon-box {
            width: 72px;
            height: 72px;
            background: rgba(239, 68, 68, 0.08);
            border: 1px solid rgba(239, 68, 68, 0.2);
            border-radius: 22px;
            display: flex;
            align-items: center;
            justify-content: center;
            margin: 0 auto 28px;
            color: #ef4444;
        }
        h1 {
            font-size: 22px;
            font-weight: 800;
            margin: 0 0 12px;
            letter-spacing: -0.02em;
            color: #f3f4f6;
        }
        p {
            font-size: 14px;
            color: #9ca3af;
            line-height: 1.6;
            margin: 0 0 36px;
        }
        .btn {
            display: inline-block;
            background: #4f46e5;
            color: #ffffff;
            font-weight: 700;
            font-size: 14px;
            text-decoration: none;
            padding: 14px 28px;
            border-radius: 16px;
            transition: all 0.2s;
            box-shadow: 0 8px 20px rgba(79, 70, 229, 0.2);
        }
        .btn:hover {
            background: #4338ca;
            transform: translateY(-2px);
            box-shadow: 0 12px 24px rgba(79, 70, 229, 0.3);
        }
        .btn:active {
            transform: translateY(0);
        }
        .logo {
            font-size: 22px;
            font-weight: 800;
            color: #4f46e5;
            margin-bottom: 28px;
            display: block;
            letter-spacing: -0.03em;
        }
    </style>
</head>
<body>
    <div class="card">
        <span class="logo">Verkas.</span>
        <div class="icon-box">
            <svg xmlns="http://www.w3.org/2000/svg" width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>
        </div>
        <h1>${title}</h1>
        <p>${message}</p>
        <a href="${redirectUrl}/login" class="btn">Kembali ke Aplikasi</a>
    </div>
</body>
</html>
  `);
};

router.get('/*', authenticate, async (req, res, next) => {
  try {
    const nestedPath = req.params[0] || '';
    const pathParts = nestedPath.split('/').filter(Boolean);
    const branchIdStr = pathParts[0];

    if (branchIdStr && /^\d+$/.test(branchIdStr)) {
      const branchId = parseInt(branchIdStr, 10);
      const hasAccess = await Branch.userHasAccess(req.userId, branchId, req.user.role);
      if (!hasAccess) {
        return sendAuthError(res, req, 403, 'Akses Ditolak', 'Anda tidak memiliki hak akses untuk melihat berkas lampiran dari buku kas ini.');
      }
    }
    next();
  } catch (error) {
    next(error);
  }
}, getFile);

// Delete file (requires authentication)
router.delete('/:filename', authenticate, deleteFile);

module.exports = router;
