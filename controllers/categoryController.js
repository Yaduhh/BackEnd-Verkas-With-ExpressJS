const Category = require('../models/Category');
const LogService = require('../services/logService');

// Get all categories
const getAll = async (req, res, next) => {
  try {
    const {
      type,
      include_deleted = false,
      only_deleted = false,
      is_folder
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
      isFolder: is_folder !== undefined ? (is_folder === '1' || is_folder === 'true') : undefined
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
    const { name, type, is_folder } = req.body;
    
    // Get branchId from header or middleware (optional for categories)
    const branchId = req.branchId || req.headers['x-branch-id'] || null;
    
    // Check if category already exists (active)
    const existing = await Category.findAll({
      type,
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
      isFolder: is_folder === 1 || is_folder === true
    });
    
    // Log activity (only if branchId exists, because activity logs require branchId)
    if (branchId) {
      LogService.logActivity({
        userId: req.userId,
        action: 'create_category',
        entityType: 'category',
        entityId: category.id,
        branchId: parseInt(branchId),
        newValues: {
          name: category.name,
          type: category.type,
          is_folder: category.is_folder,
        },
        ipAddress: req.ip,
        userAgent: req.get('user-agent'),
        requestMethod: req.method,
        requestPath: req.path,
      }).catch(err => console.error('Error logging activity:', err));
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
    const { name, type, is_folder } = req.body;
    
    const existing = await Category.findById(id);
    if (!existing) {
      return res.status(404).json({
        success: false,
        message: 'Category not found'
      });
    }
    
    // Check ownership (user can only update their own categories)
    if (!existing.is_default && existing.user_id !== req.userId) {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }
    
    const category = await Category.update(id, { 
      name, 
      type, 
      is_folder: is_folder !== undefined ? (is_folder === 1 || is_folder === true) : undefined
    });
    
    // Calculate changes
    const changes = {};
    if (name !== undefined && existing.name !== name) {
      changes.name = { old: existing.name, new: name };
    }
    if (type !== undefined && existing.type !== type) {
      changes.type = { old: existing.type, new: type };
    }
    
    // Log activity (only if branchId exists)
    if (existing.branch_id) {
      LogService.logActivity({
        userId: req.userId,
        action: 'update_category',
        entityType: 'category',
        entityId: category.id,
        branchId: existing.branch_id,
        oldValues: {
          name: existing.name,
          type: existing.type,
          is_folder: existing.is_folder,
        },
        newValues: {
          name: category.name,
          type: category.type,
          is_folder: category.is_folder,
        },
        changes: Object.keys(changes).length > 0 ? changes : null,
        ipAddress: req.ip,
        userAgent: req.get('user-agent'),
        requestMethod: req.method,
        requestPath: req.path,
      }).catch(err => console.error('Error logging activity:', err));
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
    
    // Check ownership
    if (!existing.is_default && existing.user_id !== req.userId) {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }
    
    try {
      const result = await Category.softDelete(id);
      
      // Log activity (only if branchId exists)
      if (existing.branch_id) {
        LogService.logActivity({
          userId: req.userId,
          action: 'delete_category',
          entityType: 'category',
          entityId: existing.id,
          branchId: existing.branch_id,
          oldValues: {
            name: existing.name,
            type: existing.type,
            is_folder: existing.is_folder,
          },
          ipAddress: req.ip,
          userAgent: req.get('user-agent'),
          requestMethod: req.method,
          requestPath: req.path,
        }).catch(err => console.error('Error logging activity:', err));
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

module.exports = {
  getAll,
  getById,
  create,
  update,
  softDelete,
  restore,
  hardDelete
};

