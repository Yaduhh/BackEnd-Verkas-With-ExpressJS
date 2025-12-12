const { query } = require('../config/database');

class OwnerTeam {
  // Find by ID
  static async findById(id) {
    const results = await query(
      `SELECT t.*, u.name as primary_owner_name, u.email as primary_owner_email
       FROM owner_teams t
       LEFT JOIN users u ON t.primary_owner_id = u.id
       WHERE t.id = ?`,
      [id]
    );
    return results[0] || null;
  }
  
  // Find teams user is member of
  static async findByUserId(userId) {
    return await query(
      `SELECT DISTINCT t.*, 
              tm.role as user_role, tm.status as membership_status,
              u.name as primary_owner_name
       FROM owner_teams t
       JOIN owner_team_members tm ON t.id = tm.team_id
       LEFT JOIN users u ON t.primary_owner_id = u.id
       WHERE tm.user_id = ? AND tm.status = 'active'`,
      [userId]
    );
  }
  
  // Get team members
  static async getMembers(teamId) {
    return await query(
      `SELECT tm.id, tm.team_id, tm.user_id, tm.role as team_role, tm.status, tm.invited_by, tm.joined_at, tm.created_at,
              u.name as user_name, u.email as user_email, u.role as user_role
       FROM owner_team_members tm
       JOIN users u ON tm.user_id = u.id
       WHERE tm.team_id = ? AND tm.status = 'active'
       ORDER BY tm.role DESC, tm.joined_at ASC`,
      [teamId]
    );
  }
  
  // Create team
  static async create({ name, primaryOwnerId }) {
    const result = await query(
      `INSERT INTO owner_teams (name, primary_owner_id)
       VALUES (?, ?)`,
      [name, primaryOwnerId]
    );
    
    // Add primary owner as team member
    await this.addMember(result.insertId, primaryOwnerId, primaryOwnerId, 'owner');
    
    return await this.findById(result.insertId);
  }
  
  // Add member to team
  static async addMember(teamId, userId, invitedBy, role = 'member') {
    // Check if already member
    const existing = await query(
      'SELECT * FROM owner_team_members WHERE team_id = ? AND user_id = ?',
      [teamId, userId]
    );
    
    if (existing.length > 0) {
      // Update existing membership
      await query(
        `UPDATE owner_team_members 
         SET status = 'active', role = ?, joined_at = NOW() 
         WHERE team_id = ? AND user_id = ?`,
        [role, teamId, userId]
      );
    } else {
      // Create new membership
      await query(
        `INSERT INTO owner_team_members (team_id, user_id, role, status, invited_by, joined_at)
         VALUES (?, ?, ?, 'active', ?, NOW())`,
        [teamId, userId, role, invitedBy]
      );
    }
    
    return await this.getMembers(teamId);
  }
  
  // Remove member from team
  static async removeMember(teamId, userId) {
    await query(
      `UPDATE owner_team_members 
       SET status = 'removed' 
       WHERE team_id = ? AND user_id = ?`,
      [teamId, userId]
    );
    return await this.getMembers(teamId);
  }
  
  // Check if user has access to team
  static async userHasAccess(userId, teamId) {
    const team = await this.findById(teamId);
    if (!team) return false;
    
    // Primary owner has access
    if (team.primary_owner_id === userId) return true;
    
    // Check if user is active member
    const members = await query(
      'SELECT * FROM owner_team_members WHERE team_id = ? AND user_id = ? AND status = ?',
      [teamId, userId, 'active']
    );
    
    if (members.length > 0) return true;
    
    // Co-owner: check if team belongs to owner who created them
    const User = require('./User');
    const user = await User.findById(userId);
    if (user && user.role === 'co-owner' && user.created_by) {
      // Check if primary owner is the creator
      if (team.primary_owner_id === user.created_by) return true;
      
      // Check if creator is a member of this team
      const creatorMembers = await query(
        'SELECT * FROM owner_team_members WHERE team_id = ? AND user_id = ? AND status = ?',
        [teamId, user.created_by, 'active']
      );
      if (creatorMembers.length > 0) return true;
    }
    
    return false;
  }
  
  // Update team
  static async update(id, { name }) {
    if (name !== undefined) {
      await query(
        'UPDATE owner_teams SET name = ? WHERE id = ?',
        [name, id]
      );
    }
    return await this.findById(id);
  }
  
  // Delete team
  static async delete(id) {
    await query('DELETE FROM owner_teams WHERE id = ?', [id]);
    return { id, deleted: true };
  }
}

module.exports = OwnerTeam;

