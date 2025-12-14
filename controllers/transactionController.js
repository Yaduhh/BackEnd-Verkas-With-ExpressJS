const Transaction = require('../models/Transaction');
const Category = require('../models/Category');
const LogService = require('../services/logService');

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
    
    // JANGAN filter berdasarkan userId karena admin bisa input transaksi
    // Hanya filter berdasarkan branchId untuk mengambil semua transaksi di branch tersebut
    // Ensure page and limit are valid integers
    const validPage = parseInt(page) || 1;
    const validLimit = parseInt(limit) || 20;
    
    const transactions = await Transaction.findAll({
      branchId: parseInt(branchId),
      type,
      category,
      startDate: start_date,
      endDate: end_date,
      sort,
      includeDeleted: include_deleted === 'true',
      onlyDeleted: only_deleted === 'true',
      page: validPage,
      limit: validLimit
    });
    
    const total = await Transaction.count({
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
          page: validPage,
          limit: validLimit,
          total,
          totalPages: Math.ceil(total / validLimit)
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
    
    // Log activity (non-blocking, fire and forget)
    LogService.logActivity({
      userId: req.userId,
      action: 'create_transaction',
      entityType: 'transaction',
      entityId: transaction.id,
      branchId: parseInt(branchId),
      newValues: {
        type: transaction.type,
        amount: transaction.amount,
        category: category,
        note: transaction.note,
        date: transaction.transaction_date,
      },
      ipAddress: req.ip,
      userAgent: req.get('user-agent'),
      requestMethod: req.method,
      requestPath: req.path,
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
    
    // Calculate changes for logging
    const changes = {};
    if (amount !== undefined && existing.amount !== parseFloat(amount)) {
      changes.amount = { old: existing.amount, new: parseFloat(amount) };
    }
    if (category !== undefined && existing.category_name !== category) {
      changes.category = { old: existing.category_name, new: category };
    }
    if (note !== undefined && existing.note !== note) {
      changes.note = { old: existing.note, new: note };
    }
    if (date !== undefined && existing.transaction_date !== date) {
      changes.date = { old: existing.transaction_date, new: date };
    }
    
    // If admin successfully updated, clear edit request (edit_accepted = 2)
    if (req.user.role === 'admin' && existing.edit_accepted === 2) {
      await Transaction.clearEditRequest(id);
      // Reload transaction to get updated data
      const updatedTransaction = await Transaction.findById(id);
      
      // Log activity
      LogService.logActivity({
        userId: req.userId,
        action: 'update_transaction',
        entityType: 'transaction',
        entityId: transaction.id,
        branchId: existing.branch_id,
        oldValues: {
          amount: existing.amount,
          category: existing.category_name,
          note: existing.note,
          date: existing.transaction_date,
        },
        newValues: {
          amount: updatedTransaction.amount,
          category: updatedTransaction.category_name,
          note: updatedTransaction.note,
          date: updatedTransaction.transaction_date,
        },
        changes: Object.keys(changes).length > 0 ? changes : null,
        ipAddress: req.ip,
        userAgent: req.get('user-agent'),
        requestMethod: req.method,
        requestPath: req.path,
      });
      
      return res.json({
        success: true,
        message: 'Transaction updated successfully',
        data: { transaction: updatedTransaction }
      });
    }
    
    // Log activity
    LogService.logActivity({
      userId: req.userId,
      action: 'update_transaction',
      entityType: 'transaction',
      entityId: transaction.id,
      branchId: existing.branch_id,
      oldValues: {
        amount: existing.amount,
        category: existing.category_name,
        note: existing.note,
        date: existing.transaction_date,
      },
      newValues: {
        amount: transaction.amount,
        category: transaction.category_name,
        note: transaction.note,
        date: transaction.transaction_date,
      },
      changes: Object.keys(changes).length > 0 ? changes : null,
      ipAddress: req.ip,
      userAgent: req.get('user-agent'),
      requestMethod: req.method,
      requestPath: req.path,
    });
    
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
    
    // Log activity
    LogService.logActivity({
      userId: req.userId,
      action: 'delete_transaction',
      entityType: 'transaction',
      entityId: existing.id,
      branchId: existing.branch_id,
      oldValues: {
        type: existing.type,
        amount: existing.amount,
        category: existing.category_name,
        note: existing.note,
        date: existing.transaction_date,
      },
      ipAddress: req.ip,
      userAgent: req.get('user-agent'),
      requestMethod: req.method,
      requestPath: req.path,
    });
    
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
    
    const result = await Transaction.restore(id);
    
    // Reload transaction to get updated data
    const restoredTransaction = await Transaction.findById(id);
    
    // Log activity
    LogService.logActivity({
      userId: req.userId,
      action: 'restore_transaction',
      entityType: 'transaction',
      entityId: existing.id,
      branchId: existing.branch_id,
      newValues: {
        type: restoredTransaction.type,
        amount: restoredTransaction.amount,
        category: restoredTransaction.category_name,
        note: restoredTransaction.note,
        date: restoredTransaction.transaction_date,
      },
      ipAddress: req.ip,
      userAgent: req.get('user-agent'),
      requestMethod: req.method,
      requestPath: req.path,
    });
    
    res.json({
      success: true,
      message: 'Transaction restored successfully',
      data: { transaction: result }
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
    
    // Send notification to branch owner + team owners (if branch belongs to a team)
    try {
      const expoPushService = require('../services/expoPushService');
      const Branch = require('../models/Branch');
      const OwnerTeam = require('../models/OwnerTeam');
      const branch = await Branch.findById(existing.branch_id);
      const User = require('../models/User');
      const admin = await User.findById(req.userId);

      // Target users:
      // - Jika branch punya team: kirim ke owner-owner aktif di team
      // - Jika tidak punya team: kirim ke owner branch
      const targetUserIds = new Set();
      if (branch?.team_id) {
        const members = await OwnerTeam.getMembers(branch.team_id);
        members
          .filter((m) => m.role === 'owner' && m.status === 'active')
          .forEach((m) => targetUserIds.add(m.user_id));
      } else if (branch?.owner_id) {
        targetUserIds.add(branch.owner_id);
      }
      
      if (targetUserIds.size > 0) {
        const amount = new Intl.NumberFormat('id-ID', {
          style: 'currency',
          currency: 'IDR',
          minimumFractionDigits: 0
        }).format(existing.amount);
        
        await expoPushService.sendToUsers([...targetUserIds], {
          title: 'Edit Request',
          body: `Admin ${admin?.name || admin?.email || 'Admin'} meminta izin untuk mengedit transaksi ${amount}`,
          data: {
            screen: 'requests',
            transactionId: parseInt(id),
            branchId: existing.branch_id,
            type: 'edit_request',
          },
        });
      }
    } catch (notifError) {
      // Don't fail the request if notification fails
      console.error('Error sending notification:', notifError);
    }
    
    res.json({
      success: true,
      message: 'Permintaan edit berhasil diajukan. Menunggu persetujuan owner.',
      data: { transaction }
    });
  } catch (error) {
    next(error);
  }
};

// Approve edit request (owner and co-owner only)
const approveEdit = async (req, res, next) => {
  try {
    const { id } = req.params;
    
    // Only owner and co-owner can approve
    if (req.user.role !== 'owner' && req.user.role !== 'co-owner') {
      return res.status(403).json({
        success: false,
        message: 'Hanya owner dan co-owner yang dapat menyetujui permintaan edit'
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
    
    // Log activity
    LogService.logActivity({
      userId: req.userId,
      action: 'approve_edit_transaction',
      entityType: 'transaction',
      entityId: existing.id,
      branchId: existing.branch_id,
      newValues: {
        edit_accepted: 2,
        edit_requested_by: existing.edit_requested_by,
      },
      ipAddress: req.ip,
      userAgent: req.get('user-agent'),
      requestMethod: req.method,
      requestPath: req.path,
    });
    
    // Send notification to admin who requested edit
    try {
      const expoPushService = require('../services/expoPushService');
      const User = require('../models/User');
      
      if (existing.edit_requested_by) {
        const amount = new Intl.NumberFormat('id-ID', {
          style: 'currency',
          currency: 'IDR',
          minimumFractionDigits: 0
        }).format(existing.amount);
        
        await expoPushService.sendToUser(existing.edit_requested_by, {
          title: 'Edit Request Disetujui',
          body: `Permintaan edit untuk transaksi ${amount} telah disetujui`,
          data: {
            screen: 'transaction_detail',
            transactionId: parseInt(id),
            branchId: existing.branch_id,
            type: 'edit_approved',
          },
        });
      }
    } catch (notifError) {
      // Don't fail the request if notification fails
      console.error('Error sending notification:', notifError);
    }
    
    res.json({
      success: true,
      message: 'Permintaan edit berhasil disetujui',
      data: { transaction }
    });
  } catch (error) {
    next(error);
  }
};

// Reject edit request (owner and co-owner only)
const rejectEdit = async (req, res, next) => {
  try {
    const { id } = req.params;
    
    // Only owner and co-owner can reject
    if (req.user.role !== 'owner' && req.user.role !== 'co-owner') {
      return res.status(403).json({
        success: false,
        message: 'Hanya owner dan co-owner yang dapat menolak permintaan edit'
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
    
    // Log activity
    LogService.logActivity({
      userId: req.userId,
      action: 'reject_edit_transaction',
      entityType: 'transaction',
      entityId: existing.id,
      branchId: existing.branch_id,
      newValues: {
        edit_accepted: 3,
        edit_requested_by: existing.edit_requested_by,
      },
      ipAddress: req.ip,
      userAgent: req.get('user-agent'),
      requestMethod: req.method,
      requestPath: req.path,
    });
    
    // Send notification to admin who requested edit
    try {
      const expoPushService = require('../services/expoPushService');
      
      if (existing.edit_requested_by) {
        const amount = new Intl.NumberFormat('id-ID', {
          style: 'currency',
          currency: 'IDR',
          minimumFractionDigits: 0
        }).format(existing.amount);
        
        await expoPushService.sendToUser(existing.edit_requested_by, {
          title: 'Edit Request Ditolak',
          body: `Permintaan edit untuk transaksi ${amount} telah ditolak`,
          data: {
            screen: 'transaction_detail',
            transactionId: parseInt(id),
            branchId: existing.branch_id,
            type: 'edit_rejected',
          },
        });
      }
    } catch (notifError) {
      // Don't fail the request if notification fails
      console.error('Error sending notification:', notifError);
    }
    
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
    const { status } = req.query; // Don't default to 'pending', allow 'all' or undefined
    
    // Get branch_id from header or middleware (optional for owner - can get from all branches)
    let branchId = req.branchId || req.headers['x-branch-id'];
    
    // For owner and co-owner: if no branchId provided, get from all branches they have access to
    // For admin: if no branchId, get from their assigned branch(es)
    if (!branchId) {
      if (req.user.role === 'owner' || req.user.role === 'co-owner') {
        // Owner and co-owner: get from all their accessible branches (pass null to getEditRequests)
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
    
    // If status is 'all' or undefined, pass undefined to get all statuses
    const statusFilter = status === 'all' || !status ? undefined : status;
    
    const transactions = await Transaction.getEditRequests({
      userId: req.userId,
      branchId: branchId,
      userRole: req.user.role,
      status: statusFilter
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

