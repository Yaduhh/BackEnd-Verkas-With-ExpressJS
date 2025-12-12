const { query } = require('../config/database');
const User = require('./User');

class Branch {
  // Find by ID (include PICs and owner info)
  static async findById(id) {
    const results = await query(
      `SELECT b.*, 
              u_owner.name as owner_name, u_owner.email as owner_email
       FROM branches b
       LEFT JOIN users u_owner ON b.owner_id = u_owner.id
       WHERE b.id = ? AND b.status_deleted = false`,
      [id]
    );
    
    if (!results[0]) return null;
    
    const branch = results[0];
    
    // Get all PICs for this branch
    const pics = await query(
      `SELECT u.id, u.name, u.email
       FROM branch_pics bp
       INNER JOIN users u ON bp.user_id = u.id
       WHERE bp.branch_id = ? AND u.status_deleted = false
       ORDER BY u.name ASC, u.email ASC`,
      [id]
    );
    
    branch.pics = pics;
    // For backward compatibility, set pic_id and pic_name to first PIC if exists
    if (pics.length > 0) {
      branch.pic_id = pics[0].id;
      branch.pic_name = pics[0].name;
    } else {
      branch.pic_id = null;
      branch.pic_name = null;
    }
    
    return branch;
  }
  
  // Find all branches for owner
  static async findByOwner(ownerId, { includeDeleted = false } = {}) {
    let sql = `
      SELECT b.*
      FROM branches b
      WHERE b.owner_id = ?
    `;
    
    if (!includeDeleted) {
      sql += ' AND b.status_deleted = false';
    }
    
    sql += ' ORDER BY b.created_at DESC';
    
    const branches = await query(sql, [ownerId]);
    
    // Get PICs for each branch
    for (const branch of branches) {
      const pics = await query(
        `SELECT u.id, u.name, u.email
         FROM branch_pics bp
         INNER JOIN users u ON bp.user_id = u.id
         WHERE bp.branch_id = ? AND u.status_deleted = false
         ORDER BY u.name ASC, u.email ASC`,
        [branch.id]
      );
      branch.pics = pics;
      // For backward compatibility
      if (pics.length > 0) {
        branch.pic_id = pics[0].id;
        branch.pic_name = pics[0].name;
      } else {
        branch.pic_id = null;
        branch.pic_name = null;
      }
    }
    
    return branches;
  }
  
  // Find branch by PIC (admin) - returns first branch only (for backward compatibility)
  static async findByPIC(picId) {
    const results = await query(
      `SELECT b.*, 
              u_owner.name as owner_name, u_owner.email as owner_email
       FROM branches b
       LEFT JOIN users u_owner ON b.owner_id = u_owner.id
       INNER JOIN branch_pics bp ON b.id = bp.branch_id
       WHERE bp.user_id = ? AND b.status_deleted = false
       ORDER BY b.created_at DESC
       LIMIT 1`,
      [picId]
    );
    return results[0] || null;
  }
  
  // Find all branches by PIC (admin) - returns all branches where admin is PIC
  static async findAllByPIC(picId) {
    return await query(
      `SELECT b.*, 
              u_owner.name as owner_name, u_owner.email as owner_email
       FROM branches b
       LEFT JOIN users u_owner ON b.owner_id = u_owner.id
       INNER JOIN branch_pics bp ON b.id = bp.branch_id
       WHERE bp.user_id = ? AND b.status_deleted = false
       ORDER BY b.created_at DESC`,
      [picId]
    );
  }
  
  // Find branches by team
  static async findByTeam(teamId, { includeDeleted = false } = {}) {
    let sql = `
      SELECT b.*
      FROM branches b
      WHERE b.team_id = ?
    `;
    
    if (!includeDeleted) {
      sql += ' AND b.status_deleted = false';
    }
    
    sql += ' ORDER BY b.created_at DESC';
    
    const branches = await query(sql, [teamId]);
    
    // Get PICs for each branch
    for (const branch of branches) {
      const pics = await query(
        `SELECT u.id, u.name, u.email
         FROM branch_pics bp
         INNER JOIN users u ON bp.user_id = u.id
         WHERE bp.branch_id = ? AND u.status_deleted = false
         ORDER BY u.name ASC, u.email ASC`,
        [branch.id]
      );
      branch.pics = pics;
      // For backward compatibility
      if (pics.length > 0) {
        branch.pic_id = pics[0].id;
        branch.pic_name = pics[0].name;
      } else {
        branch.pic_id = null;
        branch.pic_name = null;
      }
    }
    
    return branches;
  }
  
  // Find all branches user has access to
  static async findByUserAccess(userId, userRole) {
    if (userRole === 'owner') {
      // Owner: get all their branches + team branches
      const ownerBranches = await this.findByOwner(userId);
      
      // Get team branches
      const OwnerTeam = require('./OwnerTeam');
      const teams = await OwnerTeam.findByUserId(userId);
      let teamBranches = [];
      
      for (const team of teams) {
        const branches = await this.findByTeam(team.id);
        teamBranches = teamBranches.concat(branches);
      }
      
      // Remove duplicates
      const allBranches = [...ownerBranches, ...teamBranches];
      const uniqueBranches = allBranches.filter((branch, index, self) => 
        index === self.findIndex(b => b.id === branch.id)
      );
      
      return uniqueBranches;
    } else if (userRole === 'co-owner') {
      // Co-owner: get branches from teams they're member of
      // Co-owner should be added to the same team as the owner who created them
      const OwnerTeam = require('./OwnerTeam');
      const User = require('./User');
      const currentUser = await User.findById(userId);
      
      let teamBranches = [];
      
      // Get teams co-owner is member of
      const teams = await OwnerTeam.findByUserId(userId);
      
      // Get branches from all teams co-owner is member of
      for (const team of teams) {
        const branches = await this.findByTeam(team.id);
        teamBranches = teamBranches.concat(branches);
      }
      
      // Also get branches from owner who created them (as fallback)
      // This ensures co-owner gets all branches even if team membership is missing
      if (currentUser && currentUser.created_by) {
        // Get branches from creator's teams
        const creatorTeams = await OwnerTeam.findByUserId(currentUser.created_by);
        
        for (const team of creatorTeams) {
          const branches = await this.findByTeam(team.id);
          teamBranches = teamBranches.concat(branches);
        }
        
        // FALLBACK: Also get branches where owner_id = created_by (for branches without team_id)
        // This handles cases where branches were created before team_id was implemented
        const ownerBranches = await this.findByOwner(currentUser.created_by);
        teamBranches = teamBranches.concat(ownerBranches);
      }
      
      // Remove duplicates
      const uniqueBranches = teamBranches.filter((branch, index, self) => 
        index === self.findIndex(b => b.id === branch.id)
      );
      
      return uniqueBranches;
    } else if (userRole === 'admin') {
      // Admin: get all branches where they are PIC
      return await this.findAllByPIC(userId);
    } else if (userRole === 'master') {
      // Master: get all branches (developer access)
      return await query('SELECT * FROM branches WHERE status_deleted = false ORDER BY created_at DESC');
    }
    
    return [];
  }
  
  // Create branch (owner only)
  static async create({ name, address, phone, ownerId, teamId = null, picId = null }) {
    const result = await query(
      `INSERT INTO branches (name, address, phone, owner_id, team_id, pic_id, status_active, status_deleted)
       VALUES (?, ?, ?, ?, ?, ?, true, false)`,
      [name, address || null, phone || null, ownerId, teamId, picId]
    );
    return await this.findById(result.insertId);
  }
  
  // Update branch (owner only)
  static async update(id, { name, address, phone, picId, statusActive }) {
    const updates = [];
    const params = [];
    
    if (name !== undefined) {
      updates.push('name = ?');
      params.push(name);
    }
    if (address !== undefined) {
      updates.push('address = ?');
      params.push(address || null);
    }
    if (phone !== undefined) {
      updates.push('phone = ?');
      params.push(phone || null);
    }
    if (picId !== undefined) {
      updates.push('pic_id = ?');
      params.push(picId || null);
    }
    if (statusActive !== undefined) {
      updates.push('status_active = ?');
      params.push(statusActive);
    }
    
    if (updates.length === 0) return await this.findById(id);
    
    params.push(id);
    await query(
      `UPDATE branches SET ${updates.join(', ')} WHERE id = ? AND status_deleted = false`,
      params
    );
    return await this.findById(id);
  }
  
  // Assign PIC (admin) to branch (owner only) - supports multiple PICs
  static async assignPIC(branchId, picId) {
    // Verify picId is admin role
    const pic = await User.findById(picId);
    if (!pic || pic.role !== 'admin') {
      throw new Error('PIC must be an admin user');
    }
    
    // Check if already assigned
    const existing = await query(
      'SELECT id FROM branch_pics WHERE branch_id = ? AND user_id = ?',
      [branchId, picId]
    );
    
    if (existing.length === 0) {
      // Insert new PIC assignment
      await query(
        'INSERT INTO branch_pics (branch_id, user_id) VALUES (?, ?)',
        [branchId, picId]
      );
    }
    
    return await this.findById(branchId);
  }
  
  // Remove PIC from branch (owner only)
  static async removePIC(branchId, picId = null) {
    if (picId) {
      // Remove specific PIC
      await query(
        'DELETE FROM branch_pics WHERE branch_id = ? AND user_id = ?',
        [branchId, picId]
      );
    } else {
      // Remove all PICs (for backward compatibility)
      await query(
        'DELETE FROM branch_pics WHERE branch_id = ?',
        [branchId]
      );
    }
    return await this.findById(branchId);
  }
  
  // Get all PICs for a branch
  static async getPICs(branchId) {
    return await query(
      `SELECT u.id, u.name, u.email, u.role
       FROM branch_pics bp
       INNER JOIN users u ON bp.user_id = u.id
       WHERE bp.branch_id = ? AND u.status_deleted = false
       ORDER BY u.name ASC, u.email ASC`,
      [branchId]
    );
  }
  
  // Set multiple PICs at once (replaces existing)
  static async setPICs(branchId, picIds) {
    // Remove all existing PICs
    await query('DELETE FROM branch_pics WHERE branch_id = ?', [branchId]);
    
    // Verify all picIds are admin role
    if (picIds && picIds.length > 0) {
      for (const picId of picIds) {
        const pic = await User.findById(picId);
        if (!pic || pic.role !== 'admin') {
          throw new Error(`User ${picId} must be an admin user`);
        }
      }
      
      // Insert new PICs
      for (const picId of picIds) {
        await query(
          'INSERT INTO branch_pics (branch_id, user_id) VALUES (?, ?)',
          [branchId, picId]
        );
      }
    }
    
    return await this.findById(branchId);
  }
  
  // Check if user has access to branch
  static async userHasAccess(userId, branchId, userRole) {
    const branch = await this.findById(branchId);
    if (!branch) return false;
    
    // Owner can access their own branches
    if (branch.owner_id === userId) return true;
    
    // PIC (admin) can access their assigned branch - check branch_pics table
    const picCheck = await query(
      'SELECT id FROM branch_pics WHERE branch_id = ? AND user_id = ?',
      [branchId, userId]
    );
    if (picCheck.length > 0) return true;
    
    // Team members can access team branches
    if (branch.team_id) {
      const OwnerTeam = require('./OwnerTeam');
      const hasAccess = await OwnerTeam.userHasAccess(userId, branch.team_id);
      if (hasAccess) return true;
    }
    
    // Co-owner: check if branch belongs to owner who created them (same team)
    if (userRole === 'co-owner') {
      const User = require('./User');
      const user = await User.findById(userId);
      if (user && user.created_by) {
        // Check if branch owner is the creator
        if (branch.owner_id === user.created_by) return true;
        
        // Check if branch is in same team as creator's team
        if (branch.team_id) {
          const OwnerTeam = require('./OwnerTeam');
          const creatorTeams = await OwnerTeam.findByUserId(user.created_by);
          if (creatorTeams.some(team => team.id === branch.team_id)) {
            return true;
          }
        }
      }
    }
    
    return false;
  }
  
  // Get branch for admin (their assigned branch)
  static async getAdminBranch(adminId) {
    return await this.findByPIC(adminId);
  }
  
  // Count branches for user
  static async countUserBranches(userId, userRole) {
    if (userRole === 'owner') {
      // Count individual branches
      const individual = await query(
        'SELECT COUNT(*) as count FROM branches WHERE owner_id = ? AND status_deleted = false',
        [userId]
      );
      
      // Count team branches
      const OwnerTeam = require('./OwnerTeam');
      const teams = await OwnerTeam.findByUserId(userId);
      let teamCount = 0;
      
      for (const team of teams) {
        const count = await query(
          'SELECT COUNT(*) as count FROM branches WHERE team_id = ? AND status_deleted = false',
          [team.id]
        );
        teamCount += count[0].count;
      }
      
      return individual[0].count + teamCount;
    } else if (userRole === 'co-owner') {
      // Co-owner: count branches from owner's team who created them
      const User = require('./User');
      const currentUser = await User.findById(userId);
      
      if (!currentUser || !currentUser.created_by) {
        // If no created_by, count from teams they're member of
        const OwnerTeam = require('./OwnerTeam');
        const teams = await OwnerTeam.findByUserId(userId);
        let teamCount = 0;
        
        for (const team of teams) {
          const count = await query(
            'SELECT COUNT(*) as count FROM branches WHERE team_id = ? AND status_deleted = false',
            [team.id]
          );
          teamCount += count[0].count;
        }
        
        return teamCount;
      }
      
      // Get teams from the owner who created this co-owner
      const OwnerTeam = require('./OwnerTeam');
      const creatorTeams = await OwnerTeam.findByUserId(currentUser.created_by);
      let teamCount = 0;
      
      for (const team of creatorTeams) {
        const count = await query(
          'SELECT COUNT(*) as count FROM branches WHERE team_id = ? AND status_deleted = false',
          [team.id]
        );
        teamCount += count[0].count;
      }
      
      // Also count from teams co-owner is direct member of
      const coOwnerTeams = await OwnerTeam.findByUserId(userId);
      for (const team of coOwnerTeams) {
        const count = await query(
          'SELECT COUNT(*) as count FROM branches WHERE team_id = ? AND status_deleted = false',
          [team.id]
        );
        teamCount += count[0].count;
      }
      
      return teamCount;
    } else if (userRole === 'admin') {
      // Admin: count all branches where they are PIC
      const branches = await this.findAllByPIC(userId);
      return branches.length;
    }
    
    return 0;
  }
  
  // Check if user can create more branches
  static async canCreateBranch(userId, userRole) {
    if (userRole !== 'owner' && userRole !== 'co-owner') {
      return false; // Only owners and co-owners can create branches
    }
    
    const Subscription = require('./Subscription');
    const subscription = await Subscription.getActiveSubscription(userId);
    
    if (!subscription) {
      // Free plan: check if already has 1 branch
      const count = await this.countUserBranches(userId, userRole);
      return count < 1;
    }
    
    const SubscriptionPlan = require('./SubscriptionPlan');
    const plan = await SubscriptionPlan.findById(subscription.plan_id);
    
    if (!plan || !plan.max_branches) {
      return true; // Unlimited
    }
    
    const count = await this.countUserBranches(userId, userRole);
    return count < plan.max_branches;
  }
  
  // Soft delete
  static async softDelete(id) {
    const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
    await query(
      'UPDATE branches SET status_deleted = true, deleted_at = ? WHERE id = ?',
      [now, id]
    );
    return { id, deleted_at: now };
  }
  
  // Restore
  static async restore(id) {
    await query(
      'UPDATE branches SET status_deleted = false, deleted_at = NULL WHERE id = ?',
      [id]
    );
    return await this.findById(id);
  }
  
  // Hard delete (permanent)
  static async hardDelete(id) {
    await query('DELETE FROM branches WHERE id = ?', [id]);
    return { id, deleted: true };
  }
}

module.exports = Branch;

