const MitraPiutang = require('../models/MitraPiutang');
const LogService = require('../services/logService');
const Branch = require('../models/Branch');

// Get all mitra piutang
const getAll = async (req, res, next) => {
  try {
    const { include_deleted = false } = req.query;
    const branchId = req.branchId || req.headers['x-branch-id'];

    if (!branchId) {
      return res.status(400).json({
        success: false,
        message: 'Branch ID is required. Please provide X-Branch-Id header.'
      });
    }

    // Verify branch access
    const hasAccess = await Branch.userHasAccess(req.userId, parseInt(branchId), req.user.role);
    if (!hasAccess) {
      return res.status(403).json({
        success: false,
        message: 'No access to this branch'
      });
    }

    const mitraPiutang = await MitraPiutang.findAll({
      branchId: parseInt(branchId),
      includeDeleted: include_deleted === 'true'
    });

    res.json({
      success: true,
      data: { mitra_piutang: mitraPiutang }
    });
  } catch (error) {
    next(error);
  }
};

// Get mitra piutang by ID
const getById = async (req, res, next) => {
  try {
    const { id } = req.params;
    const branchId = req.branchId || req.headers['x-branch-id'];

    if (!branchId) {
      return res.status(400).json({
        success: false,
        message: 'Branch ID is required. Please provide X-Branch-Id header.'
      });
    }

    // Verify branch access
    const hasAccess = await Branch.userHasAccess(req.userId, parseInt(branchId), req.user.role);
    if (!hasAccess) {
      return res.status(403).json({
        success: false,
        message: 'No access to this branch'
      });
    }

    const mitraPiutang = await MitraPiutang.findById(parseInt(id), parseInt(branchId));

    if (!mitraPiutang) {
      return res.status(404).json({
        success: false,
        message: 'Mitra Piutang not found'
      });
    }

    res.json({
      success: true,
      data: { mitra_piutang: mitraPiutang }
    });
  } catch (error) {
    next(error);
  }
};

// Create mitra piutang
const create = async (req, res, next) => {
  try {
    const { nama } = req.body;
    const branchId = req.branchId || req.headers['x-branch-id'];

    if (!branchId) {
      return res.status(400).json({
        success: false,
        message: 'Branch ID is required. Please provide X-Branch-Id header.'
      });
    }

    if (!nama || !nama.trim()) {
      return res.status(400).json({
        success: false,
        message: 'Nama is required'
      });
    }

    // Verify branch access
    const hasAccess = await Branch.userHasAccess(req.userId, parseInt(branchId), req.user.role);
    if (!hasAccess) {
      return res.status(403).json({
        success: false,
        message: 'No access to this branch'
      });
    }

    const mitraPiutang = await MitraPiutang.create({
      branchId: parseInt(branchId),
      nama: nama.trim(),
      createdBy: req.userId
    });

    // Log activity
    LogService.logActivity({
      userId: req.userId,
      action: 'create_mitra_piutang',
      entityType: 'mitra_piutang',
      entityId: mitraPiutang.id,
      branchId: parseInt(branchId),
      newValues: {
        nama: mitraPiutang.nama
      },
      ipAddress: req.ip,
      userAgent: req.get('user-agent'),
      requestMethod: req.method,
      requestPath: req.path,
    });

    res.status(201).json({
      success: true,
      message: 'Mitra Piutang created successfully',
      data: { mitra_piutang: mitraPiutang }
    });
  } catch (error) {
    next(error);
  }
};

// Update mitra piutang
const update = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { nama } = req.body;
    const branchId = req.branchId || req.headers['x-branch-id'];

    if (!branchId) {
      return res.status(400).json({
        success: false,
        message: 'Branch ID is required. Please provide X-Branch-Id header.'
      });
    }

    // Verify branch access
    const hasAccess = await Branch.userHasAccess(req.userId, parseInt(branchId), req.user.role);
    if (!hasAccess) {
      return res.status(403).json({
        success: false,
        message: 'No access to this branch'
      });
    }

    const existing = await MitraPiutang.findById(parseInt(id), parseInt(branchId));
    if (!existing) {
      return res.status(404).json({
        success: false,
        message: 'Mitra Piutang not found'
      });
    }

    const mitraPiutang = await MitraPiutang.update(parseInt(id), parseInt(branchId), {
      nama: nama ? nama.trim() : undefined
    });

    // Log activity
    LogService.logActivity({
      userId: req.userId,
      action: 'update_mitra_piutang',
      entityType: 'mitra_piutang',
      entityId: mitraPiutang.id,
      branchId: parseInt(branchId),
      oldValues: {
        nama: existing.nama
      },
      newValues: {
        nama: mitraPiutang.nama
      },
      ipAddress: req.ip,
      userAgent: req.get('user-agent'),
      requestMethod: req.method,
      requestPath: req.path,
    });

    res.json({
      success: true,
      message: 'Mitra Piutang updated successfully',
      data: { mitra_piutang: mitraPiutang }
    });
  } catch (error) {
    next(error);
  }
};

// Delete mitra piutang (soft delete)
const deleteMitraPiutang = async (req, res, next) => {
  try {
    const { id } = req.params;
    const branchId = req.branchId || req.headers['x-branch-id'];

    if (!branchId) {
      return res.status(400).json({
        success: false,
        message: 'Branch ID is required. Please provide X-Branch-Id header.'
      });
    }

    // Verify branch access
    const hasAccess = await Branch.userHasAccess(req.userId, parseInt(branchId), req.user.role);
    if (!hasAccess) {
      return res.status(403).json({
        success: false,
        message: 'No access to this branch'
      });
    }

    const existing = await MitraPiutang.findById(parseInt(id), parseInt(branchId));
    if (!existing) {
      return res.status(404).json({
        success: false,
        message: 'Mitra Piutang not found'
      });
    }

    await MitraPiutang.delete(parseInt(id), parseInt(branchId));

    // Log activity
    LogService.logActivity({
      userId: req.userId,
      action: 'delete_mitra_piutang',
      entityType: 'mitra_piutang',
      entityId: parseInt(id),
      branchId: parseInt(branchId),
      oldValues: {
        nama: existing.nama
      },
      ipAddress: req.ip,
      userAgent: req.get('user-agent'),
      requestMethod: req.method,
      requestPath: req.path,
    });

    res.json({
      success: true,
      message: 'Mitra Piutang deleted successfully'
    });
  } catch (error) {
    next(error);
  }
};

// Restore mitra piutang
const restore = async (req, res, next) => {
  try {
    const { id } = req.params;
    const branchId = req.branchId || req.headers['x-branch-id'];

    if (!branchId) {
      return res.status(400).json({
        success: false,
        message: 'Branch ID is required. Please provide X-Branch-Id header.'
      });
    }

    // Verify branch access
    const hasAccess = await Branch.userHasAccess(req.userId, parseInt(branchId), req.user.role);
    if (!hasAccess) {
      return res.status(403).json({
        success: false,
        message: 'No access to this branch'
      });
    }

    const mitraPiutang = await MitraPiutang.restore(parseInt(id), parseInt(branchId));

    if (!mitraPiutang) {
      return res.status(404).json({
        success: false,
        message: 'Mitra Piutang not found'
      });
    }

    // Log activity
    LogService.logActivity({
      userId: req.userId,
      action: 'restore_mitra_piutang',
      entityType: 'mitra_piutang',
      entityId: mitraPiutang.id,
      branchId: parseInt(branchId),
      newValues: {
        nama: mitraPiutang.nama
      },
      ipAddress: req.ip,
      userAgent: req.get('user-agent'),
      requestMethod: req.method,
      requestPath: req.path,
    });

    res.json({
      success: true,
      message: 'Mitra Piutang restored successfully',
      data: { mitra_piutang: mitraPiutang }
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getAll,
  getById,
  create,
  update,
  delete: deleteMitraPiutang,
  restore
};

