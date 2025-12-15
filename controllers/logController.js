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
        // STRICT: Ensure page and limit are valid integers
        let pageInt = 1;
        let limitInt = 50;
        
        if (page && page !== '' && page !== null && page !== undefined) {
          const parsed = parseInt(String(page));
          if (!isNaN(parsed) && isFinite(parsed) && parsed > 0) {
            pageInt = parsed;
          }
        }
        
        if (limit && limit !== '' && limit !== null && limit !== undefined) {
          const parsed = parseInt(String(limit));
          if (!isNaN(parsed) && isFinite(parsed) && parsed > 0 && parsed <= 1000) {
            limitInt = parsed;
          }
        }
        
        return res.json({
          success: true,
          data: {
            logs: [],
            total: 0,
            page: pageInt,
            limit: limitInt,
          },
        });
      }

      // Filter by specific branch if provided
      // STRICT: Ensure branchIds is always valid array of integers
      const filterBranchIds = branch_id && branch_id !== '' && branch_id !== null && branch_id !== undefined
        ? (() => {
            const parsed = parseInt(String(branch_id));
            return (!isNaN(parsed) && isFinite(parsed) && parsed > 0) ? [parsed] : null;
          })()
        : (Array.isArray(branchIds) && branchIds.length > 0 
            ? branchIds
                .map(id => {
                  const parsed = parseInt(String(id));
                  return (!isNaN(parsed) && isFinite(parsed) && parsed > 0) ? parsed : null;
                })
                .filter(id => id !== null && id !== undefined)
            : null);

      // STRICT: Ensure page and limit are valid integers (not NaN, not empty)
      let pageInt = 1;
      let limitInt = 50;
      
      if (page && page !== '' && page !== null && page !== undefined) {
        const parsed = parseInt(String(page));
        if (!isNaN(parsed) && isFinite(parsed) && parsed > 0) {
          pageInt = parsed;
        }
      }
      
      if (limit && limit !== '' && limit !== null && limit !== undefined) {
        const parsed = parseInt(String(limit));
        if (!isNaN(parsed) && isFinite(parsed) && parsed > 0 && parsed <= 1000) {
          limitInt = parsed;
        }
      }

      // STRICT: Only pass valid, non-empty values
      logs = await LogService.getActivityLogs({
        userRole: 'owner',
        branchIds: filterBranchIds && filterBranchIds.length > 0 ? filterBranchIds : null,
        userId: (user_id && user_id !== '' && user_id !== null && user_id !== undefined) ? (() => {
          const parsed = parseInt(String(user_id));
          return (!isNaN(parsed) && isFinite(parsed) && parsed > 0) ? parsed : null;
        })() : null,
        action: (action && action !== '' && action !== null && action !== undefined) ? String(action).trim() : null,
        entityType: (entity_type && entity_type !== '' && entity_type !== null && entity_type !== undefined) ? String(entity_type).trim() : null,
        entityId: (entity_id && entity_id !== '' && entity_id !== null && entity_id !== undefined) ? (() => {
          const parsed = parseInt(String(entity_id));
          return (!isNaN(parsed) && isFinite(parsed) && parsed > 0) ? parsed : null;
        })() : null,
        startDate: (start_date && start_date !== '' && start_date !== null && start_date !== undefined) ? String(start_date).trim() : null,
        endDate: (end_date && end_date !== '' && end_date !== null && end_date !== undefined) ? String(end_date).trim() : null,
        page: pageInt, // GUARANTEED to be valid integer
        limit: limitInt, // GUARANTEED to be valid integer
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

