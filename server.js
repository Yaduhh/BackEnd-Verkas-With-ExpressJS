const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const config = require('./config/config');
const { errorHandler, notFound } = require('./middleware/errorHandler');

// Import routes
const authRoutes = require('./routes/authRoutes');
const transactionRoutes = require('./routes/transactionRoutes');
const categoryRoutes = require('./routes/categoryRoutes');
const dashboardRoutes = require('./routes/dashboardRoutes');
const exportRoutes = require('./routes/exportRoutes');
const uploadRoutes = require('./routes/uploadRoutes');
const branchRoutes = require('./routes/branchRoutes');
const subscriptionRoutes = require('./routes/subscriptionRoutes');
const paymentRoutes = require('./routes/paymentRoutes');
const teamRoutes = require('./routes/teamRoutes');

// Initialize app
const app = express();

// Security middleware
app.use(helmet());

// CORS configuration - Allow multiple origins for development
const allowedOrigins = [
  config.corsOrigin,
  'http://localhost:19006', // Expo web default
  'http://localhost:8081', // Metro bundler
  'http://127.0.0.1:8081', // iOS Simulator Metro
  'http://127.0.0.1:19006', // iOS Simulator Expo web
  'http://localhost:3000', // Backend (for testing)
  'http://127.0.0.1:3000', // Backend (for iOS simulator)
  'http://192.168.1.6:8081', // Physical device Metro
  'http://192.168.1.6:19006', // Physical device Expo web
  'http://192.168.1.6:3000', // Physical device Backend
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
      console.log(`✅ Allowing origin in development: ${origin}`);
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

// Serve uploaded files statically
const path = require('path');
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Health check
app.get('/health', (req, res) => {
  res.json({
    success: true,
    message: 'Server is running',
    timestamp: new Date().toISOString()
  });
});

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/transactions', transactionRoutes);
app.use('/api/categories', categoryRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/export', exportRoutes);
app.use('/api/upload', uploadRoutes);
app.use('/api/branches', branchRoutes);
app.use('/api/subscriptions', subscriptionRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/teams', teamRoutes);

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

