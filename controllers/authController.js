const User = require('../models/User');
const { generateToken } = require('../middleware/auth');

// Login
const login = async (req, res, next) => {
  try {
    const { email, password } = req.body;
    
    // Find user
    const user = await User.findByEmail(email);
    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'Email tidak ditemukan. Pastikan email yang Anda masukkan benar.'
      });
    }
    
    // Verify password
    const isValid = await User.verifyPassword(password, user.password_hash);
    if (!isValid) {
      return res.status(401).json({
        success: false,
        message: 'Sandi salah. Silakan periksa kembali sandi Anda.'
      });
    }
    
    // Generate token
    const token = generateToken(user.id);
    
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
    const { email, password, name, role = 'admin' } = req.body;
    
    // Validate
    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Email and password are required'
      });
    }
    
    // Check if email already exists
    const existing = await User.findByEmail(email);
    if (existing) {
      return res.status(409).json({
        success: false,
        message: 'Email already registered'
      });
    }
    
    // Create user
    const user = await User.create({ email, password, name, role });
    
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
    res.json({
      success: true,
      message: 'Logged out successfully'
    });
  } catch (error) {
    next(error);
  }
};

// Get all admin users (for PIC selection) - owner only
// Returns admin users that are in the same team as owner (admin users created by owner through team)
const getAdmins = async (req, res, next) => {
  try {
    // Only owner can get admin users list
    if (req.user.role !== 'owner') {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Only owner can view admin users.'
      });
    }
    
    // Get admin users that are assigned as PIC to owner's branches
    // This ensures we only show admins that belong to this owner's team
    const admins = await User.findAdminsByOwnerTeam(req.userId);
    
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

