const { query } = require('../config/database');

// Cache untuk user dan branch info (reduce database queries)
const userCache = new Map();
const branchCache = new Map();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// Helper untuk get cached user
async function getCachedUser(userId) {
  const cached = userCache.get(userId);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.data;
  }
  
  const User = require('../models/User');
  const user = await User.findById(userId);
  if (user) {
    userCache.set(userId, {
      data: {
        name: user.name,
        email: user.email,
        role: user.role,
      },
      timestamp: Date.now(),
    });
    return userCache.get(userId).data;
  }
  return null;
}

// Helper untuk get cached branch
async function getCachedBranch(branchId) {
  const cached = branchCache.get(branchId);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.data;
  }
  
  const Branch = require('../models/Branch');
  const branch = await Branch.findById(branchId);
  if (branch) {
    branchCache.set(branchId, {
      data: {
        name: branch.name,
      },
      timestamp: Date.now(),
    });
    return branchCache.get(branchId).data;
  }
  return null;
}

class LogService {
  /**
   * Log user activity (WAJIB ada branchId untuk activity logs)
   * NON-BLOCKING: Fire and forget untuk tidak memperlambat main flow
   */
  static logActivity({
    userId, // WAJIB - user yang melakukan action
    action, // WAJIB - action yang dilakukan
    entityType = null,
    entityId = null,
    branchId, // WAJIB - branch dimana action terjadi
    oldValues = null,
    newValues = null,
    changes = null,
    status = 'success',
    errorMessage = null,
    ipAddress = null,
    userAgent = null,
    requestMethod = null,
    requestPath = null,
    metadata = null,
  }) {
    // Fire and forget - tidak blocking main flow
    setImmediate(async () => {
      try {
        // Validate required fields
        if (!userId || !action || !branchId) {
          return; // Silent fail untuk performance
        }

        // Get user info (with cache)
        const userInfo = await getCachedUser(userId);
        if (!userInfo) {
          return; // Silent fail jika user tidak ditemukan
        }

        // Get branch info (with cache)
        const branchInfo = await getCachedBranch(branchId);
        if (!branchInfo) {
          return; // Silent fail jika branch tidak ditemukan
        }

        // Helper function to safely stringify JSON for MySQL JSON columns
        const safeStringify = (data) => {
          if (!data) return null;
          try {
            // First, clean the data to remove any problematic values
            const cleaned = JSON.parse(JSON.stringify(data, (key, value) => {
              // Skip functions and undefined
              if (typeof value === 'function' || value === undefined) {
                return null;
              }
              // Convert Buffer to string if present
              if (Buffer.isBuffer(value)) {
                return value.toString('utf8');
              }
              // Ensure all strings are valid UTF-8
              if (typeof value === 'string') {
                // Remove any invalid UTF-8 characters and control characters
                return value.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
              }
              return value;
            }));
            // Stringify and ensure it's a valid UTF-8 string
            const jsonString = JSON.stringify(cleaned);
            // Convert to Buffer and back to ensure UTF-8 encoding
            return Buffer.from(jsonString, 'utf8').toString('utf8');
          } catch (error) {
            // If stringify fails, return null instead of throwing
            if (process.env.NODE_ENV === 'development') {
              console.error('Error stringifying JSON for log:', error);
            }
            return null;
          }
        };

        const sql = `
          INSERT INTO activity_logs (
            user_id, user_name, user_email, user_role,
            action, entity_type, entity_id,
            branch_id, branch_name,
            old_values, new_values, changes,
            status, error_message,
            ip_address, user_agent, request_method, request_path,
            metadata,
            created_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CAST(? AS CHAR CHARACTER SET utf8mb4), CAST(? AS CHAR CHARACTER SET utf8mb4), CAST(? AS CHAR CHARACTER SET utf8mb4), ?, ?, ?, ?, ?, ?, CAST(? AS CHAR CHARACTER SET utf8mb4), NOW())
        `;

        const oldValuesJson = safeStringify(oldValues);
        const newValuesJson = safeStringify(newValues);
        const changesJson = safeStringify(changes);
        const metadataJson = safeStringify(metadata);

        await query(sql, [
          userId,
          userInfo.name || null,
          userInfo.email || null,
          userInfo.role || null,
          action,
          entityType,
          entityId,
          branchId,
          branchInfo.name || null,
          oldValuesJson,
          newValuesJson,
          changesJson,
          status,
          errorMessage,
          ipAddress,
          userAgent,
          requestMethod,
          requestPath,
          metadataJson,
        ]);
      } catch (error) {
        // Silent fail - logging should not break the main flow
        // Only log to console in development
        if (process.env.NODE_ENV === 'development') {
          console.error('Error logging activity:', error.message);
        }
      }
    });
  }

  /**
   * Log system event
   * NON-BLOCKING: Fire and forget
   */
  static logSystem({
    level = 'info',
    category,
    message,
    context = null,
    userId = null,
    branchId = null,
    ipAddress = null,
    requestMethod = null,
    requestPath = null,
    stackTrace = null,
    errorCode = null,
  }) {
    // Fire and forget - tidak blocking main flow
    setImmediate(async () => {
      try {
        // Helper function to safely stringify JSON for MySQL JSON columns
        const safeStringify = (data) => {
          if (!data) return null;
          try {
            // First, clean the data to remove any problematic values
            const cleaned = JSON.parse(JSON.stringify(data, (key, value) => {
              // Skip functions and undefined
              if (typeof value === 'function' || value === undefined) {
                return null;
              }
              // Convert Buffer to string if present
              if (Buffer.isBuffer(value)) {
                return value.toString('utf8');
              }
              // Ensure all strings are valid UTF-8
              if (typeof value === 'string') {
                // Remove any invalid UTF-8 characters and control characters
                return value.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
              }
              return value;
            }));
            // Stringify and ensure it's a valid UTF-8 string
            const jsonString = JSON.stringify(cleaned);
            // Convert to Buffer and back to ensure UTF-8 encoding
            return Buffer.from(jsonString, 'utf8').toString('utf8');
          } catch (error) {
            // If stringify fails, return null instead of throwing
            if (process.env.NODE_ENV === 'development') {
              console.error('Error stringifying JSON for log:', error);
            }
            return null;
          }
        };

        const sql = `
          INSERT INTO system_logs (
            level, category, message, context, user_id, branch_id,
            ip_address, request_method, request_path,
            stack_trace, error_code, created_at
          ) VALUES (?, ?, ?, CAST(? AS CHAR CHARACTER SET utf8mb4), ?, ?, ?, ?, ?, ?, ?, NOW())
        `;

        const contextJson = safeStringify(context);

        await query(sql, [
          level,
          category,
          message,
          contextJson,
          userId,
          branchId,
          ipAddress,
          requestMethod,
          requestPath,
          stackTrace,
          errorCode,
        ]);
      } catch (error) {
        // Silent fail - logging should not break the main flow
        if (process.env.NODE_ENV === 'development') {
          console.error('Error logging system event:', error.message);
        }
      }
    });
  }

  /**
   * Get activity logs with filters
   * Owner: bisa filter berdasarkan branch mereka (semua branch yang mereka punya)
   * Admin: hanya bisa lihat log di branch yang mereka assign
   */
  static async getActivityLogs({
    userId = null, // User yang request (untuk role-based filtering)
    userRole = null, // Role user yang request
    action = null,
    entityType = null,
    entityId = null,
    branchId = null, // Filter by specific branch
    branchIds = null, // Array of branch IDs (untuk owner melihat semua branch mereka)
    startDate = null,
    endDate = null,
    page = 1,
    limit = 50,
  }) {
    let sql = 'SELECT * FROM activity_logs WHERE 1=1';
    const params = [];

    // Role-based filtering
    // Normalize branchIds to array
    const normalizedBranchIds = Array.isArray(branchIds) ? branchIds : (branchIds ? [branchIds] : null);
    
    if ((userRole === 'owner' || userRole === 'co-owner') && normalizedBranchIds && normalizedBranchIds.length > 0) {
      // Owner and co-owner: bisa lihat log di semua branch yang mereka akses
      // Ensure all values are numbers
      const validBranchIds = normalizedBranchIds
        .map(id => parseInt(id))
        .filter(id => !isNaN(id) && id > 0);
      
      if (validBranchIds.length > 0) {
        if (validBranchIds.length === 1) {
          // Single branch - use = instead of IN for better performance
          sql += ' AND branch_id = ?';
          params.push(validBranchIds[0]);
        } else {
          // Multiple branches - use IN with proper placeholders
          const placeholders = validBranchIds.map(() => '?').join(',');
          sql += ` AND branch_id IN (${placeholders})`;
          params.push(...validBranchIds);
        }
      }
    } else if (userRole === 'admin' && branchId) {
      // Admin: hanya bisa lihat log di branch yang mereka assign
      if (branchId !== null && branchId !== undefined) {
        const branchIdInt = parseInt(branchId);
        if (!isNaN(branchIdInt) && isFinite(branchIdInt) && branchIdInt > 0) {
          sql += ' AND branch_id = ?';
          params.push(branchIdInt);
        }
      }
    } else if (branchId) {
      // Direct branch filter
      if (branchId !== null && branchId !== undefined) {
        const branchIdInt = parseInt(branchId);
        if (!isNaN(branchIdInt) && isFinite(branchIdInt) && branchIdInt > 0) {
          sql += ' AND branch_id = ?';
          params.push(branchIdInt);
        }
      }
    }

    if (userId !== null && userId !== undefined) {
      const userIdInt = parseInt(userId);
      if (!isNaN(userIdInt) && isFinite(userIdInt) && userIdInt > 0) {
        sql += ' AND user_id = ?';
        params.push(userIdInt);
      }
    }
    if (action && action !== null && action !== undefined) {
      sql += ' AND action = ?';
      params.push(String(action));
    }
    if (entityType && entityType !== null && entityType !== undefined) {
      sql += ' AND entity_type = ?';
      params.push(String(entityType));
    }
    if (entityId !== null && entityId !== undefined) {
      const entityIdInt = parseInt(entityId);
      if (!isNaN(entityIdInt) && isFinite(entityIdInt) && entityIdInt > 0) {
        sql += ' AND entity_id = ?';
        params.push(entityIdInt);
      }
    }
    if (startDate && startDate !== null && startDate !== undefined) {
      sql += ' AND created_at >= ?';
      params.push(String(startDate));
    }
    if (endDate && endDate !== null && endDate !== undefined) {
      sql += ' AND created_at <= ?';
      params.push(String(endDate));
    }

    sql += ' ORDER BY created_at DESC';
    sql += ` LIMIT ? OFFSET ?`;
    // Ensure limit and offset are valid integers (not NaN, not null, not undefined)
    let limitInt = 50;
    let pageInt = 1;
    
    if (limit !== null && limit !== undefined) {
      const parsed = parseInt(limit);
      if (!isNaN(parsed) && parsed > 0) {
        limitInt = parsed;
      }
    }
    
    if (page !== null && page !== undefined) {
      const parsed = parseInt(page);
      if (!isNaN(parsed) && parsed > 0) {
        pageInt = parsed;
      }
    }
    
    const offsetInt = Math.max(0, (pageInt - 1) * limitInt);
    
    // Push limit and offset (already validated)
    params.push(limitInt, offsetInt);
    
    // Count placeholders in SQL
    const placeholderCount = (sql.match(/\?/g) || []).length;
    
    // Final validation: ensure all params are valid and match placeholder count
    const finalParams = params.map((p, index) => {
      // Reject undefined
      if (p === undefined) {
        console.error(`Parameter at index ${index} is undefined`);
        throw new Error(`Invalid parameter: undefined at index ${index}`);
      }
      
      // Validate numbers
      if (typeof p === 'number') {
        if (isNaN(p) || !isFinite(p)) {
          console.error(`Invalid number parameter at index ${index}:`, p);
          throw new Error(`Invalid number parameter: ${p} at index ${index}`);
        }
      }
      
      return p;
    });
    
    if (finalParams.length !== placeholderCount) {
      console.error('SQL parameter mismatch:', {
        sql,
        placeholderCount,
        paramsLength: finalParams.length,
        params: finalParams,
        originalParams: params,
        limitInt,
        offsetInt,
        pageInt
      });
      throw new Error(`SQL parameter count mismatch: expected ${placeholderCount}, got ${finalParams.length}`);
    }
    
    // Debug log in development
    if (process.env.NODE_ENV === 'development') {
      console.log('Executing query:', {
        sql: sql.substring(0, 200),
        paramCount: finalParams.length,
        params: finalParams
      });
    }

    const logs = await query(sql, finalParams);
    
    // Parse JSON fields
    return logs.map(log => ({
      ...log,
      old_values: log.old_values ? JSON.parse(log.old_values) : null,
      new_values: log.new_values ? JSON.parse(log.new_values) : null,
      changes: log.changes ? JSON.parse(log.changes) : null,
      metadata: log.metadata ? JSON.parse(log.metadata) : null,
    }));
  }

  /**
   * Get activity logs for owner (semua branch yang mereka punya)
   */
  static async getOwnerActivityLogs({
    ownerId,
    branchIds, // Array of branch IDs yang dimiliki owner
    action = null,
    entityType = null,
    startDate = null,
    endDate = null,
    page = 1,
    limit = 50,
  }) {
    if (!branchIds || branchIds.length === 0) {
      return [];
    }

    return await this.getActivityLogs({
      userRole: 'owner',
      branchIds: branchIds,
      action,
      entityType,
      startDate,
      endDate,
      page,
      limit,
    });
  }

  /**
   * Get system logs
   */
  static async getSystemLogs({
    level = null,
    category = null,
    userId = null,
    branchId = null,
    startDate = null,
    endDate = null,
    page = 1,
    limit = 50,
  }) {
    let sql = 'SELECT * FROM system_logs WHERE 1=1';
    const params = [];

    if (level) {
      sql += ' AND level = ?';
      params.push(level);
    }
    if (category) {
      sql += ' AND category = ?';
      params.push(category);
    }
    if (userId) {
      sql += ' AND user_id = ?';
      params.push(userId);
    }
    if (branchId) {
      sql += ' AND branch_id = ?';
      params.push(branchId);
    }
    if (startDate) {
      sql += ' AND created_at >= ?';
      params.push(startDate);
    }
    if (endDate) {
      sql += ' AND created_at <= ?';
      params.push(endDate);
    }

    sql += ' ORDER BY created_at DESC';
    sql += ` LIMIT ? OFFSET ?`;
    // Ensure limit and offset are valid integers (not NaN)
    const limitInt = (limit && !isNaN(parseInt(limit)) && parseInt(limit) > 0) ? parseInt(limit) : 50;
    const pageInt = (page && !isNaN(parseInt(page)) && parseInt(page) > 0) ? parseInt(page) : 1;
    const offsetInt = Math.max(0, (pageInt - 1) * limitInt);
    params.push(limitInt, offsetInt);

    const logs = await query(sql, params);
    
    // Parse JSON fields
    return logs.map(log => ({
      ...log,
      context: log.context ? JSON.parse(log.context) : null,
    }));
  }

  /**
   * Get logs for specific entity
   */
  static async getEntityLogs({
    entityType,
    entityId,
    userRole = null,
    branchIds = null,
    branchId = null,
  }) {
    let sql = 'SELECT * FROM activity_logs WHERE entity_type = ? AND entity_id = ?';
    const params = [entityType, entityId];

    // Role-based filtering
    // Normalize branchIds to array
    const normalizedBranchIds = Array.isArray(branchIds) ? branchIds : (branchIds ? [branchIds] : null);
    
    if (userRole === 'owner' && normalizedBranchIds && normalizedBranchIds.length > 0) {
      // Ensure all values are numbers
      const validBranchIds = normalizedBranchIds
        .map(id => parseInt(id))
        .filter(id => !isNaN(id) && id > 0);
      
      if (validBranchIds.length > 0) {
        if (validBranchIds.length === 1) {
          // Single branch - use = instead of IN for better performance
          sql += ' AND branch_id = ?';
          params.push(validBranchIds[0]);
        } else {
          // Multiple branches - use IN with proper placeholders
          const placeholders = validBranchIds.map(() => '?').join(',');
          sql += ` AND branch_id IN (${placeholders})`;
          params.push(...validBranchIds);
        }
      }
    } else if (userRole === 'admin' && branchId) {
      sql += ' AND branch_id = ?';
      params.push(parseInt(branchId));
    }

    sql += ' ORDER BY created_at DESC';

    const logs = await query(sql, params);
    
    // Parse JSON fields
    return logs.map(log => ({
      ...log,
      old_values: log.old_values ? JSON.parse(log.old_values) : null,
      new_values: log.new_values ? JSON.parse(log.new_values) : null,
      changes: log.changes ? JSON.parse(log.changes) : null,
      metadata: log.metadata ? JSON.parse(log.metadata) : null,
    }));
  }

  /**
   * Clear cache (useful untuk testing atau manual refresh)
   */
  static clearCache() {
    userCache.clear();
    branchCache.clear();
  }
}

module.exports = LogService;
