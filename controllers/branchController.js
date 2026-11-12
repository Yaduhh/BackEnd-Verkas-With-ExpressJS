const Branch = require('../models/Branch');
const User = require('../models/User');
const SalesChannel = require('../models/SalesChannel');
const axios = require('axios');
const zlib = require('zlib');

// Get all branches user has access to
const getAll = async (req, res, next) => {
  try {
    const branches = await Branch.findByUserAccess(req.userId, req.user.role);
    
    // Determine the branch limit
    if (req.user.role === 'owner' || req.user.role === 'co-owner') {
      let targetUserId = req.userId;
      if (req.user.role === 'co-owner' && req.user.created_by) {
        targetUserId = req.user.created_by;
      }
      
      const Subscription = require('../models/Subscription');
      const subscription = await Subscription.getActiveSubscription(targetUserId);
      
      let maxBranches = 1;
      if (subscription) {
        maxBranches = subscription.max_branches;
      } else {
        const { query } = require('../config/database');
        try {
          const settingsResult = await query("SELECT value FROM system_settings WHERE `key` = 'default_branch_limit'");
          if (settingsResult && settingsResult.length > 0) {
            maxBranches = parseInt(JSON.parse(settingsResult[0].value)) || 1;
          }
        } catch (e) {
          console.warn('Failed to fetch default_branch_limit setting:', e.message);
        }
      }
      
      if (maxBranches !== null) {
        // Find branches owned by this owner
        let ownerBranches = branches.filter(b => b.owner_id === targetUserId);
        
        // Sort owner branches by created_at ASC (oldest first)
        ownerBranches.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
        
        // Map of branch ID to lock status
        const lockedBranchIds = new Set();
        ownerBranches.forEach((branch, index) => {
          if (index >= maxBranches) {
            lockedBranchIds.add(branch.id);
          }
        });
        
        // Attach is_locked property to branches
        branches.forEach(branch => {
          if (lockedBranchIds.has(branch.id)) {
            branch.is_locked = true;
          } else {
            branch.is_locked = false;
          }
        });
      } else {
        branches.forEach(branch => {
          branch.is_locked = false;
        });
      }
    } else {
      branches.forEach(branch => {
        branch.is_locked = false;
      });
    }

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

    // Check if the branch is locked due to subscription limit
    if (req.user.role === 'owner' || req.user.role === 'co-owner') {
      let targetUserId = req.userId;
      if (req.user.role === 'co-owner' && req.user.created_by) {
        targetUserId = req.user.created_by;
      }
      
      // Get all owner branches to determine lock status
      const allBranches = await Branch.findByOwner(targetUserId);
      allBranches.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
      
      const Subscription = require('../models/Subscription');
      const subscription = await Subscription.getActiveSubscription(targetUserId);
      
      let maxBranches = 1;
      if (subscription) {
        maxBranches = subscription.max_branches;
      } else {
        const { query } = require('../config/database');
        try {
          const settingsResult = await query("SELECT value FROM system_settings WHERE `key` = 'default_branch_limit'");
          if (settingsResult && settingsResult.length > 0) {
            maxBranches = parseInt(JSON.parse(settingsResult[0].value)) || 1;
          }
        } catch (e) {
          console.warn('Failed to fetch default_branch_limit setting:', e.message);
        }
      }
      
      if (maxBranches !== null) {
        const branchIndex = allBranches.findIndex(b => b.id === parseInt(id));
        if (branchIndex >= maxBranches) {
          return res.status(403).json({
            success: false,
            message: 'Buku kas ini terkunci karena batas limit cabang aktif terlampaui. Silakan upgrade paket langganan Anda.',
            code: 'BRANCH_LOCKED'
          });
        }
      }
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

      let maxBranches = 1;
      if (subscription) {
        maxBranches = subscription.max_branches;
      } else {
        const { query } = require('../config/database');
        try {
          const settingsResult = await query("SELECT value FROM system_settings WHERE `key` = 'default_branch_limit'");
          if (settingsResult && settingsResult.length > 0) {
            maxBranches = parseInt(JSON.parse(settingsResult[0].value)) || 1;
          }
        } catch (e) {
          console.warn('Failed to fetch default_branch_limit setting:', e.message);
        }
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

    const { name, code, group_name, address, phone, pic_id, pic_ids, team_id, require_edit_approval, require_delete_approval, require_attachment } = req.body;

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
      code,
      group_name,
      address,
      phone,
      ownerId: req.userId,
      teamId: finalTeamId,
      picId: picIds.length > 0 ? picIds[0] : null, // For backward compatibility
      requireEditApproval: require_edit_approval === true || require_edit_approval === 'true' || require_edit_approval === 1,
      requireDeleteApproval: require_delete_approval === true || require_delete_approval === 'true' || require_delete_approval === 1,
      requireAttachment: require_attachment === true || require_attachment === 'true' || require_attachment === 1
    });

    // Set multiple PICs if provided
    if (picIds.length > 0) {
      await Branch.setPICs(branch.id, picIds);
      // Reload branch to get PICs
      const updatedBranch = await Branch.findById(branch.id);
      branch.pics = updatedBranch.pics;
    }

    // Seed default sales channels for the new branch
    await SalesChannel.seedDefaults(branch.id);

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

    const { name, code, group_name, address, phone, pic_id, status_active, require_edit_approval, require_delete_approval, require_attachment } = req.body;

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
      code,
      group_name,
      address,
      phone,
      picId: pic_id,
      statusActive: status_active,
      requireEditApproval: require_edit_approval !== undefined ? (require_edit_approval === true || require_edit_approval === 'true' || require_edit_approval === 1) : undefined,
      requireDeleteApproval: require_delete_approval !== undefined ? (require_delete_approval === true || require_delete_approval === 'true' || require_delete_approval === 1) : undefined,
      requireAttachment: require_attachment !== undefined ? (require_attachment === true || require_attachment === 'true' || require_attachment === 1) : undefined
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

    let maxBranches = 1;
    if (subscription) {
      maxBranches = subscription.max_branches;
    } else {
      const { query } = require('../config/database');
      try {
        const settingsResult = await query("SELECT value FROM system_settings WHERE `key` = 'default_branch_limit'");
        if (settingsResult && settingsResult.length > 0) {
          maxBranches = parseInt(JSON.parse(settingsResult[0].value)) || 1;
        }
      } catch (e) {
        console.warn('Failed to fetch default_branch_limit setting:', e.message);
      }
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

// Assign branches to group (or remove from group if group_name is empty/null)
const assignGroup = async (req, res, next) => {
  try {
    const { branchIds, group_name } = req.body;
    if (!Array.isArray(branchIds) || branchIds.length === 0) {
      return res.status(400).json({ success: false, message: 'Daftar ID buku kas diperlukan' });
    }

    const { query } = require('../config/database');
    const accessibleBranches = await Branch.findByUserAccess(req.userId, req.user.role);
    const accessibleIds = accessibleBranches.map(b => b.id);

    const validIds = branchIds.filter(id => accessibleIds.includes(parseInt(id)));
    if (validIds.length === 0) {
      return res.status(403).json({ success: false, message: 'Tidak ada akses ke buku kas yang dipilih' });
    }

    const newGroupName = group_name && group_name.trim() ? group_name.trim() : null;
    const placeholders = validIds.map(() => '?').join(',');
    await query(
      `UPDATE branches SET group_name = ? WHERE id IN (${placeholders})`,
      [newGroupName, ...validIds]
    );

    res.json({
      success: true,
      message: newGroupName 
        ? `Berhasil menambahkan ${validIds.length} buku kas ke grup "${newGroupName}"`
        : `Berhasil mengeluarkan ${validIds.length} buku kas dari grup`
    });
  } catch (error) {
    next(error);
  }
};

// Rename a group across all accessible branches
const renameGroup = async (req, res, next) => {
  try {
    const { old_group_name, new_group_name } = req.body;
    if (!old_group_name || !old_group_name.trim()) {
      return res.status(400).json({ success: false, message: 'Nama grup lama diperlukan' });
    }
    if (!new_group_name || !new_group_name.trim()) {
      return res.status(400).json({ success: false, message: 'Nama grup baru diperlukan' });
    }

    const { query } = require('../config/database');
    const accessibleBranches = await Branch.findByUserAccess(req.userId, req.user.role);
    const accessibleIds = accessibleBranches.map(b => b.id);

    if (accessibleIds.length === 0) {
      return res.status(403).json({ success: false, message: 'Tidak ada akses' });
    }

    const placeholders = accessibleIds.map(() => '?').join(',');
    await query(
      `UPDATE branches SET group_name = ? WHERE group_name = ? AND id IN (${placeholders})`,
      [new_group_name.trim(), old_group_name.trim(), ...accessibleIds]
    );

    res.json({
      success: true,
      message: `Grup "${old_group_name}" berhasil diubah menjadi "${new_group_name}"`
    });
  } catch (error) {
    next(error);
  }
};

// Delete/dissolve a group (sets group_name = NULL for all branches in group)
const deleteGroup = async (req, res, next) => {
  try {
    const { groupName } = req.params;
    if (!groupName || !groupName.trim()) {
      return res.status(400).json({ success: false, message: 'Nama grup diperlukan' });
    }

    const { query } = require('../config/database');
    const accessibleBranches = await Branch.findByUserAccess(req.userId, req.user.role);
    const accessibleIds = accessibleBranches.map(b => b.id);

    if (accessibleIds.length === 0) {
      return res.status(403).json({ success: false, message: 'Tidak ada akses' });
    }

    const placeholders = accessibleIds.map(() => '?').join(',');
    await query(
      `UPDATE branches SET group_name = NULL WHERE group_name = ? AND id IN (${placeholders})`,
      [groupName.trim(), ...accessibleIds]
    );

    res.json({
      success: true,
      message: `Grup "${groupName}" berhasil dibubarkan (buku kas tidak dihapus, hanya dilepas dari grup)`
    });
  } catch (error) {
    next(error);
  }
};

// Proxy secure hutang attachment file from Bosgil Group (supports streaming with HMAC-SHA256 verification)
const proxyHutangFile = async (req, res, next) => {
  try {
    const { url, path: filePath, expires, sig } = req.query;
    const bosgilBaseUrl = (process.env.BOSGIL_API_BASE_URL || 'http://localhost:3001').replace(/\/+$/, '');

    let targetUrl = '';
    if (url) {
      if (url.startsWith('http://') || url.startsWith('https://')) {
        targetUrl = url;
      } else {
        targetUrl = `${bosgilBaseUrl}${url.startsWith('/') ? '' : '/'}${url}`;
      }
    } else if (filePath && expires && sig) {
      targetUrl = `${bosgilBaseUrl}/api/secure-file/view?path=${encodeURIComponent(filePath)}&expires=${expires}&sig=${sig}`;
    } else {
      return res.status(400).send('Parameter berkas tidak lengkap');
    }

    const fileRes = await axios.get(targetUrl, {
      responseType: 'stream',
      timeout: 15000,
      validateStatus: (status) => status < 400
    });

    if (fileRes.headers['content-type']) {
      res.setHeader('Content-Type', fileRes.headers['content-type']);
    }
    if (fileRes.headers['content-disposition']) {
      res.setHeader('Content-Disposition', fileRes.headers['content-disposition']);
    }
    res.setHeader('Cache-Control', 'public, max-age=3600');
    return fileRes.data.pipe(res);
  } catch (error) {
    console.error('Error proxying hutang file from Bosgil:', error?.message);
    return res.status(error?.response?.status || 500).send('Gagal memuat berkas');
  }
};

const hutangMicroCache = new Map();
const hutangInFlight = new Map();
const HUTANG_MICRO_TTL_MS = 4000;

const sendPossiblyGzippedJson = (req, res, payloadObj, preserializedBuf = null) => {
  const acceptEncoding = String(req.headers['accept-encoding'] || '');
  const jsonBuf = preserializedBuf || Buffer.from(JSON.stringify(payloadObj), 'utf8');
  if (acceptEncoding.includes('gzip') && jsonBuf.length > 1024) {
    return zlib.gzip(jsonBuf, { level: zlib.constants.Z_BEST_SPEED }, (err, compressed) => {
      if (err) return res.json(payloadObj);
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.setHeader('Content-Encoding', 'gzip');
      res.setHeader('Vary', 'Accept-Encoding');
      return res.send(compressed);
    });
  }
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  return res.send(jsonBuf);
};

// Get unpaid Purchasing Orders from Bosgil Group for this branch (Daftar Hutang)
const getHutang = async (req, res, next) => {
  try {
    const branchId = parseInt(req.params.id, 10);
    const { search, start_date, end_date, page = 1, limit = 5000, lite, po_id, refresh } = req.query;
    const isForceRefresh = refresh === '1' || refresh === 'true';
    const isLite = lite === '1' || lite === 'true';
    const cacheKey = `${branchId}|${search || ''}|${start_date || ''}|${end_date || ''}|${page}|${limit}|${isLite ? 1 : 0}|${po_id || ''}`;

    if (!isForceRefresh) {
      const cached = hutangMicroCache.get(cacheKey);
      if (cached && Date.now() - cached.ts < HUTANG_MICRO_TTL_MS) {
        return sendPossiblyGzippedJson(req, res, cached.payload, cached.jsonBuf);
      }
    }

    let fetchPromise = !isForceRefresh ? hutangInFlight.get(cacheKey) : null;
    if (!fetchPromise) {
      fetchPromise = (async () => {
        const bosgilBaseUrl = (process.env.BOSGIL_API_BASE_URL || 'http://localhost:3001').replace(/\/+$/, '');
        const response = await axios.get(`${bosgilBaseUrl}/api/verkas-integration/unpaid-pos`, {
          params: {
            branch_id: branchId,
            search: search || '',
            ...(start_date ? { start_date } : {}),
            ...(end_date ? { end_date } : {}),
            ...(isLite ? { lite: '1' } : {}),
            ...(po_id ? { po_id } : {}),
            page: parseInt(page, 10) || 1,
            limit: parseInt(limit, 10) || 5000
          },
          timeout: 15000
        });

        const payload = response.data;
        if (payload && Array.isArray(payload.data) && !isLite) {
          const rewriteList = (list) => {
            if (!Array.isArray(list) || list.length === 0) return [];
            return list.map(item => {
              if (!item || !item.url) return item;
              if (item.url.startsWith('/api/secure-file') || item.url.startsWith('/uploads')) {
                return {
                  ...item,
                  url: `/api/branches/hutang/file?url=${encodeURIComponent(item.url)}`
                };
              }
              return item;
            });
          };

          payload.data = payload.data.map(po => {
            if (po.details_loaded === false) return po;
            return {
              ...po,
              lampiran: rewriteList(po.lampiran),
              lampiran_approval: rewriteList(po.lampiran_approval),
              lampiran_bukti_potong: rewriteList(po.lampiran_bukti_potong),
              riwayat_angsuran: Array.isArray(po.riwayat_angsuran) && po.riwayat_angsuran.length > 0
                ? po.riwayat_angsuran.map(t => ({
                    ...t,
                    lampiran_approval: rewriteList(t.lampiran_approval)
                  }))
                : []
            };
          });
        }

        const jsonBuf = Buffer.from(JSON.stringify(payload), 'utf8');
        hutangMicroCache.set(cacheKey, { ts: Date.now(), payload, jsonBuf });
        if (hutangMicroCache.size > 40) {
          const firstKey = hutangMicroCache.keys().next().value;
          if (firstKey) hutangMicroCache.delete(firstKey);
        }
        return { payload, jsonBuf };
      })();

      if (!isForceRefresh) {
        hutangInFlight.set(cacheKey, fetchPromise);
      }
      fetchPromise.finally(() => {
        if (hutangInFlight.get(cacheKey) === fetchPromise) {
          hutangInFlight.delete(cacheKey);
        }
      }).catch(() => {});
    }

    const { payload, jsonBuf } = await fetchPromise;
    return sendPossiblyGzippedJson(req, res, payload, jsonBuf);
  } catch (error) {
    console.error('Error fetching branch hutang from Bosgil:', error?.message);
    return res.json({
      success: true,
      data: [],
      summary: {
        total_hutang: 0,
        total_siap_diproses: 0,
        total_belum_siap_diproses: 0,
        total_count: 0
      },
      message: 'Gagal memuat data hutang dari Bosgil: ' + (error?.response?.data?.message || error.message)
    });
  }
};

// Export branch hutang (unpaid POs) to styled .xlsx Excel matching active UI filters
const exportHutangExcel = async (req, res, next) => {
  try {
    const ExcelJS = require('exceljs');
    const branchId = parseInt(req.params.id, 10);

    const isPostItems = req.method === 'POST' && Array.isArray(req.body?.items);
    let rows = [];
    let branchName = req.body?.branchName || req.query.branch_name || '';
    let outletName = req.body?.outletName || req.query.outlet_name || '';
    const periodLabel = req.body?.periodLabel || req.query.period_label || 'Semua Periode';
    const activeTab = req.body?.activeTab || req.query.tab || 'Semua';
    const searchQuery = String(req.body?.searchQuery ?? req.query.search ?? '').trim();
    const sortOrder = req.body?.sortOrder || req.query.sort || 'date_desc';

    if (!branchName && branchId) {
      try {
        const b = await Branch.findById(branchId);
        if (b?.name) branchName = b.name;
      } catch (_) {}
    }

    if (isPostItems) {
      rows = req.body.items;
    } else {
      const { start_date, end_date } = req.query;
      const bosgilBaseUrl = (process.env.BOSGIL_API_BASE_URL || 'http://localhost:3001').replace(/\/+$/, '');
      const response = await axios.get(`${bosgilBaseUrl}/api/verkas-integration/unpaid-pos`, {
        params: {
          branch_id: branchId,
          ...(start_date ? { start_date } : {}),
          ...(end_date ? { end_date } : {}),
          page: 1,
          limit: 5000
        },
        timeout: 20000
      });

      const payload = response.data || {};
      if (!outletName && payload.branch?.outlet_name) {
        outletName = payload.branch.outlet_name;
      }
      const rawList = Array.isArray(payload.data) ? payload.data : [];

      const q = searchQuery.toLowerCase();
      const qDigits = q.replace(/[^\d]/g, '');

      rows = rawList.filter((po) => {
        if (start_date || end_date) {
          const dStr = po.tanggal ? String(po.tanggal).split('T')[0] : '';
          if (!dStr) return false;
          if (start_date && dStr < String(start_date)) return false;
          if (end_date && dStr > String(end_date)) return false;
        }

        if (activeTab === 'Siap' && po.siap_diproses !== true) return false;
        if (activeTab === 'BelumSiap' && po.siap_diproses !== false) return false;
        if (activeTab === 'Angsuran' && po.is_angsuran !== true) return false;

        if (!q) return true;
        const matchText =
          String(po.nomor_po || '').toLowerCase().includes(q) ||
          String(po.supplier?.nama_supplier || '').toLowerCase().includes(q) ||
          String(po.keterangan || '').toLowerCase().includes(q) ||
          String(po.status_label || '').toLowerCase().includes(q) ||
          String(po.creator?.nama || '').toLowerCase().includes(q);
        if (matchText) return true;
        if (qDigits.length >= 2) {
          return (
            String(Math.round(Number(po.nominal_awal) || 0)).includes(qDigits) ||
            String(Math.round(Number(po.sisa_hutang) || 0)).includes(qDigits)
          );
        }
        return false;
      });

      rows.sort((a, b) => {
        if (sortOrder === 'date_asc') {
          return new Date(a.tanggal).getTime() - new Date(b.tanggal).getTime();
        }
        if (sortOrder === 'amount_desc') {
          return (Number(b.sisa_hutang) || 0) - (Number(a.sisa_hutang) || 0);
        }
        if (sortOrder === 'amount_asc') {
          return (Number(a.sisa_hutang) || 0) - (Number(b.sisa_hutang) || 0);
        }
        return new Date(b.tanggal).getTime() - new Date(a.tanggal).getTime();
      });
    }

    const tabLabelMap = {
      Semua: 'Semua Tagihan',
      Siap: 'Siap Diproses (Antre Bayar)',
      BelumSiap: 'Belum Siap (Pending AP)',
      Angsuran: 'Angsuran'
    };
    const tabDisplay = tabLabelMap[activeTab] || activeTab || 'Semua Tagihan';

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'VerKas';
    workbook.created = new Date();

    const sheet = workbook.addWorksheet('Daftar Hutang PO', {
      views: [{ state: 'frozen', ySplit: 6, showGridLines: true }]
    });

    sheet.columns = [
      { key: 'no', width: 6 },
      { key: 'tanggal', width: 14 },
      { key: 'nomor_po', width: 21 },
      { key: 'supplier', width: 25 },
      { key: 'outlet', width: 18 },
      { key: 'kategori_status', width: 19 },
      { key: 'status_proses', width: 28 },
      { key: 'angsuran', width: 11 },
      { key: 'keterangan', width: 42 },
      { key: 'nominal_awal', width: 19 },
      { key: 'nominal_bupot', width: 19 },
      { key: 'nominal_terbayar', width: 19 },
      { key: 'sisa_hutang', width: 21 }
    ];

    // Row 1: Title
    sheet.mergeCells('A1:M1');
    const titleCell = sheet.getCell('A1');
    titleCell.value = 'DAFTAR HUTANG PURCHASING ORDER (PO)';
    titleCell.font = { name: 'Calibri', size: 13, bold: true, color: { argb: 'FF1E1B4B' } };
    titleCell.alignment = { vertical: 'middle', horizontal: 'left' };
    sheet.getRow(1).height = 24;

    // Row 2: Branch & Outlet
    sheet.mergeCells('A2:M2');
    const info1 = sheet.getCell('A2');
    info1.value = `Buku Kas / Cabang: ${branchName || '-'}${outletName ? `   |   Outlet Bosgil: ${outletName}` : ''}`;
    info1.font = { name: 'Calibri', size: 10, bold: true, color: { argb: 'FF334155' } };
    sheet.getRow(2).height = 18;

    // Row 3: Period
    sheet.mergeCells('A3:M3');
    const info2 = sheet.getCell('A3');
    info2.value = `Periode Filter: ${periodLabel}`;
    info2.font = { name: 'Calibri', size: 10, bold: true, color: { argb: 'FF4338CA' } };
    sheet.getRow(3).height = 18;

    // Row 4: Active Filter & Total Count
    sheet.mergeCells('A4:M4');
    const info3 = sheet.getCell('A4');
    info3.value = `Tab Status: ${tabDisplay}${searchQuery ? `   |   Pencarian: "${searchQuery}"` : ''}   |   Total Ditampilkan: ${rows.length} Tagihan`;
    info3.font = { name: 'Calibri', size: 10, color: { argb: 'FF475569' } };
    sheet.getRow(4).height = 18;

    // Row 5: Spacer
    sheet.getRow(5).height = 8;

    // Row 6: Table Headers
    const headerValues = [
      'No',
      'Tanggal PO',
      'Nomor PO',
      'Supplier',
      'Outlet',
      'Kategori Status',
      'Status Proses',
      'Angsuran',
      'Keterangan / Catatan',
      'Nominal Awal',
      'Potongan BUPOT',
      'Telah Dicicil',
      'Sisa Hutang'
    ];
    const headerRow = sheet.getRow(6);
    headerRow.values = headerValues;
    headerRow.height = 24;

    for (let col = 1; col <= 13; col++) {
      const cell = headerRow.getCell(col);
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FF4338CA' }
      };
      cell.font = {
        name: 'Calibri',
        size: 10,
        bold: true,
        color: { argb: 'FFFFFFFF' }
      };
      cell.alignment = {
        vertical: 'middle',
        horizontal: col >= 10 ? 'right' : col === 1 || col === 2 || col === 8 ? 'center' : 'left',
        wrapText: true
      };
      cell.border = {
        top: { style: 'thin', color: { argb: 'FF3730A3' } },
        bottom: { style: 'thin', color: { argb: 'FF3730A3' } },
        left: { style: 'thin', color: { argb: 'FF3730A3' } },
        right: { style: 'thin', color: { argb: 'FF3730A3' } }
      };
    }

    const currencyFmt = '"Rp"#,##0';
    let sumAwal = 0;
    let sumBupot = 0;
    let sumTerbayar = 0;
    let sumSisa = 0;

    rows.forEach((po, idx) => {
      const awal = Number(po.nominal_awal) || 0;
      const bupot = Number(po.nominal_bupot) || 0;
      const terbayar = Number(po.nominal_terbayar) || 0;
      const sisa = Number(po.sisa_hutang) || 0;

      sumAwal += awal;
      sumBupot += bupot;
      sumTerbayar += terbayar;
      sumSisa += sisa;

      const isSiap = Boolean(po.siap_diproses);
      const supplierName = po.supplier_name ?? po.supplier?.nama_supplier ?? '-';
      const outletLabel = po.outlet_name ?? po.outlet?.nama_outlet ?? outletName ?? '-';
      const statusProses = po.status_proses ?? po.status_label ?? (isSiap ? 'Siap Diproses' : 'Belum Siap');
      const dateStr = po.tanggal ? String(po.tanggal).split('T')[0] : '-';

      const r = sheet.addRow([
        idx + 1,
        dateStr,
        po.nomor_po || '-',
        supplierName || '-',
        outletLabel || '-',
        isSiap ? 'Siap Diproses' : 'Belum Siap (Pending AP)',
        statusProses,
        po.is_angsuran ? 'Ya' : 'Tidak',
        po.keterangan || '-',
        awal,
        bupot,
        terbayar,
        sisa
      ]);

      const isEven = idx % 2 === 1;
      for (let col = 1; col <= 13; col++) {
        const cell = r.getCell(col);
        cell.font = {
          name: 'Calibri',
          size: 10,
          bold: col === 3 || col === 13,
          color: {
            argb:
              col === 13
                ? 'FFE11D48'
                : col === 3
                ? 'FF4338CA'
                : col === 6
                ? isSiap
                  ? 'FF059669'
                  : 'FFD97706'
                : 'FF1E293B'
          }
        };
        if (isEven) {
          cell.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FFF8FAFC' }
          };
        }
        cell.alignment = {
          vertical: 'middle',
          horizontal: col >= 10 ? 'right' : col === 1 || col === 2 || col === 8 ? 'center' : 'left',
          wrapText: col === 9
        };
        if (col >= 10) {
          cell.numFmt = currencyFmt;
        }
        cell.border = {
          top: { style: 'thin', color: { argb: 'FFE2E8F0' } },
          bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } },
          left: { style: 'thin', color: { argb: 'FFE2E8F0' } },
          right: { style: 'thin', color: { argb: 'FFE2E8F0' } }
        };
      }
    });

    // Total Row
    const firstDataRow = 7;
    const lastDataRow = rows.length > 0 ? 6 + rows.length : 6;
    const totalRowIndex = lastDataRow + 1;
    const totalRow = sheet.getRow(totalRowIndex);
    totalRow.height = 24;

    sheet.mergeCells(`A${totalRowIndex}:I${totalRowIndex}`);
    const totalLabelCell = sheet.getCell(`A${totalRowIndex}`);
    totalLabelCell.value = `TOTAL DITAMPILKAN (${rows.length} TAGIHAN)`;

    if (rows.length > 0) {
      sheet.getCell(`J${totalRowIndex}`).value = { formula: `SUM(J${firstDataRow}:J${lastDataRow})`, result: sumAwal };
      sheet.getCell(`K${totalRowIndex}`).value = { formula: `SUM(K${firstDataRow}:K${lastDataRow})`, result: sumBupot };
      sheet.getCell(`L${totalRowIndex}`).value = { formula: `SUM(L${firstDataRow}:L${lastDataRow})`, result: sumTerbayar };
      sheet.getCell(`M${totalRowIndex}`).value = { formula: `SUM(M${firstDataRow}:M${lastDataRow})`, result: sumSisa };
    } else {
      sheet.getCell(`J${totalRowIndex}`).value = 0;
      sheet.getCell(`K${totalRowIndex}`).value = 0;
      sheet.getCell(`L${totalRowIndex}`).value = 0;
      sheet.getCell(`M${totalRowIndex}`).value = 0;
    }

    for (let col = 1; col <= 13; col++) {
      const cell = totalRow.getCell(col);
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFEEF2FF' }
      };
      cell.font = {
        name: 'Calibri',
        size: 10,
        bold: true,
        color: { argb: col === 13 ? 'FFE11D48' : 'FF1E1B4B' }
      };
      cell.alignment = {
        vertical: 'middle',
        horizontal: col >= 10 ? 'right' : 'left'
      };
      if (col >= 10) {
        cell.numFmt = currencyFmt;
      }
      cell.border = {
        top: { style: 'medium', color: { argb: 'FF4338CA' } },
        bottom: { style: 'double', color: { argb: 'FF4338CA' } },
        left: { style: 'thin', color: { argb: 'FFC7D2FE' } },
        right: { style: 'thin', color: { argb: 'FFC7D2FE' } }
      };
    }

    const safeBranch = String(branchName || 'Cabang').replace(/[^a-zA-Z0-9_-]/g, '_');
    const safePeriod = String(periodLabel || 'Semua_Periode').replace(/[^a-zA-Z0-9_-]/g, '_');
    const fileName = `Daftar_Hutang_PO_${safeBranch}_${safePeriod}.xlsx`;

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);

    await workbook.xlsx.write(res);
    res.end();
  } catch (error) {
    next(error);
  }
};

// Export branch hutang Recap by Supplier to PDF (matching classic Supplier Total sheet: Period -> NO | NAMA SUPPLIER | TOTAL HUTANG -> Yellow TOTAL)
const exportHutangPdf = async (req, res, next) => {
  try {
    const PDFDocument = require('pdfkit');
    const branchId = parseInt(req.params.id, 10);

    const isPostItems = req.method === 'POST' && Array.isArray(req.body?.items);
    let rows = [];
    let branchName = req.body?.branchName || req.query.branch_name || '';
    let outletName = req.body?.outletName || req.query.outlet_name || '';
    const periodLabel = req.body?.periodLabel || req.query.period_label || 'Semua Periode';
    const activeTab = req.body?.activeTab || req.query.tab || 'Semua';
    const searchQuery = String(req.body?.searchQuery ?? req.query.search ?? '').trim();

    if (!branchName && branchId) {
      try {
        const b = await Branch.findById(branchId);
        if (b?.name) branchName = b.name;
      } catch (_) {}
    }

    if (isPostItems) {
      rows = req.body.items;
    } else {
      const { start_date, end_date } = req.query;
      const bosgilBaseUrl = (process.env.BOSGIL_API_BASE_URL || 'http://localhost:3001').replace(/\/+$/, '');
      const response = await axios.get(`${bosgilBaseUrl}/api/verkas-integration/unpaid-pos`, {
        params: {
          branch_id: branchId,
          ...(start_date ? { start_date } : {}),
          ...(end_date ? { end_date } : {}),
          page: 1,
          limit: 5000
        },
        timeout: 20000
      });

      const payload = response.data || {};
      if (!outletName && payload.branch?.outlet_name) {
        outletName = payload.branch.outlet_name;
      }
      const rawList = Array.isArray(payload.data) ? payload.data : [];

      const q = searchQuery.toLowerCase();
      const qDigits = q.replace(/[^\d]/g, '');

      rows = rawList.filter((po) => {
        if (start_date || end_date) {
          const dStr = po.tanggal ? String(po.tanggal).split('T')[0] : '';
          if (!dStr) return false;
          if (start_date && dStr < String(start_date)) return false;
          if (end_date && dStr > String(end_date)) return false;
        }

        if (activeTab === 'Siap' && po.siap_diproses !== true) return false;
        if (activeTab === 'BelumSiap' && po.siap_diproses !== false) return false;
        if (activeTab === 'Angsuran' && po.is_angsuran !== true) return false;

        if (!q) return true;
        const matchText =
          String(po.nomor_po || '').toLowerCase().includes(q) ||
          String(po.supplier?.nama_supplier || '').toLowerCase().includes(q) ||
          String(po.keterangan || '').toLowerCase().includes(q) ||
          String(po.status_label || '').toLowerCase().includes(q) ||
          String(po.creator?.nama || '').toLowerCase().includes(q);
        if (matchText) return true;
        if (qDigits.length >= 2) {
          return (
            String(Math.round(Number(po.nominal_awal) || 0)).includes(qDigits) ||
            String(Math.round(Number(po.sisa_hutang) || 0)).includes(qDigits)
          );
        }
        return false;
      });
    }

    // Aggregate total hutang grouped by Supplier
    const supplierMap = new Map();
    let grandTotalHutang = 0;

    rows.forEach((po) => {
      const sisa = Number(po.sisa_hutang) || 0;
      grandTotalHutang += sisa;

      const rawName = String(po.supplier_name ?? po.supplier?.nama_supplier ?? '').trim();
      const hasSupplier = rawName && rawName !== '-';
      const key = hasSupplier ? rawName.toUpperCase() : '__NO_SUPPLIER__';

      let entry = supplierMap.get(key);
      if (!entry) {
        entry = {
          isUnassigned: !hasSupplier,
          supplierName: hasSupplier ? rawName.toUpperCase() : 'TANPA NAMA SUPPLIER',
          poCount: 0,
          totalHutang: 0
        };
        supplierMap.set(key, entry);
      }
      entry.poCount += 1;
      entry.totalHutang += sisa;
    });

    const supplierRows = Array.from(supplierMap.values()).sort((a, b) => {
      if (a.isUnassigned !== b.isUnassigned) return a.isUnassigned ? 1 : -1;
      return a.supplierName.localeCompare(b.supplierName, 'id');
    });

    // If there are unassigned POs, include PO count in label for clarity
    supplierRows.forEach((sr) => {
      if (sr.isUnassigned) {
        sr.supplierName = `TANPA NAMA SUPPLIER (${sr.poCount} PO)`;
      }
    });

    const safeBranch = String(branchName || 'Cabang').replace(/[^a-zA-Z0-9_-]/g, '_');
    const safePeriod = String(periodLabel || 'Semua_Periode').replace(/[^a-zA-Z0-9_-]/g, '_');
    const fileName = `Rekap_Hutang_Supplier_${safeBranch}_${safePeriod}.pdf`;

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);

    const doc = new PDFDocument({
      size: 'A4',
      margin: 30,
      info: {
        Title: `Rekap Hutang Supplier - ${branchName || 'Outlet'} (${periodLabel})`,
        Author: 'VerKas',
        Subject: 'Rekapitulasi Hutang Berdasarkan Supplier',
        Creator: 'VerKas Financial App'
      }
    });

    doc.pipe(res);

    const pageWidth = doc.page.width; // 595.28
    const pageHeight = doc.page.height; // 841.89
    const margin = 30;
    const tableWidth = pageWidth - margin * 2; // 535.28

    const colNoW = 55;
    const colTotalW = 155;
    const colSupplierW = tableWidth - colNoW - colTotalW; // 325.28

    const xNo = margin;
    const xSupplier = xNo + colNoW;
    const xTotal = xSupplier + colSupplierW;

    const fontRegular = 'Times-Roman';
    const fontBold = 'Times-Bold';
    const headerBlue = '#B8CCE4';
    const totalYellow = '#FFFF00';

    const formatIdNumber = (val) => {
      const rounded = Math.round(Number(val) || 0);
      if (rounded === 0) return '0';
      return new Intl.NumberFormat('id-ID').format(rounded);
    };

    const drawMoneyCell = (val, cellX, textY, cellW, isBold = false) => {
      const rounded = Math.round(Number(val) || 0);
      doc.font(isBold ? fontBold : fontRegular).fontSize(10).fillColor('#000000');
      if (rounded === 0) {
        doc.text('0', cellX + 8, textY, { width: cellW - 16, align: 'center', lineBreak: false });
      } else {
        doc.text('Rp', cellX + 8, textY, { lineBreak: false });
        doc.text(formatIdNumber(rounded), cellX + 24, textY, {
          width: cellW - 32,
          align: 'right',
          lineBreak: false
        });
      }
    };

    const tabLabelMap = {
      Semua: '',
      Siap: 'SIAP DIPROSES',
      BelumSiap: 'BELUM SIAP (PENDING AP)',
      Angsuran: 'ANGSURAN'
    };
    const subFilterParts = [];
    if (outletName || branchName) {
      subFilterParts.push(`OUTLET: ${String(outletName || branchName).toUpperCase()}`);
    }
    if (tabLabelMap[activeTab]) {
      subFilterParts.push(`STATUS: ${tabLabelMap[activeTab]}`);
    }
    if (searchQuery) {
      subFilterParts.push(`FILTER: "${searchQuery.toUpperCase()}"`);
    }

    let y = margin;

    if (subFilterParts.length > 0) {
      doc.font(fontBold).fontSize(9).fillColor('#334155');
      doc.text(subFilterParts.join('   •   '), margin, y, {
        width: tableWidth,
        align: 'left',
        lineBreak: false
      });
      y += 15;
    }

    const periodHeaderText = String(periodLabel || 'SEMUA PERIODE').toUpperCase();

    const drawTableHeaders = (startY) => {
      let curY = startY;
      const periodH = 22;
      const colHeaderH = 22;

      // Row 1: Merged Period Header (White background, bold centered uppercase)
      doc.rect(margin, curY, tableWidth, periodH).fillColor('#FFFFFF').fill();
      doc.strokeColor('#000000').lineWidth(0.9).rect(margin, curY, tableWidth, periodH).stroke();
      doc.font(fontBold).fontSize(10.5).fillColor('#000000');
      doc.text(periodHeaderText, margin, curY + 5.5, {
        width: tableWidth,
        align: 'center',
        lineBreak: false
      });
      curY += periodH;

      // Row 2: Column Headers (Light Steel Blue #B8CCE4)
      doc.rect(margin, curY, tableWidth, colHeaderH).fillColor(headerBlue).fill();
      doc.strokeColor('#000000').lineWidth(0.8).rect(margin, curY, tableWidth, colHeaderH).stroke();
      doc.moveTo(xSupplier, curY).lineTo(xSupplier, curY + colHeaderH).stroke();
      doc.moveTo(xTotal, curY).lineTo(xTotal, curY + colHeaderH).stroke();

      const headerTextY = curY + 5.5;
      doc.font(fontBold).fontSize(10).fillColor('#000000');
      doc.text('NO', xNo, headerTextY, { width: colNoW, align: 'center', lineBreak: false });
      doc.text('NAMA SUPPLIER', xSupplier, headerTextY, {
        width: colSupplierW,
        align: 'center',
        lineBreak: false
      });
      doc.text('TOTAL HUTANG', xTotal, headerTextY, {
        width: colTotalW,
        align: 'center',
        lineBreak: false
      });

      return curY + colHeaderH;
    };

    y = drawTableHeaders(y);

    // Supplier Data Rows
    supplierRows.forEach((sr, idx) => {
      doc.font(fontRegular).fontSize(10);
      const nameHeight = doc.heightOfString(sr.supplierName, { width: colSupplierW - 16 });
      const rowH = Math.max(20, nameHeight + 8);

      if (y + rowH > pageHeight - margin - 28) {
        doc.addPage();
        y = drawTableHeaders(margin);
      }

      doc.rect(margin, y, tableWidth, rowH).fillColor('#FFFFFF').fill();
      doc.strokeColor('#000000').lineWidth(0.6).rect(margin, y, tableWidth, rowH).stroke();
      doc.moveTo(xSupplier, y).lineTo(xSupplier, y + rowH).stroke();
      doc.moveTo(xTotal, y).lineTo(xTotal, y + rowH).stroke();

      const centerTextY = y + (rowH - 10) / 2;
      const supplierTextY = y + Math.max(4, (rowH - nameHeight) / 2);

      const noStr = String(idx + 1);
      doc.font(fontRegular).fontSize(10).fillColor('#000000');
      doc.text(noStr, xNo, centerTextY, { width: colNoW, align: 'center', lineBreak: false });
      doc.text(sr.supplierName, xSupplier + 8, supplierTextY, {
        width: colSupplierW - 16,
        align: 'left'
      });

      drawMoneyCell(sr.totalHutang, xTotal, centerTextY, colTotalW, false);

      y += rowH;
    });

    // Bottom Yellow TOTAL Row
    const totalRowH = 23;
    if (y + totalRowH > pageHeight - margin) {
      doc.addPage();
      y = drawTableHeaders(margin);
    }

    doc.rect(margin, y, tableWidth, totalRowH).fillColor(totalYellow).fill();
    doc.strokeColor('#000000').lineWidth(0.9).rect(margin, y, tableWidth, totalRowH).stroke();
    doc.moveTo(xTotal, y).lineTo(xTotal, y + totalRowH).stroke();

    const totalTextY = y + 6;
    doc.font(fontBold).fontSize(10.5).fillColor('#000000');
    doc.text('TOTAL', xNo, totalTextY, {
      width: colNoW + colSupplierW,
      align: 'center',
      lineBreak: false
    });

    drawMoneyCell(grandTotalHutang, xTotal, totalTextY, colTotalW, true);

    doc.end();
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
  checkLimit,
  assignGroup,
  renameGroup,
  deleteGroup,
  getHutang,
  exportHutangExcel,
  exportHutangPdf,
  proxyHutangFile
};


