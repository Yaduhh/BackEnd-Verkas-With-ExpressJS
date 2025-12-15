const LogService = require('../services/logService');
const ActivityLog = require('../models/ActivityLog');
const Branch = require('../models/Branch');

/**
 * Get activity logs
 * Owner: bisa lihat log di semua branch mereka
 * Admin: hanya bisa lihat log di branch yang mereka assign
 */
const getActivityLogs = async (req, res, next) => {
  try {
    const {
      branch_id,
      user_id,
      action,
      entity_type,
      entity_id,
      start_date,
      end_date,
      page = 1,
      limit = 50,
    } = req.query;

    const userRole = req.user.role;
    const userId = req.userId;
    const branchId = req.branchId || branch_id;

    let logs = [];
    let total = 0;

    if (userRole === 'owner' || userRole === 'co-owner') {
      // Owner and co-owner: get all branches they have access to
      const accessibleBranches = await Branch.findByUserAccess(userId, userRole);
      const branchIds = accessibleBranches.map(b => b.id);

      if (branchIds.length === 0) {
        return res.json({
          success: true,
          data: {
            logs: [],
            total: 0,
            page: parseInt(page),
            limit: parseInt(limit),
          },
        });
      }

      // Filter by specific branch if provided
      // Ensure branchIds is always an array
      const filterBranchIds = branch_id 
        ? [parseInt(branch_id)].filter(id => !isNaN(id) && id > 0)
        : (Array.isArray(branchIds) ? branchIds.map(id => parseInt(id)).filter(id => !isNaN(id) && id > 0) : []);

      logs = await LogService.getActivityLogs({
        userRole: 'owner',
        branchIds: filterBranchIds,
        userId: user_id ? parseInt(user_id) : null,
        action,
        entityType: entity_type,
        entityId: entity_id ? parseInt(entity_id) : null,
        startDate: start_date,
        endDate: end_date,
        page: parseInt(page),
        limit: parseInt(limit),
      });

      total = await ActivityLog.count({
        userRole: 'owner',
        branchIds: filterBranchIds,
        userId: user_id ? parseInt(user_id) : null,
        action,
        entityType: entity_type,
        entityId: entity_id ? parseInt(entity_id) : null,
        startDate: start_date,
        endDate: end_date,
      });
    } else if (userRole === 'admin') {
      // Admin: hanya bisa lihat log di branch yang mereka assign
      if (!branchId) {
        return res.status(400).json({
          success: false,
          message: 'Branch ID is required for admin',
        });
      }

      // Verify admin has access to this branch
      const hasAccess = await Branch.userHasAccess(userId, branchId, userRole);
      if (!hasAccess) {
        return res.status(403).json({
          success: false,
          message: 'Access denied to this branch',
        });
      }

      logs = await LogService.getActivityLogs({
        userRole: 'admin',
        branchId: parseInt(branchId),
        userId: user_id ? parseInt(user_id) : null,
        action,
        entityType: entity_type,
        entityId: entity_id ? parseInt(entity_id) : null,
        startDate: start_date,
        endDate: end_date,
        page: parseInt(page),
        limit: parseInt(limit),
      });

      total = await ActivityLog.count({
        userRole: 'admin',
        branchId: parseInt(branchId),
        userId: user_id ? parseInt(user_id) : null,
        action,
        entityType: entity_type,
        entityId: entity_id ? parseInt(entity_id) : null,
        startDate: start_date,
        endDate: end_date,
      });
    } else {
      return res.status(403).json({
        success: false,
        message: 'Access denied',
      });
    }

    res.json({
      success: true,
      data: {
        logs,
        total,
        page: parseInt(page),
        limit: parseInt(limit),
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Get activity logs for specific branch (Owner and co-owner only)
 */
const getBranchActivityLogs = async (req, res, next) => {
  try {
    const { branchId } = req.params;
    const {
      user_id,
      action,
      entity_type,
      start_date,
      end_date,
      page = 1,
      limit = 50,
    } = req.query;

    const userRole = req.user.role;
    const userId = req.userId;

    if (userRole !== 'owner' && userRole !== 'co-owner') {
      return res.status(403).json({
        success: false,
        message: 'Only owner and co-owner can access branch logs',
      });
    }

    // Verify user has access to this branch
    const branch = await Branch.findById(parseInt(branchId));
    if (!branch) {
      return res.status(404).json({
        success: false,
        message: 'Branch not found',
      });
    }

    const hasAccess = await Branch.userHasAccess(userId, parseInt(branchId), userRole);
    if (!hasAccess) {
      return res.status(403).json({
        success: false,
        message: 'Access denied to this branch',
      });
    }

    const logs = await LogService.getActivityLogs({
      userRole: 'owner',
      branchIds: [parseInt(branchId)],
      userId: user_id ? parseInt(user_id) : null,
      action,
      entityType: entity_type,
      startDate: start_date,
      endDate: end_date,
      page: parseInt(page),
      limit: parseInt(limit),
    });

    const total = await ActivityLog.count({
      userRole: 'owner',
      branchIds: [parseInt(branchId)],
      userId: user_id ? parseInt(user_id) : null,
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
        page: parseInt(page),
        limit: parseInt(limit),
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Get logs for specific entity
 */
const getEntityLogs = async (req, res, next) => {
  try {
    const { entityType, entityId } = req.params;
    const userRole = req.user.role;
    const userId = req.userId;
    const branchId = req.branchId;

    let branchIds = null;

    if (userRole === 'owner') {
      // Owner: get all branches they own
      const ownerBranches = await Branch.findByOwner(userId);
      branchIds = ownerBranches.map(b => b.id);
    }

    const logs = await LogService.getEntityLogs({
      entityType,
      entityId: parseInt(entityId),
      userRole,
      branchIds,
      branchId,
    });

    res.json({
      success: true,
      data: { logs },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Get system logs (Admin/Technical only)
 */
const getSystemLogs = async (req, res, next) => {
  try {
    const {
      level,
      category,
      user_id,
      branch_id,
      start_date,
      end_date,
      page = 1,
      limit = 50,
    } = req.query;

    // Only admin can access system logs
    if (req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Only admin can view system logs.',
      });
    }

    const logs = await LogService.getSystemLogs({
      level,
      category,
      userId: user_id ? parseInt(user_id) : null,
      branchId: branch_id ? parseInt(branch_id) : null,
      startDate: start_date,
      endDate: end_date,
      page: parseInt(page),
      limit: parseInt(limit),
    });

    res.json({
      success: true,
      data: {
        logs,
        page: parseInt(page),
        limit: parseInt(limit),
      },
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getActivityLogs,
  getBranchActivityLogs,
  getEntityLogs,
  getSystemLogs,
};

