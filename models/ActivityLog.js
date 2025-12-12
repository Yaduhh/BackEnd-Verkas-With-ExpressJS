const { query } = require('../config/database');
const LogService = require('../services/logService');

class ActivityLog {
  /**
   * Get activity logs with filters
   */
  static async findAll(filters = {}) {
    return await LogService.getActivityLogs(filters);
  }

  /**
   * Get logs for owner
   */
  static async findByOwner(ownerId, branchIds, filters = {}) {
    return await LogService.getOwnerActivityLogs({
      ownerId,
      branchIds,
      ...filters,
    });
  }

  /**
   * Get logs for admin
   */
  static async findByAdmin(adminId, branchId, filters = {}) {
    return await LogService.getActivityLogs({
      userId: adminId,
      userRole: 'admin',
      branchId,
      ...filters,
    });
  }

  /**
   * Get logs for specific entity
   */
  static async findByEntity(entityType, entityId, filters = {}) {
    return await LogService.getEntityLogs({
      entityType,
      entityId,
      ...filters,
    });
  }

  /**
   * Get count of logs (for pagination)
   */
  static async count(filters = {}) {
    let sql = 'SELECT COUNT(*) as total FROM activity_logs WHERE 1=1';
    const params = [];

    const { userRole, branchId, branchIds, userId, action, entityType, entityId, startDate, endDate } = filters;

    // Role-based filtering
    if (userRole === 'owner' && branchIds && branchIds.length > 0) {
      sql += ' AND branch_id IN (' + branchIds.map(() => '?').join(',') + ')';
      params.push(...branchIds);
    } else if (userRole === 'admin' && branchId) {
      sql += ' AND branch_id = ?';
      params.push(branchId);
    } else if (branchId) {
      sql += ' AND branch_id = ?';
      params.push(branchId);
    }

    if (userId) {
      sql += ' AND user_id = ?';
      params.push(userId);
    }
    if (action) {
      sql += ' AND action = ?';
      params.push(action);
    }
    if (entityType) {
      sql += ' AND entity_type = ?';
      params.push(entityType);
    }
    if (entityId) {
      sql += ' AND entity_id = ?';
      params.push(entityId);
    }
    if (startDate) {
      sql += ' AND created_at >= ?';
      params.push(startDate);
    }
    if (endDate) {
      sql += ' AND created_at <= ?';
      params.push(endDate);
    }

    const result = await query(sql, params);
    return result[0]?.total || 0;
  }
}

module.exports = ActivityLog;

