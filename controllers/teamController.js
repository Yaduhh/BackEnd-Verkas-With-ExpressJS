const OwnerTeam = require('../models/OwnerTeam');
const User = require('../models/User');
const Branch = require('../models/Branch');

// Get all teams user is member of
const getAll = async (req, res, next) => {
  try {
    if (req.user.role !== 'owner') {
      return res.status(403).json({
        success: false,
        message: 'Only owners can access teams'
      });
    }
    
    const teams = await OwnerTeam.findByUserId(req.userId);
    
    res.json({
      success: true,
      data: { teams }
    });
  } catch (error) {
    next(error);
  }
};

// Get team by ID
const getById = async (req, res, next) => {
  try {
    const { id } = req.params;
    const team = await OwnerTeam.findById(id);
    
    if (!team) {
      return res.status(404).json({
        success: false,
        message: 'Team not found'
      });
    }
    
    // Check access
    const hasAccess = await OwnerTeam.userHasAccess(req.userId, id);
    if (!hasAccess) {
      return res.status(403).json({
        success: false,
        message: 'No access to this team'
      });
    }
    
    const members = await OwnerTeam.getMembers(id);
    const branches = await Branch.findByTeam(id);
    
    res.json({
      success: true,
      data: {
        team: {
          ...team,
          members,
          branches
        }
      }
    });
  } catch (error) {
    next(error);
  }
};

// Create team (owner only)
const create = async (req, res, next) => {
  try {
    if (req.user.role !== 'owner') {
      return res.status(403).json({
        success: false,
        message: 'Only owners can create teams'
      });
    }
    
    const { name } = req.body;
    
    if (!name) {
      return res.status(400).json({
        success: false,
        message: 'Team name is required'
      });
    }
    
    const team = await OwnerTeam.create({
      name,
      primaryOwnerId: req.userId
    });
    
    res.status(201).json({
      success: true,
      message: 'Team created successfully',
      data: { team }
    });
  } catch (error) {
    next(error);
  }
};

// Add member to team (owner only)
// Supports: 1) Add existing owner user by user_id, 2) Create new admin user
const addMember = async (req, res, next) => {
  try {
    if (req.user.role !== 'owner') {
      return res.status(403).json({
        success: false,
        message: 'Only owners can add team members'
      });
    }
    
    const { id } = req.params;
    const { user_id, email, name, password, role = 'member' } = req.body;
    
    const team = await OwnerTeam.findById(id);
    if (!team) {
      return res.status(404).json({
        success: false,
        message: 'Team not found'
      });
    }
    
    // Check if user is primary owner or has access
    if (team.primary_owner_id !== req.userId) {
      return res.status(403).json({
        success: false,
        message: 'Only primary owner can add members'
      });
    }
    
    let targetUserId = user_id;
    
    // If email provided, create new admin user
    if (email && !user_id) {
      if (!password) {
        return res.status(400).json({
          success: false,
          message: 'Password is required when creating new admin user'
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
      
      // Create admin user (track who created it)
      const newAdmin = await User.create({
        email,
        password,
        name: name || null,
        role: 'admin',
        createdBy: req.userId // Track which owner created this admin
      });
      
      targetUserId = newAdmin.id;
    } else if (!user_id) {
      return res.status(400).json({
        success: false,
        message: 'Either user_id or email (with password) is required'
      });
    }
    
    // Verify user exists
    const user = await User.findById(targetUserId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }
    
    // For team members: can add owner or admin
    // For direct admin creation: must be admin role
    if (email && user.role !== 'admin') {
      return res.status(400).json({
        success: false,
        message: 'Can only create admin users'
      });
    }
    
    // Add to team (for admin, we don't actually add to team, just create the user)
    // But we can track which owner created this admin
    let members;
    if (user.role === 'owner') {
      members = await OwnerTeam.addMember(id, targetUserId, req.userId, role);
    } else {
      // For admin users, we just return the created user
      // They will be assigned to branches as PIC, not team members
      members = [];
    }
    
    res.json({
      success: true,
      message: user.role === 'admin' ? 'Admin user created successfully' : 'Member added successfully',
      data: { 
        user: user.role === 'admin' ? {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
          created_at: user.created_at,
          updated_at: user.updated_at
        } : null,
        members: user.role === 'owner' ? members : []
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

// Remove member from team (owner only)
const removeMember = async (req, res, next) => {
  try {
    if (req.user.role !== 'owner') {
      return res.status(403).json({
        success: false,
        message: 'Only owners can remove team members'
      });
    }
    
    const { id, userId } = req.params;
    
    const team = await OwnerTeam.findById(id);
    if (!team) {
      return res.status(404).json({
        success: false,
        message: 'Team not found'
      });
    }
    
    // Check if user is primary owner
    if (team.primary_owner_id !== req.userId) {
      return res.status(403).json({
        success: false,
        message: 'Only primary owner can remove members'
      });
    }
    
    // Cannot remove primary owner
    if (parseInt(userId) === team.primary_owner_id) {
      return res.status(400).json({
        success: false,
        message: 'Cannot remove primary owner'
      });
    }
    
    const members = await OwnerTeam.removeMember(id, userId);
    
    res.json({
      success: true,
      message: 'Member removed successfully',
      data: { members }
    });
  } catch (error) {
    next(error);
  }
};

// Get team branches
const getBranches = async (req, res, next) => {
  try {
    const { id } = req.params;
    
    const team = await OwnerTeam.findById(id);
    if (!team) {
      return res.status(404).json({
        success: false,
        message: 'Team not found'
      });
    }
    
    // Check access
    const hasAccess = await OwnerTeam.userHasAccess(req.userId, id);
    if (!hasAccess) {
      return res.status(403).json({
        success: false,
        message: 'No access to this team'
      });
    }
    
    const branches = await Branch.findByTeam(id);
    
    res.json({
      success: true,
      data: { branches }
    });
  } catch (error) {
    next(error);
  }
};

// Update team (owner only)
const update = async (req, res, next) => {
  try {
    if (req.user.role !== 'owner') {
      return res.status(403).json({
        success: false,
        message: 'Only owners can update teams'
      });
    }
    
    const { id } = req.params;
    const { name } = req.body;
    
    const team = await OwnerTeam.findById(id);
    if (!team) {
      return res.status(404).json({
        success: false,
        message: 'Team not found'
      });
    }
    
    // Check if user is primary owner
    if (team.primary_owner_id !== req.userId) {
      return res.status(403).json({
        success: false,
        message: 'Only primary owner can update team'
      });
    }
    
    const updatedTeam = await OwnerTeam.update(id, { name });
    
    res.json({
      success: true,
      message: 'Team updated successfully',
      data: { team: updatedTeam }
    });
  } catch (error) {
    next(error);
  }
};

// Delete team (owner only)
const deleteTeam = async (req, res, next) => {
  try {
    if (req.user.role !== 'owner') {
      return res.status(403).json({
        success: false,
        message: 'Only owners can delete teams'
      });
    }
    
    const { id } = req.params;
    
    const team = await OwnerTeam.findById(id);
    if (!team) {
      return res.status(404).json({
        success: false,
        message: 'Team not found'
      });
    }
    
    // Check if user is primary owner
    if (team.primary_owner_id !== req.userId) {
      return res.status(403).json({
        success: false,
        message: 'Only primary owner can delete team'
      });
    }
    
    await OwnerTeam.delete(id);
    
    res.json({
      success: true,
      message: 'Team deleted successfully'
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getAll,
  getById,
  create,
  addMember,
  removeMember,
  getBranches,
  update,
  deleteTeam
};

