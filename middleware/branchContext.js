const Branch = require('../models/Branch');

// Get current branch from header or auto-assign for admin
const getCurrentBranch = async (req, res, next) => {
  try {
    const branchId = req.headers['x-branch-id'];
    
    if (req.user.role === 'admin') {
      // Admin: if branch ID is provided in header, use it (admin can be PIC of multiple branches)
      if (branchId) {
        const parsedBranchId = parseInt(branchId);
        // Verify admin has access to this branch (they must be PIC)
        const hasAccess = await Branch.userHasAccess(req.userId, parsedBranchId, req.user.role);
        if (!hasAccess) {
          return res.status(403).json({
            success: false,
            message: 'No access to this branch'
          });
        }
        req.branchId = parsedBranchId;
        return next();
      }
      
      // If no branch ID in header, fallback to first assigned branch (for backward compatibility)
      const branch = await Branch.getAdminBranch(req.userId);
      if (!branch) {
        return res.status(404).json({
          success: false,
          message: 'No branch assigned to this admin'
        });
      }
      req.branchId = branch.id;
      return next();
    }
    
    // Owner: branch_id is required from header
    if (!branchId) {
      return res.status(400).json({
        success: false,
        message: 'Branch ID is required. Please provide X-Branch-Id header.'
      });
    }
    
    // Verify user has access to this branch
    const hasAccess = await Branch.userHasAccess(req.userId, parseInt(branchId), req.user.role);
    if (!hasAccess) {
      return res.status(403).json({
        success: false,
        message: 'No access to this branch'
      });
    }
    
    req.branchId = parseInt(branchId);
    next();
  } catch (error) {
    next(error);
  }
};

// Optional branch context (for endpoints that work with or without branch)
const optionalBranchContext = async (req, res, next) => {
  try {
    const branchId = req.headers['x-branch-id'];
    
    if (branchId) {
      const parsedBranchId = parseInt(branchId);
      const hasAccess = await Branch.userHasAccess(req.userId, parsedBranchId, req.user.role);
      if (hasAccess) {
        req.branchId = parsedBranchId;
      }
    } else if (req.user.role === 'admin') {
      // Auto-assign for admin (fallback to first branch if no header)
      const branch = await Branch.getAdminBranch(req.userId);
      if (branch) {
        req.branchId = branch.id;
      }
    }
    
    next();
  } catch (error) {
    // Ignore errors for optional context
    next();
  }
};

module.exports = {
  getCurrentBranch,
  optionalBranchContext
};

