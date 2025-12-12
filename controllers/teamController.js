const OwnerTeam = require('../models/OwnerTeam');
const User = require('../models/User');
const Branch = require('../models/Branch');

// Get all teams user is member of
const getAll = async (req, res, next) => {
  try {
    if (req.user.role !== 'owner' && req.user.role !== 'co-owner') {
      return res.status(403).json({
        success: false,
        message: 'Only owners and co-owners can access teams'
      });
    }
    
    // For co-owner, get teams from the owner who created them
    let teams;
    if (req.user.role === 'co-owner') {
      const User = require('../models/User');
      const user = await User.findById(req.userId);
      if (user && user.created_by) {
        // Get teams from the owner who created this co-owner
        teams = await OwnerTeam.findByUserId(user.created_by);
      } else {
        // Fallback: try to get teams from user's own access
        teams = await OwnerTeam.findByUserId(req.userId);
      }
    } else {
      // Owner: get their own teams
      teams = await OwnerTeam.findByUserId(req.userId);
    }
    
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

// Add member to team (owner and co-owner)
// Supports: 1) Add existing owner user by user_id, 2) Create new admin user
const addMember = async (req, res, next) => {
  try {
    if (req.user.role !== 'owner' && req.user.role !== 'co-owner') {
      return res.status(403).json({
        success: false,
        message: 'Only owners and co-owners can add team members'
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
    
    // Check if user has access to this team
    const hasAccess = await OwnerTeam.userHasAccess(req.userId, id);
    if (!hasAccess) {
      return res.status(403).json({
        success: false,
        message: 'No access to this team'
      });
    }
    
    // For co-owner: verify they can only add to team from the owner who created them
    if (req.user.role === 'co-owner') {
      const User = require('../models/User');
      const user = await User.findById(req.userId);
      if (user && user.created_by) {
        // Co-owner can only add members to teams where the creator is primary owner or member
        const creatorTeams = await OwnerTeam.findByUserId(user.created_by);
        const canAccessTeam = creatorTeams.some(t => t.id === parseInt(id));
        if (!canAccessTeam) {
          return res.status(403).json({
            success: false,
            message: 'Co-owner can only add members to teams from the owner who created them'
          });
        }
      }
    }
    
    let targetUserId = user_id;
    
    // If email provided, create new user (admin or owner)
    if (email && !user_id) {
      if (!password) {
        return res.status(400).json({
          success: false,
          message: 'Password is required when creating new user'
        });
      }
      
      // Validate role: only allow admin and co-owner to be created via ManageTeamScreen
      // Owner can only be created via self-registration (RegisterScreen)
      // Master is for developers only
      const allowedRoles = ['admin', 'co-owner'];
      if (!allowedRoles.includes(role)) {
        return res.status(400).json({
          success: false,
          message: `Role must be either "admin" or "co-owner". Owner can only be created via registration.`
        });
      }
      
      // Set userRole
      const userRole = role;
      
      // Check if email already exists
      const existing = await User.findByEmail(email);
      if (existing) {
        return res.status(409).json({
          success: false,
          message: 'Email already registered'
        });
      }
      
      // Create user (admin or owner) - track who created it
      const newUser = await User.create({
        email,
        password,
        name: name || null,
        role: userRole,
        createdBy: req.userId // Track which owner created this user
      });
      
      targetUserId = newUser.id;
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
    
    // Add to team based on role
    let members;
    if (user.role === 'owner' || user.role === 'co-owner') {
      // Owner and co-owner users are added to team as members
      members = await OwnerTeam.addMember(id, targetUserId, req.userId, user.role === 'co-owner' ? 'co-owner' : 'owner');
    } else if (user.role === 'admin') {
      // Admin users are not added to team, just created as user
      // They will be assigned to branches as PIC, not team members
      members = [];
    } else if (user.role === 'master') {
      // Master users are not added to team (developer only)
      members = [];
    } else {
      return res.status(400).json({
        success: false,
        message: 'Can only add owner, co-owner, or admin users to team'
      });
    }
    
    res.json({
      success: true,
      message: user.role === 'admin' ? 'Admin user created successfully' : 
               user.role === 'master' ? 'Master user created successfully' :
               (user.role === 'owner' || user.role === 'co-owner') ? `${user.role === 'co-owner' ? 'Co-owner' : 'Owner'} user created and added to team successfully` : 
               'Member added successfully',
      data: { 
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
          created_at: user.created_at,
          updated_at: user.updated_at
        },
        member: (user.role === 'owner' || user.role === 'co-owner') && members.length > 0 ? members[0] : null,
        members: (user.role === 'owner' || user.role === 'co-owner') ? members : []
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

// Remove member from team (owner and co-owner)
const removeMember = async (req, res, next) => {
  try {
    if (req.user.role !== 'owner' && req.user.role !== 'co-owner') {
      return res.status(403).json({
        success: false,
        message: 'Only owners and co-owners can remove team members'
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
    
    // Check if user has access to this team
    const hasAccess = await OwnerTeam.userHasAccess(req.userId, id);
    if (!hasAccess) {
      return res.status(403).json({
        success: false,
        message: 'No access to this team'
      });
    }
    
    // For co-owner: verify they can only remove from team from the owner who created them
    if (req.user.role === 'co-owner') {
      const User = require('../models/User');
      const user = await User.findById(req.userId);
      if (user && user.created_by) {
        const creatorTeams = await OwnerTeam.findByUserId(user.created_by);
        const canAccessTeam = creatorTeams.some(t => t.id === parseInt(id));
        if (!canAccessTeam) {
          return res.status(403).json({
            success: false,
            message: 'Co-owner can only remove members from teams from the owner who created them'
          });
        }
      }
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

