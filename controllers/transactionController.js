const Transaction = require('../models/Transaction');
const Category = require('../models/Category');

// Get all transactions
const getAll = async (req, res, next) => {
  try {
    const {
      type,
      category,
      start_date,
      end_date,
      sort = 'terbaru',
      include_deleted = false,
      only_deleted = false,
      page = 1,
      limit = 20
    } = req.query;
    
    // Get branch_id from header or middleware
    const branchId = req.branchId || req.headers['x-branch-id'];
    
    if (!branchId) {
      return res.status(400).json({
        success: false,
        message: 'Branch ID is required. Please provide X-Branch-Id header.'
      });
    }
    
    const transactions = await Transaction.findAll({
      userId: req.userId,
      branchId: parseInt(branchId),
      type,
      category,
      startDate: start_date,
      endDate: end_date,
      sort,
      includeDeleted: include_deleted === 'true',
      onlyDeleted: only_deleted === 'true',
      page: parseInt(page),
      limit: parseInt(limit)
    });
    
    const total = await Transaction.count({
      userId: req.userId,
      branchId: parseInt(branchId),
      type,
      category,
      startDate: start_date,
      endDate: end_date,
      includeDeleted: include_deleted === 'true',
      onlyDeleted: only_deleted === 'true'
    });
    
    res.json({
      success: true,
      data: {
        transactions,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          totalPages: Math.ceil(total / limit)
        }
      }
    });
  } catch (error) {
    next(error);
  }
};

// Get transaction by ID
const getById = async (req, res, next) => {
  try {
    const { id } = req.params;
    const transaction = await Transaction.findById(id);
    
    if (!transaction) {
      return res.status(404).json({
        success: false,
        message: 'Transaction not found'
      });
    }
    
    // Verify branch access
    const Branch = require('../models/Branch');
    const hasAccess = await Branch.userHasAccess(req.userId, transaction.branch_id, req.user.role);
    if (!hasAccess) {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }
    
    res.json({
      success: true,
      data: { transaction }
    });
  } catch (error) {
    next(error);
  }
};

// Create transaction
const create = async (req, res, next) => {
  try {
    const { type, category, amount, note, date, lampiran } = req.body;
    
    // Get branch_id from header or middleware
    const branchId = req.branchId || req.headers['x-branch-id'];
    
    if (!branchId) {
      return res.status(400).json({
        success: false,
        message: 'Branch ID is required. Please provide X-Branch-Id header.'
      });
    }
    
    // Verify branch access
    const Branch = require('../models/Branch');
    const hasAccess = await Branch.userHasAccess(req.userId, parseInt(branchId), req.user.role);
    if (!hasAccess) {
      return res.status(403).json({
        success: false,
        message: 'No access to this branch'
      });
    }
    
    // Find category by name
    const categoryRecord = await Category.findAll({
      type,
      userId: req.userId,
      branchId: parseInt(branchId)
    });
    const foundCategory = categoryRecord.find(c => c.name === category);
    
    if (!foundCategory) {
      return res.status(404).json({
        success: false,
        message: 'Category not found'
      });
    }
    
    // Handle lampiran - convert array to JSON string if needed
    let lampiranValue = null;
    if (lampiran) {
      if (Array.isArray(lampiran)) {
        // Store as JSON string
        lampiranValue = JSON.stringify(lampiran);
      } else {
        // Single value - store as string
        lampiranValue = lampiran;
      }
    }

    // Create transaction
    const transaction = await Transaction.create({
      userId: req.userId,
      branchId: parseInt(branchId),
      type,
      categoryId: foundCategory.id,
      amount: parseFloat(amount),
      note: note || null,
      transactionDate: date,
      lampiran: lampiranValue
    });
    
    res.status(201).json({
      success: true,
      message: 'Transaction created successfully',
      data: { transaction }
    });
  } catch (error) {
    next(error);
  }
};

// Update transaction
const update = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { type, category, amount, note, date } = req.body;
    
    // Check if transaction exists and belongs to user
    const existing = await Transaction.findById(id);
    if (!existing) {
      return res.status(404).json({
        success: false,
        message: 'Transaction not found'
      });
    }
    
    // Verify branch access
    const Branch = require('../models/Branch');
    const hasAccess = await Branch.userHasAccess(req.userId, existing.branch_id, req.user.role);
    if (!hasAccess) {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }
    
    // If admin, check if edit is accepted (edit_accepted = 2)
    if (req.user.role === 'admin') {
      if (existing.edit_accepted !== 2) {
        return res.status(403).json({
          success: false,
          message: 'Edit request belum disetujui oleh owner. Silakan ajukan permintaan edit terlebih dahulu.'
        });
      }
    }
    
    // Prepare update data
    const updateData = {};
    if (type !== undefined) updateData.type = type;
    if (amount !== undefined) updateData.amount = parseFloat(amount);
    if (note !== undefined) updateData.note = note;
    if (date !== undefined) updateData.transactionDate = date;
    if (req.body.lampiran !== undefined) updateData.lampiran = req.body.lampiran;
    
    // Handle category update
    if (category !== undefined) {
      const categoryRecord = await Category.findAll({
        type: type || existing.type,
        userId: req.userId,
        branchId: existing.branch_id
      });
      const foundCategory = categoryRecord.find(c => c.name === category);
      
      if (!foundCategory) {
        return res.status(404).json({
          success: false,
          message: 'Category not found'
        });
      }
      
      updateData.categoryId = foundCategory.id;
    }
    
    const transaction = await Transaction.update(id, updateData);
    
    // If admin successfully updated, clear edit request (edit_accepted = 2)
    if (req.user.role === 'admin' && existing.edit_accepted === 2) {
      await Transaction.clearEditRequest(id);
      // Reload transaction to get updated data
      const updatedTransaction = await Transaction.findById(id);
      return res.json({
        success: true,
        message: 'Transaction updated successfully',
        data: { transaction: updatedTransaction }
      });
    }
    
    res.json({
      success: true,
      message: 'Transaction updated successfully',
      data: { transaction }
    });
  } catch (error) {
    next(error);
  }
};

// Soft delete transaction
const softDelete = async (req, res, next) => {
  try {
    const { id } = req.params;
    
    const existing = await Transaction.findById(id);
    if (!existing) {
      return res.status(404).json({
        success: false,
        message: 'Transaction not found'
      });
    }
    
    // Verify branch access
    const Branch = require('../models/Branch');
    const hasAccess = await Branch.userHasAccess(req.userId, existing.branch_id, req.user.role);
    if (!hasAccess) {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }
    
    const result = await Transaction.softDelete(id);
    
    res.json({
      success: true,
      message: 'Transaction deleted successfully',
      data: result
    });
  } catch (error) {
    next(error);
  }
};

// Restore transaction
const restore = async (req, res, next) => {
  try {
    const { id } = req.params;
    
    const existing = await Transaction.findById(id);
    if (!existing) {
      return res.status(404).json({
        success: false,
        message: 'Transaction not found'
      });
    }
    
    // Verify branch access
    const Branch = require('../models/Branch');
    const hasAccess = await Branch.userHasAccess(req.userId, existing.branch_id, req.user.role);
    if (!hasAccess) {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }
    
    const transaction = await Transaction.restore(id);
    
    res.json({
      success: true,
      message: 'Transaction restored successfully',
      data: { transaction }
    });
  } catch (error) {
    next(error);
  }
};

// Hard delete (permanent, admin only)
const hardDelete = async (req, res, next) => {
  try {
    const { id } = req.params;
    
    const existing = await Transaction.findById(id);
    if (!existing) {
      return res.status(404).json({
        success: false,
        message: 'Transaction not found'
      });
    }
    
    // Verify branch access
    const Branch = require('../models/Branch');
    const hasAccess = await Branch.userHasAccess(req.userId, existing.branch_id, req.user.role);
    if (!hasAccess) {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }
    
    const result = await Transaction.hardDelete(id);
    
    res.json({
      success: true,
      message: 'Transaction permanently deleted',
      data: result
    });
  } catch (error) {
    next(error);
  }
};

// Request edit (admin only)
const requestEdit = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;
    
    // Only admin can request edit
    if (req.user.role !== 'admin') {
      return res.status(403).json({
        success: false,
        message: 'Hanya admin yang dapat mengajukan permintaan edit'
      });
    }
    
    if (!reason || reason.trim().length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Alasan edit wajib diisi'
      });
    }
    
    // Check if transaction exists
    const existing = await Transaction.findById(id);
    if (!existing) {
      return res.status(404).json({
        success: false,
        message: 'Transaction not found'
      });
    }
    
    // Verify branch access
    const Branch = require('../models/Branch');
    const hasAccess = await Branch.userHasAccess(req.userId, existing.branch_id, req.user.role);
    if (!hasAccess) {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }
    
    // Check if already has pending request (edit_accepted = 1)
    if (existing.edit_requested_by && existing.edit_requested_by === req.userId && existing.edit_accepted === 1) {
      return res.status(400).json({
        success: false,
        message: 'Anda sudah memiliki permintaan edit yang sedang menunggu persetujuan'
      });
    }
    
    const transaction = await Transaction.requestEdit(id, req.userId, reason.trim());
    
    res.json({
      success: true,
      message: 'Permintaan edit berhasil diajukan. Menunggu persetujuan owner.',
      data: { transaction }
    });
  } catch (error) {
    next(error);
  }
};

// Approve edit request (owner only)
const approveEdit = async (req, res, next) => {
  try {
    const { id } = req.params;
    
    // Only owner can approve
    if (req.user.role !== 'owner') {
      return res.status(403).json({
        success: false,
        message: 'Hanya owner yang dapat menyetujui permintaan edit'
      });
    }
    
    // Check if transaction exists
    const existing = await Transaction.findById(id);
    if (!existing) {
      return res.status(404).json({
        success: false,
        message: 'Transaction not found'
      });
    }
    
    // Verify branch access
    const Branch = require('../models/Branch');
    const hasAccess = await Branch.userHasAccess(req.userId, existing.branch_id, req.user.role);
    if (!hasAccess) {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }
    
    // Check if there's a pending request (edit_accepted = 1)
    if (!existing.edit_requested_by || existing.edit_accepted !== 1) {
      return res.status(400).json({
        success: false,
        message: 'Tidak ada permintaan edit yang menunggu persetujuan'
      });
    }
    
    const transaction = await Transaction.approveEdit(id);
    
    res.json({
      success: true,
      message: 'Permintaan edit berhasil disetujui',
      data: { transaction }
    });
  } catch (error) {
    next(error);
  }
};

// Reject edit request (owner only)
const rejectEdit = async (req, res, next) => {
  try {
    const { id } = req.params;
    
    // Only owner can reject
    if (req.user.role !== 'owner') {
      return res.status(403).json({
        success: false,
        message: 'Hanya owner yang dapat menolak permintaan edit'
      });
    }
    
    // Check if transaction exists
    const existing = await Transaction.findById(id);
    if (!existing) {
      return res.status(404).json({
        success: false,
        message: 'Transaction not found'
      });
    }
    
    // Verify branch access
    const Branch = require('../models/Branch');
    const hasAccess = await Branch.userHasAccess(req.userId, existing.branch_id, req.user.role);
    if (!hasAccess) {
      return res.status(403).json({
        success: false,
        message: 'Access denied'
      });
    }
    
    // Check if there's a pending request (edit_accepted = 1)
    if (!existing.edit_requested_by || existing.edit_accepted !== 1) {
      return res.status(400).json({
        success: false,
        message: 'Tidak ada permintaan edit yang menunggu persetujuan'
      });
    }
    
    const transaction = await Transaction.rejectEdit(id);
    
    res.json({
      success: true,
      message: 'Permintaan edit ditolak',
      data: { transaction }
    });
  } catch (error) {
    next(error);
  }
};

// Get edit requests
const getEditRequests = async (req, res, next) => {
  try {
    const { status = 'pending' } = req.query;
    
    // Get branch_id from header or middleware (optional for owner - can get from all branches)
    let branchId = req.branchId || req.headers['x-branch-id'];
    
    // For owner: if no branchId provided, get from all branches owned by user
    // For admin: if no branchId, get from their assigned branch(es)
    if (!branchId) {
      if (req.user.role === 'owner') {
        // Owner: get from all their branches (pass null to getEditRequests)
        branchId = null;
      } else if (req.user.role === 'admin') {
        // Admin: get from their assigned branch(es)
        const Branch = require('../models/Branch');
        const adminBranch = await Branch.findByPIC(req.userId);
        if (!adminBranch) {
          // Admin has no assigned branch, return empty array
          return res.json({
            success: true,
            data: { transactions: [] }
          });
        }
        // Admin has assigned branch, but we'll pass null to get from all branches they have access to
        branchId = null;
      } else {
        return res.status(400).json({
          success: false,
          message: 'Branch ID is required. Please provide X-Branch-Id header.'
        });
      }
    } else {
      branchId = parseInt(branchId);
    }
    
    const transactions = await Transaction.getEditRequests({
      userId: req.userId,
      branchId: branchId,
      userRole: req.user.role,
      status
    });
    
    res.json({
      success: true,
      data: { transactions }
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
  requestEdit,
  approveEdit,
  rejectEdit,
  getEditRequests
};

