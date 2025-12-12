const User = require('../models/User');
const { generateToken } = require('../middleware/auth');
const LogService = require('../services/logService');

// Login
const login = async (req, res, next) => {
  try {
    const { email, password } = req.body;
    
    // Find user
    const user = await User.findByEmail(email);
    if (!user) {
      // Log failed login attempt
      LogService.logSystem({
        level: 'warning',
        category: 'auth',
        message: 'Failed login attempt - email not found',
        context: {
          email: email,
        },
        ipAddress: req.ip,
        userAgent: req.get('user-agent'),
        requestMethod: req.method,
        requestPath: req.path,
      });
      
      return res.status(401).json({
        success: false,
        message: 'Email tidak ditemukan. Pastikan email yang Anda masukkan benar.'
      });
    }
    
    // Verify password
    const isValid = await User.verifyPassword(password, user.password_hash);
    if (!isValid) {
      // Log failed login attempt
      LogService.logSystem({
        level: 'warning',
        category: 'auth',
        message: 'Failed login attempt - invalid password',
        context: {
          email: email,
        },
        ipAddress: req.ip,
        userAgent: req.get('user-agent'),
        requestMethod: req.method,
        requestPath: req.path,
      });
      
      return res.status(401).json({
        success: false,
        message: 'Sandi salah. Silakan periksa kembali sandi Anda.'
      });
    }
    
    // Generate token
    const token = generateToken(user.id);
    
    // Log successful login (no branchId needed for auth logs)
    // Note: Login doesn't have branchId, so we'll log to system_logs instead
    LogService.logSystem({
      level: 'info',
      category: 'auth',
      message: 'User logged in successfully',
      context: {
        user_id: user.id,
        email: user.email,
        role: user.role,
      },
      userId: user.id,
      ipAddress: req.ip,
      userAgent: req.get('user-agent'),
      requestMethod: req.method,
      requestPath: req.path,
    });
    
    // Return user data (without password)
    const { password_hash, status_deleted, deleted_at, ...userData } = user;
    
    res.json({
      success: true,
      data: {
        token,
        user: userData
      }
    });
  } catch (error) {
    next(error);
  }
};

// Get current user
const getMe = async (req, res, next) => {
  try {
    const user = await User.findById(req.userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }
    
    res.json({
      success: true,
      data: { user }
    });
  } catch (error) {
    next(error);
  }
};

// Register
const register = async (req, res, next) => {
  try {
    const { email, password, name, role = 'owner' } = req.body;
    
    // Validate
    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Email and password are required'
      });
    }
    
    // Only allow owner role for self-registration
    // Co-owner, admin, and master must be created by existing owners
    const finalRole = role === 'owner' ? 'owner' : 'owner'; // Force owner for registration
    
    // Check if email already exists
    const existing = await User.findByEmail(email);
    if (existing) {
      return res.status(409).json({
        success: false,
        message: 'Email already registered'
      });
    }
    
    // Create user (always owner for self-registration)
    const user = await User.create({ email, password, name, role: finalRole });
    
    // Generate token
    const token = generateToken(user.id);
    
    // Return user data (without password)
    const { password_hash, status_deleted, deleted_at, ...userData } = user;
    
    res.status(201).json({
      success: true,
      data: {
        token,
        user: userData
      }
    });
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({
        success: false,
        message: 'Email already registered'
      });
    }
    next(error);
  }
};

// Logout (client-side, just return success)
const logout = async (req, res, next) => {
  try {
    // Log logout
    if (req.userId) {
      LogService.logSystem({
        level: 'info',
        category: 'auth',
        message: 'User logged out',
        context: {
          user_id: req.userId,
        },
        userId: req.userId,
        ipAddress: req.ip,
        userAgent: req.get('user-agent'),
        requestMethod: req.method,
        requestPath: req.path,
      });
    }
    
    res.json({
      success: true,
      message: 'Logged out successfully'
    });
  } catch (error) {
    next(error);
  }
};

// Get all admin users (for PIC selection) - owner and co-owner
// Returns admin users that are in the same team as owner (admin users created by owner through team)
const getAdmins = async (req, res, next) => {
  try {
    // Only owner and co-owner can get admin users list
    if (req.user.role !== 'owner' && req.user.role !== 'co-owner') {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Only owner and co-owner can view admin users.'
      });
    }
    
    // For co-owner, get admin users from the owner who created them
    let targetUserId = req.userId;
    if (req.user.role === 'co-owner') {
      const currentUser = await User.findById(req.userId);
      if (currentUser && currentUser.created_by) {
        targetUserId = currentUser.created_by;
      }
    }
    
    // Get admin users that are assigned as PIC to owner's branches
    // This ensures we only show admins that belong to this owner's team
    const admins = await User.findAdminsByOwnerTeam(targetUserId);
    
    res.json({
      success: true,
      data: {
        users: admins
      }
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  login,
  register,
  getMe,
  logout,
  getAdmins
};

