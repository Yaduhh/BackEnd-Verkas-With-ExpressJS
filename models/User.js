const { query } = require('../config/database');
const bcrypt = require('bcrypt');

class User {
  // Find by ID
  static async findById(id) {
    const results = await query(
      'SELECT id, email, name, role, created_at, updated_at FROM users WHERE id = ? AND status_deleted = false',
      [id]
    );
    return results[0] || null;
  }
  
  // Find by email (for login)
  static async findByEmail(email) {
    const results = await query(
      'SELECT * FROM users WHERE email = ? AND status_deleted = false',
      [email]
    );
    return results[0] || null;
  }
  
  // Create user
  static async create({ email, password, name, role = 'admin', createdBy = null }) {
    const passwordHash = await bcrypt.hash(password, 10);
    const result = await query(
      `INSERT INTO users (email, password_hash, name, role, status_deleted, created_by)
       VALUES (?, ?, ?, ?, false, ?)`,
      [email, passwordHash, name, role, createdBy]
    );
    return await this.findById(result.insertId);
  }
  
  // Update user
  static async update(id, { name, email, role }) {
    const updates = [];
    const params = [];
    
    if (name !== undefined) {
      updates.push('name = ?');
      params.push(name);
    }
    if (email !== undefined) {
      updates.push('email = ?');
      params.push(email);
    }
    if (role !== undefined) {
      updates.push('role = ?');
      params.push(role);
    }
    
    if (updates.length === 0) return await this.findById(id);
    
    params.push(id);
    await query(
      `UPDATE users SET ${updates.join(', ')} WHERE id = ? AND status_deleted = false`,
      params
    );
    return await this.findById(id);
  }
  
  // Soft delete
  static async softDelete(id) {
    const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
    await query(
      'UPDATE users SET status_deleted = true, deleted_at = ? WHERE id = ?',
      [now, id]
    );
    return { id, deleted_at: now };
  }
  
  // Restore
  static async restore(id) {
    await query(
      'UPDATE users SET status_deleted = false, deleted_at = NULL WHERE id = ?',
      [id]
    );
    return await this.findById(id);
  }
  
  // Hard delete (permanent)
  static async hardDelete(id) {
    await query('DELETE FROM users WHERE id = ?', [id]);
    return { id, deleted: true };
  }
  
  // Verify password
  static async verifyPassword(password, hash) {
    return await bcrypt.compare(password, hash);
  }
  
  // Change password
  static async changePassword(id, newPassword) {
    const passwordHash = await bcrypt.hash(newPassword, 10);
    await query(
      'UPDATE users SET password_hash = ? WHERE id = ? AND status_deleted = false',
      [passwordHash, id]
    );
    return true;
  }
  
  // Get all admin users (for PIC selection)
  static async findAllAdmins() {
    return await query(
      'SELECT id, email, name, role, created_at, updated_at FROM users WHERE role = ? AND status_deleted = false ORDER BY name ASC, email ASC',
      ['admin']
    );
  }
  
  // Get admin users by owner's team
  // Returns admin users that were created by this owner OR are assigned as PIC to owner's branches
  static async findAdminsByOwnerTeam(ownerId) {
    const OwnerTeam = require('./OwnerTeam');
    
    // Get owner's teams (teams where owner is primary_owner or member)
    const teams = await OwnerTeam.findByUserId(ownerId);
    const teamIds = teams.map(t => t.id);
    
    // Build query: get admins created by this owner OR admins that are PIC in owner's branches
    let sql = `
      SELECT DISTINCT u.id, u.email, u.name, u.role, u.created_at, u.updated_at
      FROM users u
      WHERE u.role = 'admin' 
      AND u.status_deleted = false
      AND (
        u.created_by = ?
    `;
    const params = [ownerId];
    
    // Also include admins that are PIC in branches owned by this owner or in owner's teams
    sql += ` OR u.id IN (
        SELECT DISTINCT b.pic_id
        FROM branches b
        WHERE b.status_deleted = false 
        AND b.pic_id IS NOT NULL
        AND (
          b.owner_id = ?
    `;
    params.push(ownerId);
    
    // Add team filter if owner has teams
    if (teamIds.length > 0) {
      sql += ` OR b.team_id IN (${teamIds.map(() => '?').join(',')})`;
      params.push(...teamIds);
    }
    
    sql += `)
      )
    )
      ORDER BY u.name ASC, u.email ASC`;
    
    return await query(sql, params);
  }
}

module.exports = User;

