const User = require('../models/User');
const { query } = require('../config/database');
const { generateToken } = require('../middleware/auth');
const LogService = require('../services/logService');
const crypto = require('crypto');

// Login
const login = async (req, res, next) => {
  try {
    const { email, password } = req.body;

    // Find user
    const user = await User.findByEmail(email);
    if (!user) {
      // Log failed login attempt
      LogService.logSystem({
        level: 'warning',
        category: 'auth',
        message: 'Failed login attempt - email not found',
        context: {
          email: email,
        },
        ipAddress: req.ip,
        userAgent: req.get('user-agent'),
        requestMethod: req.method,
        requestPath: req.path,
      });

      return res.status(401).json({
        success: false,
        message: 'Email tidak ditemukan. Pastikan email yang Anda masukkan benar.'
      });
    }

    // Check maintenance mode in database
    const { query } = require('../config/database');
    try {
      const maintenanceResult = await query("SELECT value FROM system_settings WHERE `key` = 'maintenance_mode'");
      if (maintenanceResult.length > 0) {
        const isMaintenance = JSON.parse(maintenanceResult[0].value);
        const userRole = (user.role || '').toLowerCase().trim();
        
        console.log(`[Login Maintenance Check] Email: ${user.email}, Role: ${user.role}, isMaintenance: ${isMaintenance}`);
        
        if (isMaintenance && userRole !== 'master') {
          return res.status(503).json({
            success: false,
            message: 'VerKas sedang dalam pemeliharaan sistem terjadwal. Silakan coba beberapa saat lagi.'
          });
        }
      }
    } catch (dbErr) {
      console.error('[Login Maintenance Check Error]', dbErr);
    }

    // Verify password
    const isValid = await User.verifyPassword(password, user.password_hash);
    if (!isValid) {
      // Log failed login attempt
      LogService.logSystem({
        level: 'warning',
        category: 'auth',
        message: 'Failed login attempt - invalid password',
        context: {
          email: email,
        },
        ipAddress: req.ip,
        userAgent: req.get('user-agent'),
        requestMethod: req.method,
        requestPath: req.path,
      });

      return res.status(401).json({
        success: false,
        message: 'Sandi salah. Silakan periksa kembali sandi Anda.'
      });
    }

    // Determine if this is a web login
    // Usually Mobile sends 'platform' or its user-agent has 'Expo' or 'okhttp'
    const userAgent = req.get('user-agent') || '';
    const isMobileApp = req.body.platform === 'mobile' || userAgent.includes('Expo') || userAgent.includes('okhttp') || userAgent.includes('Dalvik');
    const isWeb = !isMobileApp;

    let webSessionToken = null;
    if (isWeb) {
      webSessionToken = crypto.randomUUID();
      await User.updateWebSessionToken(user.id, webSessionToken);
    }

    // Generate token
    const token = generateToken(user.id, webSessionToken);

    // Log successful login (no branchId needed for auth logs)
    // Note: Login doesn't have branchId, so we'll log to system_logs instead
    LogService.logSystem({
      level: 'info',
      category: 'auth',
      message: 'User logged in successfully',
      context: {
        user_id: user.id,
        email: user.email,
        role: user.role,
      },
      userId: user.id,
      ipAddress: req.ip,
      userAgent: req.get('user-agent'),
      requestMethod: req.method,
      requestPath: req.path,
    });

    // Return user data (without password)
    const { password_hash, status_deleted, deleted_at, ...userData } = user;

    res.json({
      success: true,
      data: {
        token,
        user: userData
      }
    });
  } catch (error) {
    next(error);
  }
};

// Get current user
const getMe = async (req, res, next) => {
  try {
    const user = await User.findById(req.userId);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    res.json({
      success: true,
      data: { user }
    });
  } catch (error) {
    next(error);
  }
};

// Register
const register = async (req, res, next) => {
  try {
    const { email, password, name, role = 'owner' } = req.body;

    // Check maintenance mode in database
    const { query } = require('../config/database');
    try {
      const maintenanceResult = await query("SELECT value FROM system_settings WHERE \`key\` = 'maintenance_mode'");
      if (maintenanceResult.length > 0) {
        const isMaintenance = JSON.parse(maintenanceResult[0].value);
        if (isMaintenance) {
          return res.status(503).json({
            success: false,
            message: 'VerKas sedang dalam pemeliharaan sistem terjadwal. Silakan coba beberapa saat lagi.'
          });
        }
      }
    } catch (dbErr) {
      // Ignore if table/setting doesn't exist yet
    }

    // Validate
    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Email and password are required'
      });
    }

    // Only allow owner role for self-registration
    // Co-owner, admin, and master must be created by existing owners
    const finalRole = role === 'owner' ? 'owner' : 'owner'; // Force owner for registration

    // Check if email already exists
    const existing = await User.findByEmail(email);
    if (existing) {
      return res.status(409).json({
        success: false,
        message: 'Email already registered'
      });
    }

    // Create user (always owner for self-registration)
    const user = await User.create({ email, password, name, role: finalRole });

    // Determine if this is a web registration
    const userAgent = req.get('user-agent') || '';
    const isMobileApp = req.body.platform === 'mobile' || userAgent.includes('Expo') || userAgent.includes('okhttp') || userAgent.includes('Dalvik');
    const isWeb = !isMobileApp;

    let webSessionToken = null;
    if (isWeb) {
      webSessionToken = crypto.randomUUID();
      await User.updateWebSessionToken(user.id, webSessionToken);
    }

    // Generate token
    const token = generateToken(user.id, webSessionToken);

    // Return user data (without password)
    const { password_hash, status_deleted, deleted_at, ...userData } = user;

    res.status(201).json({
      success: true,
      data: {
        token,
        user: userData
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

// Logout (client-side, just return success)
const logout = async (req, res, next) => {
  try {
    // Log logout
    if (req.userId) {
      LogService.logSystem({
        level: 'info',
        category: 'auth',
        message: 'User logged out',
        context: {
          user_id: req.userId,
        },
        userId: req.userId,
        ipAddress: req.ip,
        userAgent: req.get('user-agent'),
        requestMethod: req.method,
        requestPath: req.path,
      });

      // If it's a web logout, invalidate the web session token
      const userAgent = req.get('user-agent') || '';
      const isMobileApp = req.body.platform === 'mobile' || userAgent.includes('Expo') || userAgent.includes('okhttp') || userAgent.includes('Dalvik');
      if (!isMobileApp) {
        await User.updateWebSessionToken(req.userId, null);
      }
    }

    res.json({
      success: true,
      message: 'Logged out successfully'
    });
  } catch (error) {
    next(error);
  }
};

// Get all admin users (for PIC selection) & full team ecosystem users - owner and co-owner
const getAdmins = async (req, res, next) => {
  try {
    // Only owner and co-owner can get admin users list
    if (req.user.role !== 'owner' && req.user.role !== 'co-owner') {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Only owner and co-owner can view admin users.'
      });
    }

    const targetOwnerId = await User.resolveEcosystemOwnerId(req.userId);

    // Get admin users (for PIC dropdowns) and full ecosystem users (owner, co-owner, admin)
    const [admins, teamUsers] = await Promise.all([
      User.findAdminsByOwnerTeam(targetOwnerId),
      User.findTeamEcosystemUsers(targetOwnerId)
    ]);

    let bagiHasilApprovers = { approver_1_user_id: null, approver_2_user_id: null };
    try {
      const approverRows = await query(
        'SELECT approver_1_user_id, approver_2_user_id FROM bagi_hasil_approval_settings WHERE owner_id = ?',
        [targetOwnerId]
      );
      if (approverRows.length > 0) {
        bagiHasilApprovers = {
          approver_1_user_id: approverRows[0].approver_1_user_id || null,
          approver_2_user_id: approverRows[0].approver_2_user_id || null,
        };
      }
    } catch (e) {
      console.warn('Failed to fetch bagi_hasil_approval_settings:', e.message);
    }

    res.json({
      success: true,
      data: {
        users: req.query.include_all === 'true' ? teamUsers : admins,
        team_users: teamUsers,
        bagi_hasil_approvers: bagiHasilApprovers
      }
    });
  } catch (error) {
    next(error);
  }
};

// Update user role, permissions (can_create, can_edit, can_delete), or transfer ownership
const updateUserAccess = async (req, res, next) => {
  try {
    if (req.user.role !== 'owner' && req.user.role !== 'co-owner') {
      return res.status(403).json({
        success: false,
        message: 'Akses ditolak. Hanya Owner dan Co-Owner yang dapat mengatur hak akses pengguna.'
      });
    }

    const targetId = parseInt(req.params.id);
    if (isNaN(targetId)) {
      return res.status(400).json({ success: false, message: 'ID user tidak valid' });
    }

    const rootOwnerId = await User.resolveEcosystemOwnerId(req.userId);
    const ecosystemUsers = await User.findTeamEcosystemUsers(rootOwnerId);
    const targetUser = ecosystemUsers.find(u => u.id === targetId);

    if (!targetUser) {
      return res.status(404).json({
        success: false,
        message: 'Pengguna tidak ditemukan di dalam ekosistem tim Anda'
      });
    }

    const { role, can_create, can_edit, can_delete, name } = req.body;
    const OwnerTeam = require('../models/OwnerTeam');

    // CASE 1: Transfer Ownership (promoting a user to 'owner')
    if (role === 'owner' && targetUser.role !== 'owner') {
      const currentOwnerUser = ecosystemUsers.find(u => u.role === 'owner');
      const oldOwnerId = currentOwnerUser ? currentOwnerUser.id : rootOwnerId;
      const newOwnerId = targetUser.id;

      // 1. Update roles on users table
      await User.update(newOwnerId, {
        role: 'owner',
        createdBy: null,
        ...(name !== undefined ? { name } : {})
      });
      if (oldOwnerId && oldOwnerId !== newOwnerId) {
        await User.update(oldOwnerId, {
          role: 'co-owner',
          createdBy: newOwnerId
        });
      }

      // 2. Ensure a team exists and transfer primary_owner_id
      let teams = await OwnerTeam.findByUserId(oldOwnerId);
      if (teams.length === 0) {
        const createdTeam = await OwnerTeam.create({
          name: 'Default Team',
          primaryOwnerId: newOwnerId
        });
        teams = [createdTeam];
      } else {
        await query(
          'UPDATE owner_teams SET primary_owner_id = ? WHERE primary_owner_id = ?',
          [newOwnerId, oldOwnerId]
        );
      }

      for (const t of teams) {
        await OwnerTeam.addMember(t.id, newOwnerId, req.userId, 'owner');
        if (oldOwnerId && oldOwnerId !== newOwnerId) {
          await OwnerTeam.addMember(t.id, oldOwnerId, newOwnerId, 'co-owner');
          await query(
            'UPDATE owner_team_members SET role = ? WHERE team_id = ? AND user_id = ?',
            ['co-owner', t.id, oldOwnerId]
          );
        }
        await query(
          'UPDATE owner_team_members SET role = ? WHERE team_id = ? AND user_id = ?',
          ['owner', t.id, newOwnerId]
        );
      }

      // 3. Transfer branches, created_by references, subscriptions, and bagi_hasil_approval_settings
      if (oldOwnerId && oldOwnerId !== newOwnerId) {
        await query('UPDATE branches SET owner_id = ? WHERE owner_id = ?', [newOwnerId, oldOwnerId]);
        await query('UPDATE users SET created_by = ? WHERE created_by = ? AND id != ?', [newOwnerId, oldOwnerId, newOwnerId]);
        await query('DELETE FROM branch_pics WHERE user_id = ?', [newOwnerId]);

        try {
          await query('UPDATE subscriptions SET user_id = ? WHERE user_id = ?', [newOwnerId, oldOwnerId]);
        } catch (e) {}

        try {
          await query('UPDATE bagi_hasil_approval_settings SET owner_id = ? WHERE owner_id = ?', [newOwnerId, oldOwnerId]);
        } catch (e) {}
      }

      const [updatedTarget, updatedCurrentUser] = await Promise.all([
        User.findById(newOwnerId),
        User.findById(req.userId)
      ]);

      return res.json({
        success: true,
        message: `Peran Owner berhasil dipindahkan ke ${updatedTarget.name || updatedTarget.email}.`,
        data: {
          user: updatedTarget,
          current_user: updatedCurrentUser,
          transferred_ownership: true
        }
      });
    }

    // Prevent demoting the only Owner directly without picking a new Owner
    if (targetUser.role === 'owner' && role && role !== 'owner') {
      const otherCoOwner = ecosystemUsers.find(u => u.id !== targetUser.id && u.role === 'co-owner');
      if (!otherCoOwner) {
        return res.status(400).json({
          success: false,
          message: 'Harus ada minimal 1 Co-Owner untuk menggantikan posisi Owner Utama.'
        });
      }
      // Automatically promote the first Co-Owner to Owner when current Owner switches to Co-Owner/Admin
      const newOwnerId = otherCoOwner.id;
      const oldOwnerId = targetUser.id;
      await User.update(newOwnerId, { role: 'owner', createdBy: null });
      await User.update(oldOwnerId, { role, createdBy: newOwnerId });
      await query('UPDATE owner_teams SET primary_owner_id = ? WHERE primary_owner_id = ?', [newOwnerId, oldOwnerId]);
      await query('UPDATE branches SET owner_id = ? WHERE owner_id = ?', [newOwnerId, oldOwnerId]);
      await query('UPDATE users SET created_by = ? WHERE created_by = ? AND id != ?', [newOwnerId, oldOwnerId, newOwnerId]);
      try {
        await query('UPDATE subscriptions SET user_id = ? WHERE user_id = ?', [newOwnerId, oldOwnerId]);
      } catch (e) {}
      try {
        await query('UPDATE bagi_hasil_approval_settings SET owner_id = ? WHERE owner_id = ?', [newOwnerId, oldOwnerId]);
      } catch (e) {}

      const [updatedTarget, updatedCurrentUser] = await Promise.all([
        User.findById(oldOwnerId),
        User.findById(req.userId)
      ]);

      return res.json({
        success: true,
        message: `Peran berhasil diubah. ${otherCoOwner.name || otherCoOwner.email} kini menjadi Owner Utama.`,
        data: {
          user: updatedTarget,
          current_user: updatedCurrentUser,
          transferred_ownership: true
        }
      });
    }

    // CASE 2: Role change between 'admin' and 'co-owner'
    if (role && role !== targetUser.role && ['admin', 'co-owner'].includes(role)) {
      let teams = await OwnerTeam.findByUserId(rootOwnerId);
      if (teams.length === 0) {
        const createdTeam = await OwnerTeam.create({
          name: 'Default Team',
          primaryOwnerId: rootOwnerId
        });
        teams = [createdTeam];
      }

      if (role === 'co-owner') {
        for (const t of teams) {
          await OwnerTeam.addMember(t.id, targetId, req.userId, 'co-owner');
        }
        await query('DELETE FROM branch_pics WHERE user_id = ?', [targetId]);
      } else if (role === 'admin') {
        await query('DELETE FROM owner_team_members WHERE user_id = ?', [targetId]);
        await query(
          'UPDATE bagi_hasil_approval_settings SET approver_1_user_id = CASE WHEN approver_1_user_id = ? THEN NULL ELSE approver_1_user_id END, approver_2_user_id = CASE WHEN approver_2_user_id = ? THEN NULL ELSE approver_2_user_id END WHERE owner_id = ?',
          [targetId, targetId, rootOwnerId]
        );
      }
    }

    const updatedUser = await User.update(targetId, {
      name: name !== undefined ? name : undefined,
      role: role && ['admin', 'co-owner'].includes(role) ? role : undefined,
      createdBy: targetUser.role === 'owner' ? undefined : rootOwnerId,
      canCreate: can_create !== undefined ? can_create : undefined,
      canEdit: can_edit !== undefined ? can_edit : undefined,
      canDelete: can_delete !== undefined ? can_delete : undefined,
    });

    res.json({
      success: true,
      message: 'Hak akses & peran pengguna berhasil diperbarui',
      data: {
        user: updatedUser,
        transferred_ownership: false
      }
    });
  } catch (error) {
    next(error);
  }
};

// Update 2-Tier Bagi Hasil Approvers (Owner and Co-Owner)
const updateBagiHasilApprovers = async (req, res, next) => {
  try {
    if (req.user.role !== 'owner' && req.user.role !== 'co-owner') {
      return res.status(403).json({
        success: false,
        message: 'Hanya Owner dan Co-Owner yang dapat mengatur Approver 2 Tingkat untuk Bagi Hasil.'
      });
    }

    const rootOwnerId = await User.resolveEcosystemOwnerId(req.userId);
    const { approver_1_user_id, approver_2_user_id } = req.body;

    const app1 = approver_1_user_id ? parseInt(approver_1_user_id) : null;
    const app2 = approver_2_user_id ? parseInt(approver_2_user_id) : null;

    await User.ensurePermissionColumns();
    await query(
      `INSERT INTO bagi_hasil_approval_settings (owner_id, approver_1_user_id, approver_2_user_id)
       VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE approver_1_user_id = VALUES(approver_1_user_id), approver_2_user_id = VALUES(approver_2_user_id)`,
      [rootOwnerId, app1, app2]
    );

    res.json({
      success: true,
      message: 'Pengaturan Approver 2 Tingkat Bagi Hasil berhasil disimpan',
      data: {
        bagi_hasil_approvers: {
          approver_1_user_id: app1,
          approver_2_user_id: app2
        }
      }
    });
  } catch (error) {
    next(error);
  }
};

// Delete admin or co-owner user (soft delete) - owner and co-owner (only within own team)
const deleteAdmin = async (req, res, next) => {
  try {
    if (req.user.role !== 'owner' && req.user.role !== 'co-owner') {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Only owner and co-owner can delete users.'
      });
    }

    const targetOwnerId = await User.resolveEcosystemOwnerId(req.userId);
    const { id } = req.params;
    const targetId = parseInt(id);

    const teamUsers = await User.findTeamEcosystemUsers(targetOwnerId);
    const targetUser = teamUsers.find(a => a.id === targetId);

    if (!targetUser) {
      return res.status(404).json({
        success: false,
        message: 'User tidak ditemukan di dalam tim Anda'
      });
    }

    if (targetUser.role === 'owner') {
      return res.status(400).json({
        success: false,
        message: 'Akun Owner utama tidak dapat dihapus.'
      });
    }

    if (req.user.role === 'co-owner' && targetUser.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Co-Owner hanya dapat menghapus akun Admin Cabang.'
      });
    }

    await User.softDelete(targetId);
    await query('DELETE FROM branch_pics WHERE user_id = ?', [targetId]);
    await query('DELETE FROM owner_team_members WHERE user_id = ?', [targetId]);

    res.json({
      success: true,
      message: 'User berhasil dihapus'
    });
  } catch (error) {
    next(error);
  }
};

// Reset user password - owner and co-owner (only within own team)
const resetAdminPassword = async (req, res, next) => {
  try {
    if (req.user.role !== 'owner' && req.user.role !== 'co-owner') {
      return res.status(403).json({
        success: false,
        message: 'Access denied. Hanya owner atau co-owner yang dapat mereset password.'
      });
    }

    const { id } = req.params;
    const targetId = parseInt(id);
    const { newPassword } = req.body;

    if (!newPassword || newPassword.length < 6) {
      return res.status(400).json({
        success: false,
        message: 'Password baru minimal harus 6 karakter'
      });
    }

    const targetOwnerId = await User.resolveEcosystemOwnerId(req.userId);
    const teamUsers = await User.findTeamEcosystemUsers(targetOwnerId);
    const targetUser = teamUsers.find(a => a.id === targetId);

    if (!targetUser) {
      return res.status(404).json({
        success: false,
        message: 'User tidak ditemukan di dalam tim Anda'
      });
    }

    if (req.user.role === 'co-owner' && targetUser.role === 'owner') {
      return res.status(403).json({
        success: false,
        message: 'Co-Owner tidak dapat mereset password Owner utama.'
      });
    }

    await User.changePassword(targetId, newPassword);

    res.json({
      success: true,
      message: `Password ${targetUser.name || targetUser.email} berhasil direset`
    });
  } catch (error) {
    next(error);
  }
};

// Change password
const changePassword = async (req, res, next) => {
  try {
    const { oldPassword, newPassword } = req.body;

    if (!oldPassword || !newPassword) {
      return res.status(400).json({
        success: false,
        message: 'Kata sandi lama dan baru wajib diisi'
      });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({
        success: false,
        message: 'Kata sandi baru minimal harus 6 karakter'
      });
    }

    // Get current user details including password_hash
    const user = await User.findByEmail(req.user.email);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User tidak ditemukan'
      });
    }

    // Verify old password
    const isValid = await User.verifyPassword(oldPassword, user.password_hash);
    if (!isValid) {
      return res.status(400).json({
        success: false,
        message: 'Kata sandi lama salah'
      });
    }

    // Change password
    await User.changePassword(req.userId, newPassword);

    // Log change password action
    LogService.logSystem({
      level: 'info',
      category: 'auth',
      message: 'User changed password successfully',
      context: {
        user_id: req.userId,
        email: req.user.email
      },
      userId: req.userId,
      ipAddress: req.ip,
      userAgent: req.get('user-agent'),
      requestMethod: req.method,
      requestPath: req.path,
    });

    res.json({
      success: true,
      message: 'Kata sandi berhasil diubah'
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  login,
  register,
  getMe,
  logout,
  getAdmins,
  updateUserAccess,
  updateBagiHasilApprovers,
  deleteAdmin,
  resetAdminPassword,
  changePassword
};

