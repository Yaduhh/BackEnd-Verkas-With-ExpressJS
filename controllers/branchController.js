const Branch = require('../models/Branch');
const User = require('../models/User');

// Get all branches user has access to
const getAll = async (req, res, next) => {
  try {
    const branches = await Branch.findByUserAccess(req.userId, req.user.role);
    
    res.json({
      success: true,
      data: { branches }
    });
  } catch (error) {
    next(error);
  }
};

// Get branch by ID
const getById = async (req, res, next) => {
  try {
    const { id } = req.params;
    const branch = await Branch.findById(id);
    
    if (!branch) {
      return res.status(404).json({
        success: false,
        message: 'Branch not found'
      });
    }
    
    // Check access
    const hasAccess = await Branch.userHasAccess(req.userId, parseInt(id), req.user.role);
    if (!hasAccess) {
      return res.status(403).json({
        success: false,
        message: 'No access to this branch'
      });
    }
    
    res.json({
      success: true,
      data: { branch }
    });
  } catch (error) {
    next(error);
  }
};

// Get current branch (for admin, their assigned branch)
const getCurrent = async (req, res, next) => {
  try {
    if (req.user.role === 'admin') {
      const branch = await Branch.getAdminBranch(req.userId);
      if (!branch) {
        return res.status(404).json({
          success: false,
          message: 'No branch assigned to this admin'
        });
      }
      return res.json({
        success: true,
        data: { branch }
      });
    } else if (req.user.role === 'owner' || req.user.role === 'co-owner') {
      // For owner and co-owner, get from header or return first branch
      const branchId = req.headers['x-branch-id'];
      if (branchId) {
        const branch = await Branch.findById(branchId);
        // Check access using userHasAccess for both owner and co-owner
        const hasAccess = await Branch.userHasAccess(req.userId, parseInt(branchId), req.user.role);
        if (branch && hasAccess) {
          return res.json({
            success: true,
            data: { branch }
          });
        }
      }
      
      // Return first branch from user access
      const branches = await Branch.findByUserAccess(req.userId, req.user.role);
      if (branches.length > 0) {
        return res.json({
          success: true,
          data: { branch: branches[0] }
        });
      }
      
      return res.status(404).json({
        success: false,
        message: 'No branches found'
      });
    }
    
    return res.status(404).json({
      success: false,
      message: 'No branches found'
    });
  } catch (error) {
    next(error);
  }
};

// Create branch (owner and co-owner only)
const create = async (req, res, next) => {
  try {
    if (req.user.role !== 'owner' && req.user.role !== 'co-owner') {
      return res.status(403).json({
        success: false,
        message: 'Only owners and co-owners can create branches'
      });
    }
    
    // Check if user can create more branches
    const canCreate = await Branch.canCreateBranch(req.userId, req.user.role);
    if (!canCreate) {
      const count = await Branch.countUserBranches(req.userId, req.user.role);
      const Subscription = require('../models/Subscription');
      const subscription = await Subscription.getActiveSubscription(req.userId);
      
      let maxBranches = 1; // Free plan default
      if (subscription) {
        const SubscriptionPlan = require('../models/SubscriptionPlan');
        const plan = await SubscriptionPlan.findById(subscription.plan_id);
        maxBranches = plan?.max_branches || 1;
      }
      
      return res.status(403).json({
        success: false,
        message: 'Branch limit reached. Please upgrade your subscription.',
        code: 'BRANCH_LIMIT_EXCEEDED',
        data: {
          current_branches: count,
          max_branches: maxBranches
        }
      });
    }
    
    const { name, address, phone, pic_id, pic_ids, team_id } = req.body;
    
    if (!name) {
      return res.status(400).json({
        success: false,
        message: 'Branch name is required'
      });
    }
    
    // Support both pic_id (single, backward compatibility) and pic_ids (array)
    const picIds = pic_ids || (pic_id ? [pic_id] : []);
    
    // Verify all PICs if provided
    if (picIds.length > 0) {
      for (const pid of picIds) {
        const pic = await User.findById(pid);
        if (!pic || pic.role !== 'admin') {
          return res.status(400).json({
            success: false,
            message: `User ${pid} must be an admin user`
          });
        }
      }
    }
    
    // Auto-determine team_id if not provided
    let finalTeamId = team_id || null;
    if (!finalTeamId) {
      const OwnerTeam = require('../models/OwnerTeam');
      
      // Get current user to check created_by
      const currentUser = await User.findById(req.userId);
      
      if (req.user.role === 'co-owner' && currentUser && currentUser.created_by) {
        // Co-owner: always use team from the owner who created them
        const creatorTeams = await OwnerTeam.findByUserId(currentUser.created_by);
        if (creatorTeams.length > 0) {
          finalTeamId = creatorTeams[0].id;
        }
      } else if (req.user.role === 'owner') {
        // Owner: use their own team
        const ownerTeams = await OwnerTeam.findByUserId(req.userId);
        if (ownerTeams.length > 0) {
          finalTeamId = ownerTeams[0].id;
        }
      } else if (currentUser && currentUser.created_by) {
        // Fallback: User was created by another owner, use their team
        const creatorTeams = await OwnerTeam.findByUserId(currentUser.created_by);
        if (creatorTeams.length > 0) {
          finalTeamId = creatorTeams[0].id;
        }
      } else {
        // Last resort: use user's own team
        const userTeams = await OwnerTeam.findByUserId(req.userId);
        if (userTeams.length > 0) {
          finalTeamId = userTeams[0].id;
        }
      }
    }
    
    const branch = await Branch.create({
      name,
      address,
      phone,
      ownerId: req.userId,
      teamId: finalTeamId,
      picId: picIds.length > 0 ? picIds[0] : null // For backward compatibility
    });
    
    // Set multiple PICs if provided
    if (picIds.length > 0) {
      await Branch.setPICs(branch.id, picIds);
      // Reload branch to get PICs
      const updatedBranch = await Branch.findById(branch.id);
      branch.pics = updatedBranch.pics;
    }
    
    res.status(201).json({
      success: true,
      message: 'Branch created successfully',
      data: { branch }
    });
  } catch (error) {
    next(error);
  }
};

// Update branch (owner only)
const update = async (req, res, next) => {
  try {
    const { id } = req.params;
    const branch = await Branch.findById(id);
    
    if (!branch) {
      return res.status(404).json({
        success: false,
        message: 'Branch not found'
      });
    }
    
    // Check access (owner and co-owner)
    const hasAccess = await Branch.userHasAccess(req.userId, parseInt(id), req.user.role);
    if (!hasAccess) {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }
    
    const { name, address, phone, pic_id, status_active } = req.body;
    
    // Verify PIC if provided
    if (pic_id !== undefined && pic_id !== null) {
      const pic = await User.findById(pic_id);
      if (!pic || pic.role !== 'admin') {
        return res.status(400).json({
          success: false,
          message: 'PIC must be an admin user'
        });
      }
    }
    
    const updatedBranch = await Branch.update(id, {
      name,
      address,
      phone,
      picId: pic_id,
      statusActive: status_active
    });
    
    res.json({
      success: true,
      message: 'Branch updated successfully',
      data: { branch: updatedBranch }
    });
  } catch (error) {
    next(error);
  }
};

// Assign PIC to branch (owner only)
const assignPIC = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { pic_id } = req.body;
    
    if (!pic_id) {
      return res.status(400).json({
        success: false,
        message: 'PIC ID is required'
      });
    }
    
    const branch = await Branch.findById(id);
    if (!branch) {
      return res.status(404).json({
        success: false,
        message: 'Branch not found'
      });
    }
    
    // Check access (owner and co-owner)
    const hasAccess = await Branch.userHasAccess(req.userId, parseInt(id), req.user.role);
    if (!hasAccess) {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }
    
    const updatedBranch = await Branch.assignPIC(id, pic_id);
    
    res.json({
      success: true,
      message: 'PIC assigned successfully',
      data: { branch: updatedBranch }
    });
  } catch (error) {
    if (error.message === 'PIC must be an admin user') {
      return res.status(400).json({
        success: false,
        message: error.message
      });
    }
    next(error);
  }
};

// Remove PIC from branch (owner only)
const removePIC = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { pic_id } = req.body; // Optional: remove specific PIC, if not provided remove all
    
    const branch = await Branch.findById(id);
    if (!branch) {
      return res.status(404).json({
        success: false,
        message: 'Branch not found'
      });
    }
    
    // Check access (owner and co-owner)
    const hasAccess = await Branch.userHasAccess(req.userId, parseInt(id), req.user.role);
    if (!hasAccess) {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }
    
    const updatedBranch = await Branch.removePIC(id, pic_id || null);
    
    res.json({
      success: true,
      message: pic_id ? 'PIC removed successfully' : 'All PICs removed successfully',
      data: { branch: updatedBranch }
    });
  } catch (error) {
    next(error);
  }
};

// Set multiple PICs at once (replaces existing)
const setPICs = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { pic_ids } = req.body; // Array of PIC IDs
    
    if (!Array.isArray(pic_ids)) {
      return res.status(400).json({
        success: false,
        message: 'pic_ids must be an array'
      });
    }
    
    const branch = await Branch.findById(id);
    if (!branch) {
      return res.status(404).json({
        success: false,
        message: 'Branch not found'
      });
    }
    
    // Check access (owner and co-owner)
    const hasAccess = await Branch.userHasAccess(req.userId, parseInt(id), req.user.role);
    if (!hasAccess) {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }
    
    const updatedBranch = await Branch.setPICs(id, pic_ids);
    
    res.json({
      success: true,
      message: 'PICs updated successfully',
      data: { branch: updatedBranch }
    });
  } catch (error) {
    if (error.message.includes('must be an admin user')) {
      return res.status(400).json({
        success: false,
        message: error.message
      });
    }
    next(error);
  }
};

// Soft delete branch (owner only)
const softDelete = async (req, res, next) => {
  try {
    const { id } = req.params;
    
    const branch = await Branch.findById(id);
    if (!branch) {
      return res.status(404).json({
        success: false,
        message: 'Branch not found'
      });
    }
    
    // Check access (owner and co-owner)
    const hasAccess = await Branch.userHasAccess(req.userId, parseInt(id), req.user.role);
    if (!hasAccess) {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }
    
    const result = await Branch.softDelete(id);
    
    res.json({
      success: true,
      message: 'Branch deleted successfully',
      data: result
    });
  } catch (error) {
    next(error);
  }
};

// Restore branch (owner only)
const restore = async (req, res, next) => {
  try {
    const { id } = req.params;
    
    const branch = await Branch.findById(id);
    if (!branch) {
      return res.status(404).json({
        success: false,
        message: 'Branch not found'
      });
    }
    
    // Check access (owner and co-owner)
    const hasAccess = await Branch.userHasAccess(req.userId, parseInt(id), req.user.role);
    if (!hasAccess) {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }
    
    const restoredBranch = await Branch.restore(id);
    
    res.json({
      success: true,
      message: 'Branch restored successfully',
      data: { branch: restoredBranch }
    });
  } catch (error) {
    next(error);
  }
};

// Check branch limit
const checkLimit = async (req, res, next) => {
  try {
    if (req.user.role !== 'owner' && req.user.role !== 'co-owner') {
      return res.json({
        success: true,
        data: {
          can_create: false,
          reason: 'Only owners can create branches'
        }
      });
    }
    
    // For co-owner, use subscription from the owner who created them
    let targetUserId = req.userId;
    if (req.user.role === 'co-owner' && req.user.created_by) {
      targetUserId = req.user.created_by;
    }
    
    const canCreate = await Branch.canCreateBranch(targetUserId, req.user.role);
    const count = await Branch.countUserBranches(req.userId, req.user.role);
    
    const Subscription = require('../models/Subscription');
    const subscription = await Subscription.getActiveSubscription(targetUserId);
    
    let maxBranches = 1; // Free plan default
    if (subscription) {
      const SubscriptionPlan = require('../models/SubscriptionPlan');
      const plan = await SubscriptionPlan.findById(subscription.plan_id);
      maxBranches = plan?.max_branches || 1;
    }
    
    res.json({
      success: true,
      data: {
        can_create: canCreate,
        current_branches: count,
        max_branches: maxBranches,
        is_unlimited: maxBranches === null
      }
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getAll,
  getById,
  getCurrent,
  create,
  update,
  assignPIC,
  removePIC,
  setPICs,
  softDelete,
  restore,
  checkLimit
};

