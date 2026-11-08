const { query } = require('../config/database');
const bcrypt = require('bcrypt');

let _schemaEnsured = false;
let _schemaPromise = null;

const normalizePermissions = (row) => {
  if (!row) return null;
  return {
    ...row,
    can_create: row.can_create === 0 || row.can_create === false ? false : true,
    can_edit: row.can_edit === 0 || row.can_edit === false ? false : true,
    can_delete: row.can_delete === 0 || row.can_delete === false ? false : true,
  };
};

class User {
  static async ensurePermissionColumns() {
    if (_schemaEnsured) return;
    if (_schemaPromise) return _schemaPromise;

    _schemaPromise = (async () => {
      const alterStmts = [
        'ALTER TABLE users ADD COLUMN can_create TINYINT(1) NOT NULL DEFAULT 1',
        'ALTER TABLE users ADD COLUMN can_edit TINYINT(1) NOT NULL DEFAULT 1',
        'ALTER TABLE users ADD COLUMN can_delete TINYINT(1) NOT NULL DEFAULT 1',
      ];
      for (const stmt of alterStmts) {
        try {
          await query(stmt);
        } catch (err) {
          // Ignore ER_DUP_FIELDNAME if column already exists
        }
      }

      try {
        await query(`
          CREATE TABLE IF NOT EXISTS bagi_hasil_approval_settings (
            owner_id INT PRIMARY KEY,
            approver_1_user_id INT NULL,
            approver_2_user_id INT NULL,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
          )
        `);
      } catch (err) {
        console.warn('Warning ensuring bagi_hasil_approval_settings table:', err.message);
      }

      try {
        await query(`
          CREATE TABLE IF NOT EXISTS bagi_hasil_requests (
            id INT AUTO_INCREMENT PRIMARY KEY,
            branch_id INT NOT NULL,
            month INT NOT NULL,
            year INT NOT NULL,
            requested_by INT NOT NULL,
            old_bagi_hasil LONGTEXT NULL,
            new_bagi_hasil LONGTEXT NOT NULL,
            status VARCHAR(32) NOT NULL DEFAULT 'pending_level_1',
            approver_1_id INT NULL,
            approved_1_by INT NULL,
            approved_1_at DATETIME NULL,
            approver_2_id INT NULL,
            approved_2_by INT NULL,
            approved_2_at DATETIME NULL,
            rejected_by INT NULL,
            rejected_at DATETIME NULL,
            rejection_note TEXT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
            INDEX idx_branch_period (branch_id, month, year, status)
          )
        `);
      } catch (err) {
        console.warn('Warning ensuring bagi_hasil_requests table:', err.message);
      }

      _schemaEnsured = true;
    })();

    return _schemaPromise;
  }

  // Resolve primary owner ID of a user's team ecosystem
  static async resolveEcosystemOwnerId(userId) {
    await this.ensurePermissionColumns();
    const user = await this.findById(userId);
    if (!user) return userId;

    // 1. Check if user is primary owner of any active team
    const ownedTeams = await query(
      'SELECT id, primary_owner_id FROM owner_teams WHERE primary_owner_id = ? LIMIT 1',
      [userId]
    );
    if (ownedTeams.length > 0) {
      return ownedTeams[0].primary_owner_id;
    }

    // 2. Check if user is an active member of an owner_team
    const memberTeams = await query(
      `SELECT ot.primary_owner_id
       FROM owner_team_members otm
       JOIN owner_teams ot ON otm.team_id = ot.id
       WHERE otm.user_id = ? AND otm.status = 'active'
       ORDER BY ot.id ASC LIMIT 1`,
      [userId]
    );
    if (memberTeams.length > 0 && memberTeams[0].primary_owner_id) {
      return memberTeams[0].primary_owner_id;
    }

    // 3. Fallback to created_by for co-owner/admin
    if (user.role !== 'owner' && user.created_by) {
      return user.created_by;
    }

    return userId;
  }

  // Find by ID
  static async findById(id) {
    await this.ensurePermissionColumns();
    const results = await query(
      'SELECT id, email, name, role, created_by, can_create, can_edit, can_delete, created_at, updated_at, web_session_token FROM users WHERE id = ? AND status_deleted = false',
      [id]
    );
    return normalizePermissions(results[0] || null);
  }

  // Find by email (for login)
  static async findByEmail(email) {
    await this.ensurePermissionColumns();
    const results = await query(
      'SELECT * FROM users WHERE email = ? AND status_deleted = false',
      [email]
    );
    return normalizePermissions(results[0] || null);
  }

  // Create user
  static async create({ email, password, name, role = 'admin', createdBy = null, canCreate = true, canEdit = true, canDelete = true }) {
    await this.ensurePermissionColumns();
    const passwordHash = await bcrypt.hash(password, 10);
    const result = await query(
      `INSERT INTO users (email, password_hash, name, role, status_deleted, created_by, can_create, can_edit, can_delete)
       VALUES (?, ?, ?, ?, false, ?, ?, ?, ?)`,
      [
        email,
        passwordHash,
        name,
        role,
        createdBy,
        canCreate === false || canCreate === 0 ? 0 : 1,
        canEdit === false || canEdit === 0 ? 0 : 1,
        canDelete === false || canDelete === 0 ? 0 : 1,
      ]
    );
    return await this.findById(result.insertId);
  }

  // Update user
  static async update(id, { name, email, role, createdBy, canCreate, canEdit, canDelete }) {
    await this.ensurePermissionColumns();
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
    if (createdBy !== undefined) {
      updates.push('created_by = ?');
      params.push(createdBy);
    }
    if (canCreate !== undefined) {
      updates.push('can_create = ?');
      params.push(canCreate === false || canCreate === 0 ? 0 : 1);
    }
    if (canEdit !== undefined) {
      updates.push('can_edit = ?');
      params.push(canEdit === false || canEdit === 0 ? 0 : 1);
    }
    if (canDelete !== undefined) {
      updates.push('can_delete = ?');
      params.push(canDelete === false || canDelete === 0 ? 0 : 1);
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
  
  // Update web session token
  static async updateWebSessionToken(id, token) {
    await query(
      'UPDATE users SET web_session_token = ? WHERE id = ? AND status_deleted = false',
      [token, id]
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
  // Returns admin users that were created by this owner/co-owners in their team OR are assigned as PIC to owner's branches
  static async findAdminsByOwnerTeam(ownerId) {
    await this.ensurePermissionColumns();
    const OwnerTeam = require('./OwnerTeam');

    // Get owner's teams (teams where owner is primary_owner or member)
    const teams = await OwnerTeam.findByUserId(ownerId);
    const teamIds = teams.map(t => t.id);

    // Get all creator IDs in this owner's team ecosystem (owner, co-owners, primary owners)
    let creatorIds = [ownerId];
    if (teamIds.length > 0) {
      const memberRows = await query(
        `SELECT DISTINCT user_id FROM owner_team_members WHERE team_id IN (${teamIds.map(() => '?').join(',')}) AND status = 'active'`,
        teamIds
      );
      const teamOwners = await query(
        `SELECT DISTINCT primary_owner_id FROM owner_teams WHERE id IN (${teamIds.map(() => '?').join(',')})`,
        teamIds
      );
      creatorIds = [...new Set([
        ownerId,
        ...memberRows.map(m => m.user_id),
        ...teamOwners.map(t => t.primary_owner_id)
      ])];
    }

    // Build query: get admins created by this owner/team members OR admins that are PIC in owner's branches
    let sql = `
      SELECT DISTINCT u.id, u.email, u.name, u.role, u.created_by, u.can_create, u.can_edit, u.can_delete, u.created_at, u.updated_at
      FROM users u
      WHERE u.role = 'admin' 
      AND u.status_deleted = false
      AND (
        u.created_by IN (${creatorIds.map(() => '?').join(',')})
        OR u.id IN (
          SELECT DISTINCT bp.user_id
          FROM branch_pics bp
          JOIN branches b ON bp.branch_id = b.id
          WHERE b.status_deleted = false 
          AND (
            b.owner_id = ?
    `;
    const params = [...creatorIds, ownerId];

    // Add team filter if owner has teams
    if (teamIds.length > 0) {
      sql += ` OR b.team_id IN (${teamIds.map(() => '?').join(',')})`;
      params.push(...teamIds);
    }

    sql += `)
        )
      )
      ORDER BY u.name ASC, u.email ASC`;

    const rows = await query(sql, params);
    return rows.map(normalizePermissions);
  }

  // Get all ecosystem users (owner, co-owner, and admin) belonging to an owner's team ecosystem
  static async findTeamEcosystemUsers(ownerId) {
    await this.ensurePermissionColumns();
    const OwnerTeam = require('./OwnerTeam');

    const rootOwnerId = await this.resolveEcosystemOwnerId(ownerId);
    const teams = await OwnerTeam.findByUserId(rootOwnerId);
    const teamIds = teams.map(t => t.id);

    let ecosystemUserIds = [rootOwnerId];
    if (teamIds.length > 0) {
      const memberRows = await query(
        `SELECT DISTINCT user_id FROM owner_team_members WHERE team_id IN (${teamIds.map(() => '?').join(',')}) AND status = 'active'`,
        teamIds
      );
      const teamOwners = await query(
        `SELECT DISTINCT primary_owner_id FROM owner_teams WHERE id IN (${teamIds.map(() => '?').join(',')})`,
        teamIds
      );
      ecosystemUserIds = [...new Set([
        rootOwnerId,
        ...memberRows.map(m => m.user_id),
        ...teamOwners.map(t => t.primary_owner_id)
      ])];
    }

    // Also include any co-owners created by any ecosystem user
    const coOwnerRows = await query(
      `SELECT id FROM users WHERE role = 'co-owner' AND status_deleted = false AND created_by IN (${ecosystemUserIds.map(() => '?').join(',')})`,
      ecosystemUserIds
    );
    ecosystemUserIds = [...new Set([
      ...ecosystemUserIds,
      ...coOwnerRows.map(r => r.id)
    ])];

    let sql = `
      SELECT DISTINCT u.id, u.email, u.name, u.role, u.created_by, u.can_create, u.can_edit, u.can_delete, u.created_at, u.updated_at
      FROM users u
      WHERE u.status_deleted = false
      AND u.role IN ('owner', 'co-owner', 'admin')
      AND (
        u.id IN (${ecosystemUserIds.map(() => '?').join(',')})
        OR u.created_by IN (${ecosystemUserIds.map(() => '?').join(',')})
        OR u.id IN (
          SELECT DISTINCT bp.user_id
          FROM branch_pics bp
          JOIN branches b ON bp.branch_id = b.id
          WHERE b.status_deleted = false
          AND (
            b.owner_id IN (${ecosystemUserIds.map(() => '?').join(',')})
    `;
    const params = [...ecosystemUserIds, ...ecosystemUserIds, ...ecosystemUserIds];

    if (teamIds.length > 0) {
      sql += ` OR b.team_id IN (${teamIds.map(() => '?').join(',')})`;
      params.push(...teamIds);
    }

    sql += `)
        )
      )
      ORDER BY
        CASE u.role
          WHEN 'owner' THEN 1
          WHEN 'co-owner' THEN 2
          WHEN 'admin' THEN 3
          ELSE 4
        END ASC,
        u.name ASC, u.email ASC
    `;

    const rows = await query(sql, params);
    return rows.map(normalizePermissions);
  }
}

module.exports = User;

