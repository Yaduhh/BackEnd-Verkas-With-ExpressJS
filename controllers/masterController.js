const User = require('../models/User');
const Branch = require('../models/Branch');
const OwnerTeam = require('../models/OwnerTeam');
const Transaction = require('../models/Transaction');
const Category = require('../models/Category');
const Subscription = require('../models/Subscription');
const SubscriptionPlan = require('../models/SubscriptionPlan');
const Payment = require('../models/Payment');
const ActivityLog = require('../models/ActivityLog');
const LogService = require('../services/logService');
const { query } = require('../config/database');

// Helper function untuk memastikan nilai integer yang valid (untuk LIMIT/OFFSET)
// MySQL production lebih ketat dan tidak menerima NaN atau string
const toSafeInt = (value, defaultValue = 0) => {
  if (value === null || value === undefined || value === '') {
    return defaultValue;
  }
  const parsed = parseInt(value, 10);
  if (isNaN(parsed) || parsed < 0) {
    return defaultValue;
  }
  return parsed;
};

// Get overview statistics
const getOverview = async (req, res, next) => {
  try {
    // Get total users by role
    const usersByRole = await query(
      `SELECT role, COUNT(*) as count 
       FROM users 
       WHERE status_deleted = false 
       GROUP BY role`
    );
    
    const userStats = {
      owner: 0,
      'co-owner': 0,
      admin: 0,
      master: 0,
      total: 0
    };
    
    usersByRole.forEach(row => {
      userStats[row.role] = parseInt(row.count);
      userStats.total += parseInt(row.count);
    });
    
    // Get total teams
    const teamsResult = await query('SELECT COUNT(*) as count FROM owner_teams');
    const totalTeams = parseInt(teamsResult[0].count);
    
    // Get total branches
    const branchesResult = await query(
      'SELECT COUNT(*) as count FROM branches WHERE status_deleted = false'
    );
    const totalBranches = parseInt(branchesResult[0].count);
    
    // Get payment/subscription transaction statistics (langganan transactions, not branch transactions)
    const paymentTransactionStats = await query(
      `SELECT 
        COUNT(*) as total,
        SUM(CASE WHEN p.status = 'paid' THEN p.amount ELSE 0 END) as total_income,
        SUM(CASE WHEN p.status = 'pending' THEN p.amount ELSE 0 END) as total_pending,
        SUM(CASE WHEN p.status = 'paid' THEN p.amount ELSE 0 END) as total_amount
       FROM payments p
       LEFT JOIN subscriptions s ON p.subscription_id = s.id
       WHERE s.id IS NOT NULL`
    );
    
    const transactions = {
      total: parseInt(paymentTransactionStats[0].total || 0),
      totalIncome: parseFloat(paymentTransactionStats[0].total_income || 0),
      totalExpense: parseFloat(paymentTransactionStats[0].total_pending || 0),
      balance: parseFloat(paymentTransactionStats[0].total_amount || 0)
    };
    
    // Get payment statistics
    const paymentStats = await query(
      `SELECT 
        COUNT(*) as total,
        SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending,
        SUM(CASE WHEN status = 'paid' THEN 1 ELSE 0 END) as completed,
        SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed,
        SUM(CASE WHEN status = 'paid' THEN amount ELSE 0 END) as total_amount
       FROM payments`
    );
    
    const payments = {
      total: parseInt(paymentStats[0].total || 0),
      pending: parseInt(paymentStats[0].pending || 0),
      completed: parseInt(paymentStats[0].completed || 0),
      failed: parseInt(paymentStats[0].failed || 0),
      totalAmount: parseFloat(paymentStats[0].total_amount || 0)
    };
    
    // Get subscription statistics
    const subscriptionStats = await query(
      `SELECT 
        COUNT(*) as total,
        SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) as active,
        SUM(CASE WHEN status = 'expired' THEN 1 ELSE 0 END) as expired,
        SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END) as cancelled
       FROM subscriptions`
    );
    
    const subscriptions = {
      total: parseInt(subscriptionStats[0].total || 0),
      active: parseInt(subscriptionStats[0].active || 0),
      expired: parseInt(subscriptionStats[0].expired || 0),
      cancelled: parseInt(subscriptionStats[0].cancelled || 0)
    };
    
    // Get recent activity (last 10)
    const recentActivities = await query(
      `SELECT al.*, u.name as user_name, u.email as user_email, b.name as branch_name
       FROM activity_logs al
       LEFT JOIN users u ON al.user_id = u.id
       LEFT JOIN branches b ON al.branch_id = b.id
       ORDER BY al.created_at DESC
       LIMIT 10`
    );
    
    res.json({
      success: true,
      data: {
        users: userStats,
        teams: totalTeams,
        branches: totalBranches,
        transactions,
        payments,
        subscriptions,
        recentActivities
      }
    });
  } catch (error) {
    next(error);
  }
};

// Get all users with filters
const getAllUsers = async (req, res, next) => {
  try {
    const { role, search, page = 1, limit = 50, includeDeleted = false } = req.query;
    
    let sql = 'SELECT id, email, name, role, created_by, created_at, updated_at, status_deleted, deleted_at FROM users WHERE 1=1';
    const params = [];
    
    if (!includeDeleted) {
      sql += ' AND status_deleted = false';
    }
    
    if (role) {
      sql += ' AND role = ?';
      params.push(role);
    }
    
    if (search) {
      sql += ' AND (email LIKE ? OR name LIKE ?)';
      params.push(`%${search}%`, `%${search}%`);
    }
    
    // Get total count
    const countSql = sql.replace('SELECT id, email, name, role, created_by, created_at, updated_at, status_deleted, deleted_at', 'SELECT COUNT(*) as count');
    const countResult = await query(countSql, params);
    const total = toSafeInt(countResult[0]?.count, 0);
    
    // Add pagination - ensure integer values for MySQL
    const pageNum = toSafeInt(page, 1);
    const limitNum = toSafeInt(limit, 50);
    const offsetNum = (pageNum - 1) * limitNum;
    sql += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
    params.push(limitNum, offsetNum);
    
    const users = await query(sql, params);
    
    // Get creator names for users with created_by
    const creatorIds = [...new Set(users.filter(u => u.created_by).map(u => u.created_by))];
    let creators = {};
    if (creatorIds.length > 0) {
      const creatorResults = await query(
        `SELECT id, name, email FROM users WHERE id IN (${creatorIds.map(() => '?').join(',')})`,
        creatorIds
      );
      creatorResults.forEach(c => {
        creators[c.id] = c;
      });
    }
    
    // Attach creator info
    const usersWithCreator = users.map(user => ({
      ...user,
      creator: user.created_by ? creators[user.created_by] : null
    }));
    
      res.json({
        success: true,
        data: {
          users: usersWithCreator,
          total,
          page: pageNum,
          limit: limitNum
        }
      });
  } catch (error) {
    next(error);
  }
};

// Create user (master only)
const createUser = async (req, res, next) => {
  try {
    const { email, password, name, role } = req.body;
    
    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Email and password are required'
      });
    }
    
    if (password.length < 6) {
      return res.status(400).json({
        success: false,
        message: 'Password must be at least 6 characters'
      });
    }
    
    const validRoles = ['owner', 'co-owner', 'admin', 'master'];
    if (role && !validRoles.includes(role)) {
      return res.status(400).json({
        success: false,
        message: `Role must be one of: ${validRoles.join(', ')}`
      });
    }
    
    // Check if email exists
    const existing = await User.findByEmail(email);
    if (existing) {
      return res.status(409).json({
        success: false,
        message: 'Email already registered'
      });
    }
    
    const newUser = await User.create({
      email,
      password,
      name: name || null,
      role: role || 'admin',
      createdBy: req.userId
    });
    
    res.status(201).json({
      success: true,
      message: 'User created successfully',
      data: { user: newUser }
    });
  } catch (error) {
    next(error);
  }
};

// Update user
const updateUser = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { name, email, role } = req.body;
    
    const user = await User.findById(id);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }
    
    // Validate role if provided
    if (role) {
      const validRoles = ['owner', 'co-owner', 'admin', 'master'];
      if (!validRoles.includes(role)) {
        return res.status(400).json({
          success: false,
          message: `Role must be one of: ${validRoles.join(', ')}`
        });
      }
    }
    
    // Check email uniqueness if email is being changed
    if (email && email !== user.email) {
      const existing = await User.findByEmail(email);
      if (existing) {
        return res.status(409).json({
          success: false,
          message: 'Email already registered'
        });
      }
    }
    
    const updatedUser = await User.update(id, { name, email, role });
    
    res.json({
      success: true,
      message: 'User updated successfully',
      data: { user: updatedUser }
    });
  } catch (error) {
    next(error);
  }
};

// Delete user (soft delete)
const deleteUser = async (req, res, next) => {
  try {
    const { id } = req.params;
    
    const user = await User.findById(id);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }
    
    // Prevent deleting yourself
    if (parseInt(id) === req.userId) {
      return res.status(400).json({
        success: false,
        message: 'Cannot delete your own account'
      });
    }
    
    await User.softDelete(id);
    
    res.json({
      success: true,
      message: 'User deleted successfully'
    });
  } catch (error) {
    next(error);
  }
};

// Reset user password
const resetUserPassword = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { newPassword } = req.body;
    
    if (!newPassword || newPassword.length < 6) {
      return res.status(400).json({
        success: false,
        message: 'New password must be at least 6 characters'
      });
    }
    
    const user = await User.findById(id);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }
    
    await User.changePassword(id, newPassword);
    
    res.json({
      success: true,
      message: 'Password reset successfully'
    });
  } catch (error) {
    next(error);
  }
};

// Get all teams (simplified for list view)
const getAllTeams = async (req, res, next) => {
  try {
    const { search, page = 1, limit = 50 } = req.query;
    
    // Build base WHERE clause
    let whereClause = 'WHERE 1=1';
    const params = [];
    
    if (search) {
      whereClause += ' AND (t.name LIKE ? OR u.name LIKE ? OR u.email LIKE ?)';
      params.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }
    
    // Count query
    const countSql = `SELECT COUNT(*) as count
                      FROM owner_teams t
                      LEFT JOIN users u ON t.primary_owner_id = u.id
                      ${whereClause}`;
    const countResult = await query(countSql, params);
    const total = toSafeInt(countResult[0]?.count, 0);
    
    // Main query (simplified - just basic info)
    // Ensure integer values for MySQL
    const pageNum = toSafeInt(page, 1);
    const limitNum = toSafeInt(limit, 50);
    const offsetNum = (pageNum - 1) * limitNum;
    
    let sql = `SELECT t.*, u.name as primary_owner_name, u.email as primary_owner_email,
               (SELECT COUNT(*) FROM owner_team_members WHERE team_id = t.id AND status = 'active') as member_count,
               (SELECT COUNT(*) FROM branches WHERE team_id = t.id AND status_deleted = false) as branch_count
               FROM owner_teams t
               LEFT JOIN users u ON t.primary_owner_id = u.id
               ${whereClause}
               ORDER BY t.created_at DESC LIMIT ? OFFSET ?`;
    
    const queryParams = [...params, limitNum, offsetNum];
    const teams = await query(sql, queryParams);
    
    res.json({
      success: true,
      data: {
        teams,
        total,
        page: pageNum,
        limit: limitNum
      }
    });
  } catch (error) {
    next(error);
  }
};

// Get team detail with all information
const getTeamDetail = async (req, res, next) => {
  try {
    const { id } = req.params;
    
    // Get team basic info
    const team = await OwnerTeam.findById(toSafeInt(id));
    if (!team) {
      return res.status(404).json({
        success: false,
        message: 'Team not found'
      });
    }
    
    // Get members
    const members = await OwnerTeam.getMembers(team.id);
    
    // Get active subscription for primary owner
    const Subscription = require('../models/Subscription');
    const activeSubscription = await Subscription.getActiveSubscription(team.primary_owner_id);
    
    // Get all subscriptions for primary owner (history)
    const allSubscriptions = await Subscription.findByUserId(team.primary_owner_id);
    
    // Get branches for this team
    const Branch = require('../models/Branch');
    const branches = await query(
      `SELECT b.*, u.name as owner_name, u.email as owner_email
       FROM branches b
       LEFT JOIN users u ON b.owner_id = u.id
       WHERE b.team_id = ? AND b.status_deleted = false
       ORDER BY b.created_at DESC`,
      [team.id]
    );
    
    // Get branches by owner (for teams without team_id, use owner_id)
    const branchesByOwner = await Branch.findByOwner(team.primary_owner_id, { includeDeleted: false });
    
    // Combine branches (team branches + owner branches)
    const allBranches = [...branches, ...branchesByOwner.filter(b => !branches.find(tb => tb.id === b.id))];
    const branchIds = allBranches.map(b => b.id);
    
    // Get payments (service transactions) for primary owner
    const Payment = require('../models/Payment');
    const allPayments = await query(
      `SELECT p.*, s.plan_id, s.billing_period, sp.name as plan_name
       FROM payments p
       JOIN subscriptions s ON p.subscription_id = s.id
       LEFT JOIN subscription_plans sp ON s.plan_id = sp.id
       WHERE s.user_id = ?
       ORDER BY p.created_at DESC`,
      [team.primary_owner_id]
    );
    
    // Get payment statistics (service transactions)
    const paymentStatsResult = await query(
      `SELECT 
        COUNT(*) as total,
        COALESCE(SUM(CASE WHEN p.status = 'pending' THEN 1 ELSE 0 END), 0) as pending,
        COALESCE(SUM(CASE WHEN p.status = 'paid' THEN 1 ELSE 0 END), 0) as completed,
        COALESCE(SUM(CASE WHEN p.status = 'failed' THEN 1 ELSE 0 END), 0) as failed,
        COALESCE(SUM(CASE WHEN p.status = 'paid' THEN p.amount ELSE 0 END), 0) as total_amount
       FROM payments p
       JOIN subscriptions s ON p.subscription_id = s.id
       WHERE s.user_id = ?`,
      [team.primary_owner_id]
    );
    
    const paymentStats = {
      total: parseInt(paymentStatsResult[0]?.total || 0),
      pending: parseInt(paymentStatsResult[0]?.pending || 0),
      completed: parseInt(paymentStatsResult[0]?.completed || 0),
      failed: parseInt(paymentStatsResult[0]?.failed || 0),
      totalAmount: parseFloat(paymentStatsResult[0]?.total_amount || 0)
    };
    
    res.json({
      success: true,
      data: {
        team: {
          ...team,
          members: members || [],
          activeSubscription: activeSubscription || null,
          subscriptions: allSubscriptions || [],
          branches: allBranches || [],
          totalBranches: allBranches.length,
          payments: allPayments || [],
          paymentStats
        }
      }
    });
  } catch (error) {
    next(error);
  }
};

// Get all branches
const getAllBranches = async (req, res, next) => {
  try {
    const { search, owner_id, team_id, page = 1, limit = 50, includeDeleted } = req.query;
    
    // Parse includeDeleted as boolean (query params are strings)
    const includeDeletedBool = includeDeleted === 'true' || includeDeleted === true;
    
    let sql = `SELECT b.*, u.name as owner_name, u.email as owner_email,
               (SELECT COUNT(*) FROM transactions WHERE branch_id = b.id AND status_deleted = false) as transaction_count
               FROM branches b
               LEFT JOIN users u ON b.owner_id = u.id
               WHERE 1=1`;
    const params = [];
    
    // Always filter by status_deleted = false for master (only show active branches)
    sql += ' AND b.status_deleted = false';
    
    if (owner_id) {
      sql += ' AND b.owner_id = ?';
      params.push(parseInt(owner_id));
    }
    
    if (team_id) {
      sql += ' AND b.team_id = ?';
      params.push(parseInt(team_id));
    }
    
    // Only apply search filter if search is provided and not empty/undefined
    if (search && search !== 'undefined' && search.trim() !== '') {
      sql += ' AND (b.name LIKE ? OR b.address LIKE ? OR u.name LIKE ?)';
      params.push(`%${search.trim()}%`, `%${search.trim()}%`, `%${search.trim()}%`);
    }
    
    // Build count query separately (without subquery)
    let countSql = `SELECT COUNT(*) as count
                    FROM branches b
                    LEFT JOIN users u ON b.owner_id = u.id
                    WHERE 1=1`;
    const countParams = [];
    
    // Always filter by status_deleted = false for master (only show active branches)
    countSql += ' AND b.status_deleted = false';
    
    if (owner_id) {
      countSql += ' AND b.owner_id = ?';
      countParams.push(toSafeInt(owner_id));
    }
    
    if (team_id) {
      countSql += ' AND b.team_id = ?';
      countParams.push(toSafeInt(team_id));
    }
    
    // Only apply search filter if search is provided and not empty/undefined
    if (search && search !== 'undefined' && search.trim() !== '') {
      countSql += ' AND (b.name LIKE ? OR b.address LIKE ? OR u.name LIKE ?)';
      countParams.push(`%${search.trim()}%`, `%${search.trim()}%`, `%${search.trim()}%`);
    }
    
    const countResult = await query(countSql, countParams);
    const total = toSafeInt(countResult[0]?.count, 0);
    
    // Ensure integer values for MySQL
    const pageNum = toSafeInt(page, 1);
    const limitNum = toSafeInt(limit, 50);
    const offsetNum = (pageNum - 1) * limitNum;
    sql += ' ORDER BY b.created_at DESC LIMIT ? OFFSET ?';
    params.push(limitNum, offsetNum);
    
    const branches = await query(sql, params);
    
    res.json({
      success: true,
      data: {
        branches,
        total,
        page: pageNum,
        limit: limitNum
      }
    });
  } catch (error) {
    next(error);
  }
};

// Get all transactions (master can see all, no branch filter required)
const getAllTransactions = async (req, res, next) => {
  try {
    const { 
      branch_id, 
      user_id, 
      type, 
      category, 
      start_date, 
      end_date, 
      search,
      page = 1, 
      limit = 50,
      includeDeleted = false 
    } = req.query;
    
    // Build custom query for master (no branch restriction)
    let sql = `
      SELECT t.*, c.name as category_name, c.type as category_type,
             b.name as branch_name, u.name as user_name, u.email as user_email
      FROM transactions t
      JOIN categories c ON t.category_id = c.id
      LEFT JOIN branches b ON t.branch_id = b.id
      LEFT JOIN users u ON t.user_id = u.id
      WHERE 1=1
    `;
    const params = [];
    
    if (branch_id) {
      sql += ' AND t.branch_id = ?';
      params.push(parseInt(branch_id));
    }
    
    if (user_id) {
      sql += ' AND t.user_id = ?';
      params.push(parseInt(user_id));
    }
    
    if (!includeDeleted || includeDeleted !== 'true') {
      sql += ' AND t.status_deleted = false';
    }
    
    if (type) {
      sql += ' AND t.type = ?';
      params.push(type);
    }
    
    if (category) {
      sql += ' AND c.name = ?';
      params.push(category);
    }
    
    if (start_date) {
      sql += ' AND DATE(t.transaction_date) >= ?';
      params.push(start_date);
    }
    
    if (end_date) {
      sql += ' AND DATE(t.transaction_date) <= ?';
      params.push(end_date);
    }
    
    if (search) {
      sql += ' AND (t.note LIKE ? OR c.name LIKE ? OR b.name LIKE ?)';
      params.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }
    
    // Build count query separately (without SELECT fields and JOINs)
    let countSql = `
      SELECT COUNT(*) as count
      FROM transactions t
      JOIN categories c ON t.category_id = c.id
      LEFT JOIN branches b ON t.branch_id = b.id
      LEFT JOIN users u ON t.user_id = u.id
      WHERE 1=1
    `;
    const countParams = [];
    
    if (branch_id) {
      countSql += ' AND t.branch_id = ?';
      countParams.push(toSafeInt(branch_id));
    }
    
    if (user_id) {
      countSql += ' AND t.user_id = ?';
      countParams.push(toSafeInt(user_id));
    }
    
    if (!includeDeleted || includeDeleted !== 'true') {
      countSql += ' AND t.status_deleted = false';
    }
    
    if (type) {
      countSql += ' AND t.type = ?';
      countParams.push(type);
    }
    
    if (category) {
      countSql += ' AND c.name = ?';
      countParams.push(category);
    }
    
    if (start_date) {
      countSql += ' AND DATE(t.transaction_date) >= ?';
      countParams.push(start_date);
    }
    
    if (end_date) {
      countSql += ' AND DATE(t.transaction_date) <= ?';
      countParams.push(end_date);
    }
    
    if (search) {
      countSql += ' AND (t.note LIKE ? OR c.name LIKE ? OR b.name LIKE ?)';
      countParams.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }
    
    const countResult = await query(countSql, countParams);
    const total = toSafeInt(countResult[0]?.count, 0);
    
    // Add pagination - ensure integer values for MySQL
    const pageNum = toSafeInt(page, 1);
    const limitNum = toSafeInt(limit, 50);
    const offsetNum = (pageNum - 1) * limitNum;
    sql += ' ORDER BY t.transaction_date DESC, t.created_at DESC LIMIT ? OFFSET ?';
    params.push(limitNum, offsetNum);
    
    const transactions = await query(sql, params);
    
    res.json({
      success: true,
      data: {
        transactions,
        total,
        page: pageNum,
        limit: limitNum
      }
    });
  } catch (error) {
    next(error);
  }
};

// Get all categories
const getAllCategories = async (req, res, next) => {
  try {
    const { type, search, page = 1, limit = 50, includeDeleted = false } = req.query;
    
    let sql = `SELECT c.*, 
                      u.name as user_name, u.email as user_email,
                      b.name as branch_name, b.address as branch_address
               FROM categories c
               LEFT JOIN users u ON c.user_id = u.id
               LEFT JOIN branches b ON c.branch_id = b.id
               WHERE 1=1`;
    const params = [];
    
    // For master, only filter deleted if explicitly requested to exclude them
    // By default, show all categories (including deleted ones)
    if (includeDeleted === 'false') {
      sql += ' AND (c.status_deleted = false OR c.status_deleted IS NULL)';
    }
    // If includeDeleted is 'true' or not provided, show all (no filter)
    
    if (type && type !== 'undefined' && type !== '') {
      sql += ' AND c.type = ?';
      params.push(type);
    }
    
    if (search && search !== 'undefined' && search !== '') {
      sql += ' AND (c.name LIKE ? OR u.name LIKE ? OR b.name LIKE ?)';
      params.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }
    
    // Build count query separately
    let countSql = `SELECT COUNT(*) as count
                    FROM categories c
                    LEFT JOIN users u ON c.user_id = u.id
                    LEFT JOIN branches b ON c.branch_id = b.id
                    WHERE 1=1`;
    const countParams = [];
    
    // For master, only filter deleted if explicitly requested
    if (includeDeleted === 'false') {
      countSql += ' AND (c.status_deleted = false OR c.status_deleted IS NULL)';
    }
    
    if (type && type !== 'undefined' && type !== '') {
      countSql += ' AND c.type = ?';
      countParams.push(type);
    }
    
    if (search && search !== 'undefined' && search !== '') {
      countSql += ' AND (c.name LIKE ? OR u.name LIKE ? OR b.name LIKE ?)';
      countParams.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }
    
    const countResult = await query(countSql, countParams);
    const total = toSafeInt(countResult[0]?.count, 0);
    
    // Ensure integer values for MySQL
    const pageNum = toSafeInt(page, 1);
    const limitNum = toSafeInt(limit, 50);
    const offsetNum = (pageNum - 1) * limitNum;
    sql += ' ORDER BY c.type ASC, c.name ASC LIMIT ? OFFSET ?';
    params.push(limitNum, offsetNum);
    
    const categories = await query(sql, params);
    
    res.json({
      success: true,
      data: {
        categories,
        total,
        page: pageNum,
        limit: limitNum
      }
    });
  } catch (error) {
    next(error);
  }
};

// Get all activity logs
const getAllActivityLogs = async (req, res, next) => {
  try {
    const {
      user_id,
      branch_id,
      action,
      entity_type,
      start_date,
      end_date,
      page = 1,
      limit = 50,
    } = req.query;
    
    // Ensure integer values for MySQL
    const pageNum = toSafeInt(page, 1);
    const limitNum = toSafeInt(limit, 50);
    
    const logs = await LogService.getActivityLogs({
      userId: user_id ? toSafeInt(user_id) : null,
      branchId: branch_id ? toSafeInt(branch_id) : null,
      action,
      entityType: entity_type,
      startDate: start_date,
      endDate: end_date,
      page: pageNum,
      limit: limitNum,
    });
    
    const total = await ActivityLog.count({
      userId: user_id ? toSafeInt(user_id) : null,
      branchId: branch_id ? toSafeInt(branch_id) : null,
      action,
      entityType: entity_type,
      startDate: start_date,
      endDate: end_date,
    });
    
    res.json({
      success: true,
      data: {
        logs,
        total,
        page: pageNum,
        limit: limitNum,
      },
    });
  } catch (error) {
    next(error);
  }
};

// Get all system logs
const getAllSystemLogs = async (req, res, next) => {
  try {
    const {
      level,
      category,
      start_date,
      end_date,
      page = 1,
      limit = 50,
    } = req.query;
    
    // Ensure integer values for MySQL
    const pageNum = toSafeInt(page, 1);
    const limitNum = toSafeInt(limit, 50);
    
    const logs = await LogService.getSystemLogs({
      level,
      category,
      startDate: start_date,
      endDate: end_date,
      page: pageNum,
      limit: limitNum,
    });
    
    // Count system logs
    let countSql = 'SELECT COUNT(*) as count FROM system_logs WHERE 1=1';
    const countParams = [];
    
    if (level) {
      countSql += ' AND level = ?';
      countParams.push(level);
    }
    if (category) {
      countSql += ' AND category = ?';
      countParams.push(category);
    }
    if (start_date) {
      countSql += ' AND created_at >= ?';
      countParams.push(start_date);
    }
    if (end_date) {
      countSql += ' AND created_at <= ?';
      countParams.push(end_date);
    }
    
    const countResult = await query(countSql, countParams);
    const total = toSafeInt(countResult[0]?.count, 0);
    
    res.json({
      success: true,
      data: {
        logs,
        total,
        page: pageNum,
        limit: limitNum,
      },
    });
  } catch (error) {
    next(error);
  }
};

// Get all payments
const getAllPayments = async (req, res, next) => {
  try {
    const { status, user_id, month, year, page = 1, limit = 50 } = req.query;
    
    let sql = `SELECT p.*, u.name as user_name, u.email as user_email, 
                      s.plan_id, s.billing_period, sp.name as plan_name
               FROM payments p
               LEFT JOIN subscriptions s ON p.subscription_id = s.id
               LEFT JOIN users u ON s.user_id = u.id
               LEFT JOIN subscription_plans sp ON s.plan_id = sp.id
               WHERE 1=1`;
    const params = [];
    
    // Default: only show paid payments
    if (status && status !== 'undefined' && status !== '') {
      sql += ' AND p.status = ?';
      params.push(status);
    } else {
      sql += ' AND p.status = ?';
      params.push('paid');
    }
    
    // Filter by month and year (based on paid_at date)
    if (month && month !== 'undefined' && month !== '') {
      sql += ' AND MONTH(p.paid_at) = ?';
      params.push(toSafeInt(month));
    }
    
    if (year && year !== 'undefined' && year !== '') {
      sql += ' AND YEAR(p.paid_at) = ?';
      params.push(toSafeInt(year));
    }
    
    if (user_id) {
      sql += ' AND s.user_id = ?';
      params.push(toSafeInt(user_id));
    }
    
    // Build count query separately
    let countSql = `SELECT COUNT(*) as count
                    FROM payments p
                    LEFT JOIN subscriptions s ON p.subscription_id = s.id
                    WHERE 1=1`;
    const countParams = [];
    
    // Default: only show paid payments
    if (status && status !== 'undefined' && status !== '') {
      countSql += ' AND p.status = ?';
      countParams.push(status);
    } else {
      countSql += ' AND p.status = ?';
      countParams.push('paid');
    }
    
    // Filter by month and year
    if (month && month !== 'undefined' && month !== '') {
      countSql += ' AND MONTH(p.paid_at) = ?';
      countParams.push(toSafeInt(month));
    }
    
    if (year && year !== 'undefined' && year !== '') {
      countSql += ' AND YEAR(p.paid_at) = ?';
      countParams.push(toSafeInt(year));
    }
    
    if (user_id) {
      countSql += ' AND s.user_id = ?';
      countParams.push(toSafeInt(user_id));
    }
    
    const countResult = await query(countSql, countParams);
    const total = toSafeInt(countResult[0]?.count, 0);
    
    // Calculate total amount for all paid payments matching filters
    let totalAmountSql = `SELECT COALESCE(SUM(p.amount), 0) as total_amount
                          FROM payments p
                          LEFT JOIN subscriptions s ON p.subscription_id = s.id
                          WHERE 1=1`;
    const totalAmountParams = [];
    
    // Default: only show paid payments
    if (status && status !== 'undefined' && status !== '') {
      totalAmountSql += ' AND p.status = ?';
      totalAmountParams.push(status);
    } else {
      totalAmountSql += ' AND p.status = ?';
      totalAmountParams.push('paid');
    }
    
    // Filter by month and year
    if (month && month !== 'undefined' && month !== '') {
      totalAmountSql += ' AND MONTH(p.paid_at) = ?';
      totalAmountParams.push(toSafeInt(month));
    }
    
    if (year && year !== 'undefined' && year !== '') {
      totalAmountSql += ' AND YEAR(p.paid_at) = ?';
      totalAmountParams.push(toSafeInt(year));
    }
    
    if (user_id) {
      totalAmountSql += ' AND s.user_id = ?';
      totalAmountParams.push(toSafeInt(user_id));
    }
    
    const totalAmountResult = await query(totalAmountSql, totalAmountParams);
    const totalAmount = parseFloat(totalAmountResult[0]?.total_amount || 0);
    
    // Ensure integer values for MySQL
    const pageNum = toSafeInt(page, 1);
    const limitNum = toSafeInt(limit, 50);
    const offsetNum = (pageNum - 1) * limitNum;
    sql += ' ORDER BY p.paid_at DESC, p.created_at DESC LIMIT ? OFFSET ?';
    params.push(limitNum, offsetNum);
    
    const payments = await query(sql, params);
    
    res.json({
      success: true,
      data: {
        payments,
        total,
        totalAmount,
        page: pageNum,
        limit: limitNum
      }
    });
  } catch (error) {
    next(error);
  }
};

// Get all subscriptions
const getAllSubscriptions = async (req, res, next) => {
  try {
    const { status, user_id, page = 1, limit = 50 } = req.query;
    
    let sql = `SELECT s.*, 
                      u.name as user_name, u.email as user_email, 
                      p.name as plan_name, p.description as plan_description,
                      p.price_monthly, p.price_yearly,
                      CASE 
                        WHEN s.billing_period = 'monthly' THEN p.price_monthly
                        WHEN s.billing_period = 'yearly' THEN p.price_yearly
                        ELSE NULL
                      END as plan_price
               FROM subscriptions s
               LEFT JOIN users u ON s.user_id = u.id
               LEFT JOIN subscription_plans p ON s.plan_id = p.id
               WHERE 1=1`;
    const params = [];
    
    // Default: exclude pending subscriptions, only show active and expired
    // Only filter by specific status if provided
    if (status && status !== 'undefined' && status !== '') {
      sql += ' AND s.status = ?';
      params.push(status);
    } else {
      // Default filter: only active and expired (exclude pending and cancelled)
      sql += ' AND s.status IN (?, ?)';
      params.push('active', 'expired');
    }
    
    if (user_id) {
      sql += ' AND s.user_id = ?';
      params.push(toSafeInt(user_id));
    }
    
    // Build count query separately
    let countSql = `SELECT COUNT(*) as count
                    FROM subscriptions s
                    LEFT JOIN users u ON s.user_id = u.id
                    LEFT JOIN subscription_plans p ON s.plan_id = p.id
                    WHERE 1=1`;
    const countParams = [];
    
    // Default: exclude pending subscriptions, only show active and expired
    // Only filter by specific status if provided
    if (status && status !== 'undefined' && status !== '') {
      countSql += ' AND s.status = ?';
      countParams.push(status);
    } else {
      // Default filter: only active and expired (exclude pending and cancelled)
      countSql += ' AND s.status IN (?, ?)';
      countParams.push('active', 'expired');
    }
    
    if (user_id) {
      countSql += ' AND s.user_id = ?';
      countParams.push(parseInt(user_id));
    }
    
    const countResult = await query(countSql, countParams);
    const total = toSafeInt(countResult[0]?.count, 0);
    
    // Ensure integer values for MySQL
    const pageNum = toSafeInt(page, 1);
    const limitNum = toSafeInt(limit, 50);
    const offsetNum = (pageNum - 1) * limitNum;
    sql += ' ORDER BY s.created_at DESC LIMIT ? OFFSET ?';
    params.push(limitNum, offsetNum);
    
    const subscriptions = await query(sql, params);
    
    res.json({
      success: true,
      data: {
        subscriptions,
        total,
        page: pageNum,
        limit: limitNum
      }
    });
  } catch (error) {
    next(error);
  }
};

// Plans/Packages management
const getAllPlans = async (req, res, next) => {
  try {
    const { is_active, page = 1, limit = 50 } = req.query;
    
    let sql = 'SELECT * FROM subscription_plans WHERE 1=1';
    const params = [];
    
    if (is_active !== undefined) {
      sql += ' AND is_active = ?';
      params.push(is_active === 'true' || is_active === true);
    }
    
    // Get total count
    const countSql = sql.replace('SELECT *', 'SELECT COUNT(*) as total');
    const countResult = await query(countSql, params);
    const total = toSafeInt(countResult[0]?.total, 0);
    
    // Ensure integer values for MySQL
    const pageNum = toSafeInt(page, 1);
    const limitNum = toSafeInt(limit, 50);
    const offsetNum = (pageNum - 1) * limitNum;
    sql += ' ORDER BY price_monthly ASC, name ASC LIMIT ? OFFSET ?';
    params.push(limitNum, offsetNum);
    
    const plans = await query(sql, params);
    
    // Parse features if it's a string
    const parsedPlans = plans.map(plan => {
      if (plan && typeof plan.features === 'string') {
        try {
          plan.features = JSON.parse(plan.features);
        } catch (e) {
          // Keep as string if parsing fails
        }
      }
      return plan;
    });
    
    res.json({
      success: true,
      data: {
        plans: parsedPlans,
        total,
        page: pageNum,
        limit: limitNum
      }
    });
  } catch (error) {
    next(error);
  }
};

const createPlan = async (req, res, next) => {
  try {
    const { name, description, max_branches, price_monthly, price_yearly, features, is_active } = req.body;
    
    if (!name || !name.trim()) {
      return res.status(400).json({
        success: false,
        message: 'Name is required'
      });
    }
    
    const plan = await SubscriptionPlan.create({
      name: name.trim(),
      description: description?.trim() || null,
      maxBranches: max_branches ? parseInt(max_branches) : null,
      priceMonthly: price_monthly ? parseFloat(price_monthly) : null,
      priceYearly: price_yearly ? parseFloat(price_yearly) : null,
      features: features || []
    });
    
    // Update is_active if provided
    if (is_active !== undefined) {
      await SubscriptionPlan.update(plan.id, { isActive: is_active });
      plan.is_active = is_active;
    }
    
    // Parse features if it's a string
    if (plan && typeof plan.features === 'string') {
      try {
        plan.features = JSON.parse(plan.features);
      } catch (e) {
        // Keep as string if parsing fails
      }
    }
    
    res.json({
      success: true,
      data: { plan }
    });
  } catch (error) {
    next(error);
  }
};

const updatePlan = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { name, description, max_branches, price_monthly, price_yearly, features, is_active } = req.body;
    
    const plan = await SubscriptionPlan.findById(toSafeInt(id), true); // Include inactive
    if (!plan) {
      return res.status(404).json({
        success: false,
        message: 'Plan not found'
      });
    }
    
    const updateData = {};
    if (name !== undefined) updateData.name = name.trim();
    if (description !== undefined) updateData.description = description?.trim() || null;
    if (max_branches !== undefined) updateData.maxBranches = max_branches ? parseInt(max_branches) : null;
    if (price_monthly !== undefined) updateData.priceMonthly = price_monthly ? parseFloat(price_monthly) : null;
    if (price_yearly !== undefined) updateData.priceYearly = price_yearly ? parseFloat(price_yearly) : null;
    if (features !== undefined) updateData.features = features || [];
    if (is_active !== undefined) updateData.isActive = is_active;
    
    const updatedPlan = await SubscriptionPlan.update(toSafeInt(id), updateData);
    
    // Parse features if it's a string
    if (updatedPlan && typeof updatedPlan.features === 'string') {
      try {
        updatedPlan.features = JSON.parse(updatedPlan.features);
      } catch (e) {
        // Keep as string if parsing fails
      }
    }
    
    res.json({
      success: true,
      data: { plan: updatedPlan }
    });
  } catch (error) {
    next(error);
  }
};

const deletePlan = async (req, res, next) => {
  try {
    const { id } = req.params;
    
    const plan = await SubscriptionPlan.findById(toSafeInt(id), true); // Include inactive
    if (!plan) {
      return res.status(404).json({
        success: false,
        message: 'Plan not found'
      });
    }
    
    // Soft delete by setting is_active to false
    await SubscriptionPlan.update(toSafeInt(id), { isActive: false });
    
    res.json({
      success: true,
      message: 'Plan deleted successfully'
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getOverview,
  getAllUsers,
  createUser,
  updateUser,
  deleteUser,
  resetUserPassword,
  getAllTeams,
  getTeamDetail,
  getAllBranches,
  getAllTransactions,
  getAllCategories,
  getAllActivityLogs,
  getAllSystemLogs,
  getAllPayments,
  getAllSubscriptions,
  getAllPlans,
  createPlan,
  updatePlan,
  deletePlan
};
