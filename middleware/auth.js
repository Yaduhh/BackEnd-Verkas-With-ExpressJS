const jwt = require('jsonwebtoken');
const config = require('../config/config');
const User = require('../models/User');

// JWT Authentication Middleware
const authenticate = async (req, res, next) => {
  try {
    // Get token from header
    // Note: React Native fetch may convert headers to lowercase
    // So we check both 'authorization' and 'Authorization'
    const authHeader = req.headers.authorization || req.headers.Authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        message: 'No token provided'
      });
    }

    const token = authHeader.substring(7); // Remove 'Bearer ' prefix

    // Verify token
    const decoded = jwt.verify(token, config.jwtSecret);

    // Get user
    const user = await User.findById(decoded.userId);
    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'User not found'
      });
    }

    // Single-device policy for Web: Check if the token's webSessionToken matches the database
    if (decoded.webSessionToken && user.web_session_token && decoded.webSessionToken !== user.web_session_token) {
      return res.status(401).json({
        success: false,
        message: 'Sesi Anda telah berakhir karena Anda login dari browser lain. Silakan login kembali.'
      });
    }

    // Attach user to request
    req.user = user;
    req.userId = user.id;

    next();
  } catch (error) {
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({
        success: false,
        message: 'Invalid token'
      });
    }
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({
        success: false,
        message: 'Token expired'
      });
    }
    next(error);
  }
};

// Optional authentication (for endpoints that work with or without auth)
const optionalAuth = async (req, res, next) => {
  try {
    // Note: React Native fetch may convert headers to lowercase
    const authHeader = req.headers.authorization || req.headers.Authorization;

    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.substring(7);
      try {
        const decoded = jwt.verify(token, config.jwtSecret);
        const user = await User.findById(decoded.userId);
        if (user) {
          req.user = user;
          req.userId = user.id;
        }
      } catch (error) {
        // Ignore token errors for optional auth
      }
    }

    next();
  } catch (error) {
    next(error);
  }
};

// Role-based authorization
const authorize = (...roles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: 'Authentication required'
      });
    }

    if (!roles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: 'Insufficient permissions'
      });
    }

    next();
  };
};

// Generate JWT token
const generateToken = (userId, webSessionToken = null) => {
  const payload = { userId };
  if (webSessionToken) {
    payload.webSessionToken = webSessionToken;
  }
  
  return jwt.sign(payload, config.jwtSecret, {
    expiresIn: config.jwtExpire
  });
};

module.exports = {
  authenticate,
  optionalAuth,
  authorize,
  generateToken
};
