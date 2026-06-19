const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const config = require('./config/config');
const { errorHandler, notFound } = require('./middleware/errorHandler');

// Import routes
const authRoutes = require('./routes/authRoutes');
const transactionRoutes = require('./routes/transactionRoutes');
const categoryRoutes = require('./routes/categoryRoutes');
const mitraPiutangRoutes = require('./routes/mitraPiutangRoutes');
const dashboardRoutes = require('./routes/dashboardRoutes');
const exportRoutes = require('./routes/exportRoutes');
const uploadRoutes = require('./routes/uploadRoutes');
const branchRoutes = require('./routes/branchRoutes');
const subscriptionRoutes = require('./routes/subscriptionRoutes');
const paymentRoutes = require('./routes/paymentRoutes');
const teamRoutes = require('./routes/teamRoutes');
const notificationRoutes = require('./routes/notificationRoutes');
const logRoutes = require('./routes/logRoutes');
const masterRoutes = require('./routes/masterRoutes');
const paymentMethodRoutes = require('./routes/paymentMethodRoutes');
const branchReportRoutes = require('./routes/branchReportRoutes');
const appConfigRoutes = require('./routes/appConfigRoutes');

// Initialize app
const app = express();

// Security middleware
// Allow loading images/files from /uploads in cross-origin (web client)
app.use(helmet({
  crossOriginResourcePolicy: { policy: "cross-origin" }, // allow images/files to be loaded by other origins
}));

// CORS configuration - Allow multiple origins for development
const allowedOrigins = [
  config.corsOrigin,
  'http://localhost:19006', // Expo web default
  'http://localhost:8081', // Metro bundler
  'http://127.0.0.1:8081', // iOS Simulator Metro
  'http://127.0.0.1:19006', // iOS Simulator Expo web
  'http://localhost:3000', // Backend (for testing)
  'http://127.0.0.1:3000', // Backend (for iOS simulator)
  'http://192.168.1.65:8081', // Physical device Metro
  'http://192.168.1.56:19006', // Physical device Expo web
  'http://10.127.31.2383000', // Physical device Backend
  /^http:\/\/192\.168\.\d+\.\d+:8081$/, // Physical device Metro
  /^http:\/\/192\.168\.\d+\.\d+:19006$/, // Physical device Expo web
  /^http:\/\/192\.168\.\d+\.\d+:3000$/, // Physical device Backend
];

app.use(cors({
  origin: function (origin, callback) {
    // Allow requests with no origin (mobile apps, Postman, etc.)
    // iOS Simulator dan Android Emulator biasanya tidak mengirim origin
    if (!origin) {
      console.log('⚠️  Request without origin (mobile app) - allowing');
      return callback(null, true);
    }

    // Check if origin is allowed
    const isAllowed = allowedOrigins.some(allowed => {
      if (typeof allowed === 'string') {
        return origin === allowed;
      }
      if (allowed instanceof RegExp) {
        return allowed.test(origin);
      }
      return false;
    });

    // In development, allow all origins for easier testing
    if (process.env.NODE_ENV === 'development') {
      return callback(null, true);
    }

    if (isAllowed) {
      console.log(`✅ Allowed origin: ${origin}`);
      callback(null, true);
    } else {
      console.log(`❌ Blocked origin: ${origin}`);
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Branch-Id'],
}));

// Body parser middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve uploaded files statically with explicit CORS headers and authorization check
const path = require('path');
const jwt = require('jsonwebtoken');
const Branch = require('./models/Branch');
const User = require('./models/User');

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

const uploadsStatic = express.static(path.join(__dirname, 'uploads'), {
  setHeaders: (res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
    // avoid stale cached response without CORS headers
    res.setHeader('Cache-Control', 'no-store');
  }
});

app.use(
  '/uploads',
  cors({ origin: true, credentials: false }),
  async (req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Headers', '*');
    res.header('Access-Control-Allow-Methods', 'GET,OPTIONS');

    // Handle OPTIONS requests (preflight CORS) immediately
    if (req.method === 'OPTIONS') {
      return next();
    }

    try {
      // 1. Extract token from Header or Query string parameter (?token=...)
      const authHeader = req.headers.authorization || req.headers.Authorization;
      let token = null;
      if (authHeader && authHeader.startsWith('Bearer ')) {
        token = authHeader.substring(7);
      } else if (req.query.token) {
        token = req.query.token;
      }

      if (!token) {
        return sendAuthError(res, req, 401, 'Autentikasi Diperlukan', 'Silakan masuk ke akun Anda terlebih dahulu untuk melihat berkas lampiran ini.');
      }

      // 2. Verify Token & Get User
      const decoded = jwt.verify(token, config.jwtSecret);
      const user = await User.findById(decoded.userId);
      if (!user) {
        return sendAuthError(res, req, 401, 'Pengguna Tidak Ditemukan', 'Sesi login Anda tidak valid atau akun tidak terdaftar.');
      }

      // 3. Extract branchId from the requested file path (e.g., "/12/pemasukan/filename.jpg" -> "12")
      const pathParts = req.path.split('/').filter(Boolean);
      const branchIdStr = pathParts[0];

      if (branchIdStr && /^\d+$/.test(branchIdStr)) {
        const branchId = parseInt(branchIdStr, 10);

        // 4. Check if the user has access to this branch
        const hasAccess = await Branch.userHasAccess(user.id, branchId, user.role);
        if (!hasAccess) {
          return sendAuthError(res, req, 403, 'Akses Ditolak', 'Anda tidak memiliki hak akses untuk melihat berkas lampiran dari buku kas ini.');
        }
      }

      // Attach user credentials to req for down-stream logging/tracking if needed
      req.user = user;
      req.userId = user.id;

      next();
    } catch (error) {
      return sendAuthError(res, req, 401, 'Sesi Kedaluwarsa', 'Sesi masuk Anda telah kedaluwarsa atau tidak valid. Silakan login kembali.');
    }
  },
  uploadsStatic
);

// Health check
app.get('/health', (req, res) => {
  res.json({
    success: true,
    message: 'Server is running',
    timestamp: new Date().toISOString()
  });
});

// Global App Version Check blocker
const versionCheck = require('./middleware/versionCheck');
app.use(versionCheck);

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/transactions', transactionRoutes);
app.use('/api/categories', categoryRoutes);
app.use('/api/mitra-piutang', mitraPiutangRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/export', exportRoutes);
app.use('/api/upload', uploadRoutes);
app.use('/api/branches', branchRoutes);
app.use('/api/subscriptions', subscriptionRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/teams', teamRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/logs', logRoutes);
app.use('/api/master', masterRoutes);
app.use('/api/payment-methods', paymentMethodRoutes);
app.use('/api/branch-reports', branchReportRoutes);
app.use('/api/app-config', appConfigRoutes);

// 404 handler
app.use(notFound);

// Error handler (must be last)
app.use(errorHandler);

// Start server
const PORT = config.port;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📝 Environment: ${config.env}`);
  console.log(`🌐 CORS enabled for: ${config.corsOrigin}`);
  console.log(`\n💡 Run migrations: npm run migrate`);
  console.log(`💡 Check status: npm run migrate:status\n`);
});

module.exports = app;

