const Category = require('../models/Category');
const Branch = require('../models/Branch');
const LogService = require('../services/logService');
const SavingsAllocation = require('../models/SavingsAllocation');

const getAll = async (req, res, next) => {
  try {
    const {
      type,
      include_deleted = false,
      only_deleted = false,
      is_folder,
      parent_id
    } = req.query;

    // Get branchId from header or middleware (optional for categories)
    const branchId = req.branchId || req.headers['x-branch-id'] || null;

    // Untuk kategori, filter berdasarkan branch_id, bukan user_id
    // Admin dan Owner harus melihat kategori sesuai branch yang dipilih
    const categories = await Category.findAll({
      type,
      userId: undefined, // Jangan filter by userId, karena kategori berdasarkan branch
      branchId: branchId ? parseInt(branchId) : null,
      includeDeleted: include_deleted === 'true',
      onlyDeleted: only_deleted === 'true',
      isFolder: is_folder !== undefined ? (is_folder === '1' || is_folder === 'true') : undefined,
      parentId: parent_id !== undefined ? parseInt(parent_id) : undefined
    });

    res.json({
      success: true,
      data: { categories }
    });
  } catch (error) {
    next(error);
  }
};

// Get category by ID
const getById = async (req, res, next) => {
  try {
    const { id } = req.params;
    const category = await Category.findById(id);

    if (!category) {
      return res.status(404).json({
        success: false,
        message: 'Category not found'
      });
    }

    res.json({
      success: true,
      data: { category }
    });
  } catch (error) {
    next(error);
  }
};

// Create category
const create = async (req, res, next) => {
  try {
    const { name, type = 'both', is_folder, parent_id, min_attachment } = req.body;

    // Get branchId from header or middleware (optional for categories)
    const branchId = req.branchId || req.headers['x-branch-id'] || null;

    // Check if category already exists (active) - check by name only, not type
    const existing = await Category.findAll({
      type: undefined, // Don't filter by type
      userId: req.userId,
      branchId: branchId ? parseInt(branchId) : null
    });
    const duplicate = existing.find(c => c.name === name && !c.status_deleted);

    if (duplicate) {
      return res.status(409).json({
        success: false,
        message: 'Category already exists'
      });
    }

    const category = await Category.create({
      name,
      type,
      userId: req.userId,
      branchId: branchId ? parseInt(branchId) : null,
      isDefault: false,
      isFolder: is_folder === 1 || is_folder === true,
      parentId: parent_id ? parseInt(parent_id) : null,
      minAttachment: min_attachment !== undefined ? parseInt(min_attachment) : 0
    });

    // Log activity (only if branchId exists, because activity logs require branchId)
    // Note: logActivity is fire-and-forget, no need to await or catch
    if (branchId) {
      LogService.logActivity({
        userId: req.userId,
        action: 'create_category',
        entityType: 'category',
        entityId: category.id,
        branchId: parseInt(branchId),
        newValues: {
          name: category.name,
          is_folder: category.is_folder,
          parent_id: category.parent_id,
          min_attachment: category.min_attachment,
        },
        ipAddress: req.ip,
        userAgent: req.get('user-agent'),
        requestMethod: req.method,
        requestPath: req.path,
      });
    }

    res.status(201).json({
      success: true,
      message: 'Category created successfully',
      data: { category }
    });
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({
        success: false,
        message: 'Category already exists'
      });
    }
    next(error);
  }
};

// Update category
const update = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { name, type, is_folder, parent_id, min_attachment } = req.body;

    const existing = await Category.findById(id);
    if (!existing) {
      return res.status(404).json({
        success: false,
        message: 'Category not found'
      });
    }

    // Check ownership or branch access (owner/co-owner of the branch can update any categories in that branch)
    if (!existing.is_default) {
      const hasAccess = existing.branch_id ? await Branch.userHasAccess(req.userId, existing.branch_id, req.user.role) : false;
      const isOwnerOrCoOwner = req.user.role === 'owner' || req.user.role === 'co-owner';
      
      if (existing.user_id !== req.userId && !(isOwnerOrCoOwner && hasAccess)) {
        return res.status(403).json({
          success: false,
          message: 'Access denied'
        });
      }
    }

    const category = await Category.update(id, {
      name,
      type,
      is_folder: is_folder !== undefined ? (is_folder === 1 || is_folder === true) : undefined,
      parent_id: parent_id !== undefined ? (parent_id ? parseInt(parent_id) : null) : undefined,
      min_attachment: min_attachment !== undefined ? parseInt(min_attachment) : undefined
    });

    // Calculate changes
    const changes = {};
    if (name !== undefined && existing.name !== name) {
      changes.name = { old: existing.name, new: name };
    }
    if (type !== undefined && existing.type !== type) {
      changes.type = { old: existing.type, new: type };
    }
    if (parent_id !== undefined && existing.parent_id !== parent_id) {
      changes.parent_id = { old: existing.parent_id, new: parent_id };
    }
    if (min_attachment !== undefined && existing.min_attachment !== min_attachment) {
      changes.min_attachment = { old: existing.min_attachment, new: min_attachment };
    }

    // Log activity (only if branchId exists)
    // Note: logActivity is fire-and-forget, no need to await or catch
    if (existing.branch_id) {
      LogService.logActivity({
        userId: req.userId,
        action: 'update_category',
        entityType: 'category',
        entityId: category.id,
        branchId: existing.branch_id,
        oldValues: {
          name: existing.name,
          is_folder: existing.is_folder,
          min_attachment: existing.min_attachment,
        },
        newValues: {
          name: category.name,
          is_folder: category.is_folder,
          parent_id: category.parent_id,
          min_attachment: category.min_attachment,
        },
        changes: Object.keys(changes).length > 0 ? changes : null,
        ipAddress: req.ip,
        userAgent: req.get('user-agent'),
        requestMethod: req.method,
        requestPath: req.path,
      });
    }

    res.json({
      success: true,
      message: 'Category updated successfully',
      data: { category }
    });
  } catch (error) {
    next(error);
  }
};

// Soft delete category
const softDelete = async (req, res, next) => {
  try {
    const { id } = req.params;

    const existing = await Category.findById(id);
    if (!existing) {
      return res.status(404).json({
        success: false,
        message: 'Category not found'
      });
    }

    // Check ownership or branch access (owner/co-owner of the branch can delete any categories in that branch)
    if (!existing.is_default) {
      const hasAccess = existing.branch_id ? await Branch.userHasAccess(req.userId, existing.branch_id, req.user.role) : false;
      const isOwnerOrCoOwner = req.user.role === 'owner' || req.user.role === 'co-owner';
      
      if (existing.user_id !== req.userId && !(isOwnerOrCoOwner && hasAccess)) {
        return res.status(403).json({
          success: false,
          message: 'Access denied'
        });
      }
    }

    try {
      const result = await Category.softDelete(id);

      // Log activity (only if branchId exists)
      // Note: logActivity is fire-and-forget, no need to await or catch
      if (existing.branch_id) {
        LogService.logActivity({
          userId: req.userId,
          action: 'delete_category',
          entityType: 'category',
          entityId: existing.id,
          branchId: existing.branch_id,
          oldValues: {
            name: existing.name,
            is_folder: existing.is_folder,
          },
          ipAddress: req.ip,
          userAgent: req.get('user-agent'),
          requestMethod: req.method,
          requestPath: req.path,
        });
      }

      res.json({
        success: true,
        message: 'Category deleted successfully',
        data: result
      });
    } catch (error) {
      if (error.message === 'Cannot delete default category') {
        return res.status(400).json({
          success: false,
          message: 'Cannot delete default category'
        });
      }
      throw error;
    }
  } catch (error) {
    next(error);
  }
};

// Restore category
const restore = async (req, res, next) => {
  try {
    const { id } = req.params;

    const existing = await Category.findById(id);
    if (!existing) {
      return res.status(404).json({
        success: false,
        message: 'Category not found'
      });
    }

    const category = await Category.restore(id);

    res.json({
      success: true,
      message: 'Category restored successfully',
      data: { category }
    });
  } catch (error) {
    next(error);
  }
};

// Hard delete (permanent, admin only)
const hardDelete = async (req, res, next) => {
  try {
    const { id } = req.params;

    const existing = await Category.findById(id);
    if (!existing) {
      return res.status(404).json({
        success: false,
        message: 'Category not found'
      });
    }

    try {
      const result = await Category.hardDelete(id);
      res.json({
        success: true,
        message: 'Category permanently deleted',
        data: result
      });
    } catch (error) {
      if (error.message === 'Cannot delete default category') {
        return res.status(400).json({
          success: false,
          message: 'Cannot delete default category'
        });
      }
      throw error;
    }
  } catch (error) {
    next(error);
  }
};

// Get savings account allocations
const getAllocations = async (req, res, next) => {
  try {
    const { id } = req.params;
    const branchId = req.branchId || req.headers['x-branch-id'] || null;

    const category = await Category.findById(id);
    if (!category) {
      return res.status(404).json({
        success: false,
        message: 'Category not found'
      });
    }

    const allocations = await SavingsAllocation.findAllByCategoryId(id, branchId ? parseInt(branchId) : null);

    res.json({
      success: true,
      data: allocations
    });
  } catch (error) {
    next(error);
  }
};

// Update savings account allocations
const updateAllocations = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { allocations } = req.body;

    if (!Array.isArray(allocations)) {
      return res.status(400).json({
        success: false,
        message: 'Allocations must be an array'
      });
    }

    const category = await Category.findById(id);
    if (!category) {
      return res.status(404).json({
        success: false,
        message: 'Category not found'
      });
    }

    await SavingsAllocation.updateAllocations(id, allocations);

    res.json({
      success: true,
      message: 'Allocations updated successfully'
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
  softDelete,
  restore,
  hardDelete,
  getAllocations,
  updateAllocations
};

