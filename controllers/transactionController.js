// TRACER: 2026-02-28 11:26
const Transaction = require('../models/Transaction');
const TransactionRepayment = require('../models/TransactionRepayment');
const TransactionEdit = require('../models/TransactionEdit');
const Category = require('../models/Category');
const LogService = require('../services/logService');
const config = require('../config/config');

// Helper: Convert lampiran paths to full URLs using BASE_URL from config
const formatLampiran = (lampiran, req) => {
  if (!lampiran) return null;

  // Get base URL from config (prioritize config over req)
  const baseUrl = config.baseUrl || `${req.protocol}://${req.get('host')}`;

  try {
    // Try to parse as JSON (array)
    const parsed = JSON.parse(lampiran);
    if (Array.isArray(parsed)) {
      return parsed.map(path => {
        // If already full URL, check if it needs to be replaced with baseUrl
        if (path.startsWith('http://') || path.startsWith('https://')) {
          // Extract path from URL
          try {
            const urlObj = new URL(path);
            const urlPath = urlObj.pathname;
            // Always use baseUrl from config
            return `${baseUrl}${urlPath}`;
          } catch (e) {
            // If URL parsing fails, return as is
            return path;
          }
        }
        // Convert relative path to full URL using baseUrl
        return `${baseUrl}${path.startsWith('/') ? path : '/' + path}`;
      });
    } else {
      // Single value
      const path = parsed;
      if (path.startsWith('http://') || path.startsWith('https://')) {
        // Extract path from URL
        try {
          const urlObj = new URL(path);
          const urlPath = urlObj.pathname;
          // Always use baseUrl from config
          return [`${baseUrl}${urlPath}`];
        } catch (e) {
          // If URL parsing fails, return as is
          return [path];
        }
      }
      return [`${baseUrl}${path.startsWith('/') ? path : '/' + path}`];
    }
  } catch (e) {
    // Not JSON, treat as string
    const path = lampiran;
    if (path.startsWith('http://') || path.startsWith('https://')) {
      // Extract path from URL
      try {
        const urlObj = new URL(path);
        const urlPath = urlObj.pathname;
        // Always use baseUrl from config
        return [`${baseUrl}${urlPath}`];
      } catch (e) {
        // If URL parsing fails, return as is
        return [path];
      }
    }
    return [`${baseUrl}${path.startsWith('/') ? path : '/' + path}`];
  }
};

// Helper: Strip base URL from lampiran paths before saving to DB
const stripBaseUrl = (lampiran, baseUrl) => {
  if (!lampiran) return null;

  const cleanPath = (p) => {
    if (typeof p !== 'string') return p;
    if (p.startsWith('http://') || p.startsWith('https://')) {
      try {
        const url = new URL(p);
        return url.pathname;
      } catch (e) {
        return p;
      }
    }
    return p;
  };

  if (Array.isArray(lampiran)) {
    return lampiran.map(cleanPath);
  }

  try {
    const parsed = JSON.parse(lampiran);
    if (Array.isArray(parsed)) {
      return parsed.map(cleanPath);
    }
    return cleanPath(parsed);
  } catch (e) {
    return cleanPath(lampiran);
  }
};

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
      exclude_folders = false,
      only_folders = false,
      is_umum,
      page = 1,
      limit = 20,
      mitra_piutang_id,
      is_pb1_payment,
      has_pb1
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
    const validPage = parseInt(page);
    const validLimit = parseInt(limit);
    const finalPage = (!isNaN(validPage) && validPage > 0) ? validPage : 1;
    const finalLimit = (!isNaN(validLimit) && validLimit > 0) ? validLimit : 20;

    // Ensure branchId is valid integer
    const validBranchId = parseInt(branchId);
    if (isNaN(validBranchId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid Branch ID. Please provide a valid X-Branch-Id header.'
      });
    }

    const transactions = await Transaction.findAll({
      branchId: validBranchId,
      type: type || undefined,
      category: category || undefined,
      startDate: start_date || undefined,
      endDate: end_date || undefined,
      sort: sort || 'terbaru',
      includeDeleted: include_deleted === 'true',
      onlyDeleted: only_deleted === 'true',
      excludeFolders: exclude_folders === 'true',
      onlyFolders: only_folders === 'true',
      isUmum: is_umum,
      page: finalPage,
      limit: finalLimit,
      mitraPiutangId: mitra_piutang_id || undefined,
      isPb1Payment: is_pb1_payment !== undefined ? (is_pb1_payment === 'true') : undefined,
      hasPb1: has_pb1 === 'true'
    });

    const total = await Transaction.count({
      branchId: parseInt(branchId),
      type,
      category,
      startDate: start_date,
      endDate: end_date,
      includeDeleted: include_deleted === 'true',
      onlyDeleted: only_deleted === 'true',
      excludeFolders: exclude_folders === 'true',
      onlyFolders: only_folders === 'true',
      isUmum: is_umum,
      mitraPiutangId: mitra_piutang_id || undefined
    });

    // Format lampiran paths to full URLs for all transactions
    const formattedTransactions = transactions.map(t => ({
      ...t,
      lampiran: formatLampiran(t.lampiran, req)
    }));

    res.json({
      success: true,
      data: {
        transactions: formattedTransactions,
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

    // Format lampiran paths to full URLs
    const formattedTransaction = {
      ...transaction,
      lampiran: formatLampiran(transaction.lampiran, req)
    };

    res.json({
      success: true,
      data: { transaction: formattedTransaction }
    });
  } catch (error) {
    next(error);
  }
};

const create = async (req, res, next) => {
  try {
    const { type, category, amount, pb1, note, date, lampiran, is_debt_payment, paid_amount, remaining_debt, mitra_piutang_id, mitra_details, is_pb1_payment } = req.body;

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

    // Every transaction made through the app should show up in the dashboard by default,
    // unless explicitly specified otherwise (e.g., Savings/Kas Simpanan transactions)
    const isUmum = req.body.is_umum !== undefined ?
      (req.body.is_umum === true || req.body.is_umum === 'true' || req.body.is_umum === 1) :
      true;

    // Handle debt payment fields
    const isDebtPayment = is_debt_payment === true || is_debt_payment === 'true' || is_debt_payment === 1;
    let paidAmount = null;
    let remainingDebt = null;
    let mitraPiutangId = null;

    if (isDebtPayment) {
      if (paid_amount !== undefined && paid_amount !== null) {
        paidAmount = parseFloat(paid_amount);
        // Validate: paid_amount should not exceed amount
        if (paidAmount > parseFloat(amount)) {
          return res.status(400).json({
            success: false,
            message: 'Jumlah yang dibayar tidak boleh lebih dari nominal'
          });
        }
      }
      if (remaining_debt !== undefined && remaining_debt !== null) {
        remainingDebt = parseFloat(remaining_debt);
      }
      // Parse mitra_piutang_id (nullable, only for debt payments)
      if (mitra_piutang_id !== undefined && mitra_piutang_id !== null && mitra_piutang_id !== '') {
        mitraPiutangId = parseInt(mitra_piutang_id);
        if (isNaN(mitraPiutangId)) {
          return res.status(400).json({
            success: false,
            message: 'Invalid mitra_piutang_id'
          });
        }
      }
    }

    // Create transaction
    const transaction = await Transaction.create({
      userId: req.userId,
      branchId: parseInt(branchId),
      type,
      categoryId: foundCategory.id,
      amount: parseFloat(amount),
      pb1: pb1 ? parseFloat(pb1) : null,
      note: note || null,
      transactionDate: date,
      lampiran: lampiranValue,
      isUmum,
      isDebtPayment,
      paidAmount,
      remainingDebt,
      mitraPiutangId,
      mitraDetails: mitra_details || [],
      isPb1Payment: is_pb1_payment || false
    });

    // Log to history table (Audit Trail) - Non-blocking
    TransactionEdit.create({
      transactionId: transaction.id,
      requesterId: req.userId,
      reason: 'Transaksi Dibuat',
      oldData: {},
      newData: {
        type: transaction.type,
        amount: transaction.amount,
        pb1: transaction.pb1,
        category: category,
        note: transaction.note,
        date: transaction.transaction_date,
        lampiran: transaction.lampiran,
        is_umum: transaction.is_umum,
        is_debt_payment: transaction.is_debt_payment,
        paid_amount: transaction.paid_amount,
        remaining_debt: transaction.remaining_debt
      },
      status: 'approved'
    }).catch(err => console.error('Error creating creation history:', err));

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

    // Format lampiran paths to full URLs
    const formattedTransaction = {
      ...transaction,
      lampiran: formatLampiran(transaction.lampiran, req)
    };

    res.status(201).json({
      success: true,
      message: 'Transaction created successfully',
      data: { transaction: formattedTransaction }
    });
  } catch (error) {
    next(error);
  }
};

// Update transaction
const update = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { type, category, amount, pb1, note, date, transaction_date, lampiran, reason, is_umum, is_debt_payment, paid_amount, remaining_debt, mitra_piutang_id, mitra_details, is_pb1_payment } = req.body;

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


    // Prepare update data
    const updateData = {};
    if (type !== undefined) updateData.type = type;
    if (amount !== undefined) {
      const parsedAmount = parseFloat(amount);
      if (!isNaN(parsedAmount)) {
        updateData.amount = parsedAmount;
      }
    }
    if (note !== undefined) updateData.note = note;
    if (pb1 !== undefined) {
      // Sama persis dengan logika create: pb1 ? parseFloat(pb1) : null
      updateData.pb1 = (pb1 && !isNaN(parseFloat(pb1)) && parseFloat(pb1) !== 0) ? parseFloat(pb1) : null;
    }
    if (is_umum !== undefined) updateData.isUmum = is_umum === true || is_umum === 'true' || is_umum === 1;

    // Handle date property (handle both 'date' and 'transaction_date')
    const finalDate = transaction_date || date;
    if (finalDate !== undefined) updateData.transactionDate = finalDate;

    // Handle lampiran update (ensure it's stringified if it's an array)
    if (lampiran !== undefined) {
      const baseUrl = config.baseUrl || `${req.protocol}://${req.get('host')}`;
      const cleanedLampiran = stripBaseUrl(lampiran, baseUrl);

      if (Array.isArray(cleanedLampiran)) {
        updateData.lampiran = JSON.stringify(cleanedLampiran);
      } else {
        updateData.lampiran = cleanedLampiran || null;
      }
    }

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

    if (mitra_details !== undefined) {
      updateData.mitraDetails = mitra_details;
    }

    // Pass debt payment fields to model
    if (is_debt_payment !== undefined) {
      updateData.isDebtPayment = is_debt_payment === true || is_debt_payment === 'true' || is_debt_payment === 1;
    }
    if (paid_amount !== undefined) {
      updateData.paidAmount = parseFloat(paid_amount);
    }
    if (remaining_debt !== undefined) {
      updateData.remainingDebt = parseFloat(remaining_debt);
    }
    if (mitra_piutang_id !== undefined) {
      updateData.mitraPiutangId = (mitra_piutang_id === null || mitra_piutang_id === '') ? null : parseInt(mitra_piutang_id);
    }

    if (is_pb1_payment !== undefined) {
      updateData.isPb1Payment = is_pb1_payment === true || is_pb1_payment === 'true' || is_pb1_payment === 1;
    }

    const transaction = await Transaction.update(id, updateData);

    // Calculate changes for logging and automatic reason
    const changes = {};
    const changedFields = [];
    if (type !== undefined && existing.type !== type) {
      changes.type = { old: existing.type, new: type };
      changedFields.push('Tipe');
    }
    if (amount !== undefined && existing.amount !== parseFloat(amount)) {
      const newAmount = parseFloat(amount);
      changes.amount = { old: existing.amount, new: newAmount };
      changedFields.push('Nominal');
    }
    if (pb1 !== undefined && existing.pb1 !== (pb1 === null ? null : parseFloat(pb1))) {
      const newPb1 = pb1 === null ? null : parseFloat(pb1);
      changes.pb1 = { old: existing.pb1, new: newPb1 };
      changedFields.push('PB1');
    }
    if (category !== undefined && existing.category_name !== category) {
      changes.category = { old: existing.category_name, new: category };
      changedFields.push('Kategori');
    }
    if (note !== undefined && existing.note !== note) {
      changes.note = { old: existing.note, new: note };
      changedFields.push('Catatan');
    }
    const finalReqDate = transaction_date || date;
    if (finalReqDate !== undefined) {
      const oldD = existing.transaction_date instanceof Date ? existing.transaction_date.toISOString().split('T')[0] : existing.transaction_date;
      const newD = finalReqDate.split(' ')[0]; // Ambil YYYY-MM-DD saja
      if (oldD !== newD) {
        changes.date = { old: oldD, new: finalReqDate };
        changedFields.push('Tanggal');
      }
    }
    if (lampiran !== undefined) {
      const oldL = existing.lampiran;
      const newL = transaction.lampiran;
      if (oldL !== newL) {
        changes.lampiran = { old: oldL, new: newL };
        changedFields.push('Lampiran');
      }
    }

    const autoGeneratedReason = changedFields.length > 0
      ? `Update ${changedFields.join(', ')} oleh ${req.user.role === 'admin' ? 'Admin' : 'Owner'}`
      : `Update data oleh ${req.user.role === 'admin' ? 'Admin' : 'Owner'}`;

    // Log to history table for all roles (Owner/Admin)
    await TransactionEdit.create({
      transactionId: id,
      requesterId: req.userId,
      reason: reason ? reason.trim() : autoGeneratedReason,
      oldData: {
        type: existing.type,
        amount: existing.amount,
        category: existing.category_name,
        note: existing.note,
        date: existing.transaction_date,
        lampiran: existing.lampiran,
        pb1: existing.pb1,
        is_umum: existing.is_umum,
        is_debt_payment: existing.is_debt_payment,
        paid_amount: existing.paid_amount,
        remaining_debt: existing.remaining_debt,
        mitra_piutang_id: existing.mitra_piutang_id,
        is_pb1_payment: existing.is_pb1_payment
      },
      newData: {
        type: transaction.type,
        amount: transaction.amount,
        category: transaction.category_name,
        note: transaction.note,
        date: transaction.transaction_date,
        lampiran: transaction.lampiran,
        pb1: transaction.pb1,
        is_umum: transaction.is_umum,
        is_debt_payment: transaction.is_debt_payment,
        paid_amount: transaction.paid_amount,
        remaining_debt: transaction.remaining_debt,
        mitra_piutang_id: transaction.mitra_piutang_id,
        is_pb1_payment: transaction.is_pb1_payment
      },
      status: 'approved'
    });

    // If it was an approved request or any old request, clear it
    if (existing.edit_accepted !== 0) {
      await Transaction.clearEditRequest(id);
    }

    // Log activity
    LogService.logActivity({
      userId: req.userId,
      action: 'update_transaction',
      entityType: 'transaction',
      entityId: transaction.id,
      branchId: existing.branch_id,
      oldValues: {
        type: existing.type,
        amount: existing.amount,
        category: existing.category_name,
        note: existing.note,
        date: existing.transaction_date,
        pb1: existing.pb1,
        is_umum: existing.is_umum
      },
      newValues: {
        type: transaction.type,
        amount: transaction.amount,
        category: transaction.category_name,
        note: transaction.note,
        date: transaction.transaction_date,
        pb1: transaction.pb1,
        is_umum: transaction.is_umum
      },
      changes: Object.keys(changes).length > 0 ? changes : null,
      ipAddress: req.ip,
      userAgent: req.get('user-agent'),
      requestMethod: req.method,
      requestPath: req.path,
    });

    // Format lampiran paths to full URLs
    const formattedTransaction = {
      ...transaction,
      lampiran: formatLampiran(transaction.lampiran, req)
    };

    res.json({
      success: true,
      message: 'Transaction updated successfully',
      data: { transaction: formattedTransaction }
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

    // Format lampiran paths to full URLs
    const formattedRestoredTransaction = {
      ...restoredTransaction,
      lampiran: formatLampiran(restoredTransaction.lampiran, req)
    };

    res.json({
      success: true,
      message: 'Transaction restored successfully',
      data: { transaction: formattedRestoredTransaction }
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

    // Log request to history
    await TransactionEdit.create({
      transactionId: id,
      requesterId: req.userId,
      reason: reason.trim(),
      oldData: {
        amount: existing.amount,
        category: existing.category_name,
        note: existing.note,
        date: existing.transaction_date,
        lampiran: existing.lampiran
      },
      newData: null, // Data baru belum diinput
      status: 'approved'
    });

    // Send notification to branch owner + team owners (if branch belongs to a team) - NON-BLOCKING
    setImmediate(async () => {
      try {
        const notificationQueue = require('../services/notificationQueue');
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

          // Queue notification (non-blocking)
          notificationQueue.enqueue({
            userId: [...targetUserIds],
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
        console.error('❌ Error queuing notification:', notifError);
      }
    });

    // Format lampiran paths to full URLs
    const formattedTransaction = {
      ...transaction,
      lampiran: formatLampiran(transaction.lampiran, req)
    };

    res.json({
      success: true,
      message: 'Permintaan edit berhasil diajukan. Menunggu persetujuan owner.',
      data: { transaction: formattedTransaction }
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

    // Update history status
    await TransactionEdit.updateStatus(id, 'approved', req.userId);

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

    // Send notification to admin who requested edit - NON-BLOCKING
    if (existing.edit_requested_by) {
      setImmediate(async () => {
        try {
          const notificationQueue = require('../services/notificationQueue');
          const amount = new Intl.NumberFormat('id-ID', {
            style: 'currency',
            currency: 'IDR',
            minimumFractionDigits: 0
          }).format(existing.amount);

          // Queue notification (non-blocking)
          notificationQueue.enqueue({
            userId: existing.edit_requested_by,
            title: 'Edit Request Disetujui',
            body: `Permintaan edit untuk transaksi ${amount} telah disetujui`,
            data: {
              screen: 'transaction_detail',
              transactionId: parseInt(id),
              branchId: existing.branch_id,
              type: 'edit_approved',
            },
          });
        } catch (notifError) {
          console.error('Error queuing notification:', notifError);
        }
      });
    }

    // Format lampiran paths to full URLs
    const formattedTransaction = {
      ...transaction,
      lampiran: formatLampiran(transaction.lampiran, req)
    };

    res.json({
      success: true,
      message: 'Permintaan edit berhasil disetujui',
      data: { transaction: formattedTransaction }
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

    // Update history status
    await TransactionEdit.updateStatus(id, 'rejected', req.userId);

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

    // Send notification to admin who requested edit - NON-BLOCKING
    if (existing.edit_requested_by) {
      setImmediate(async () => {
        try {
          const notificationQueue = require('../services/notificationQueue');
          const amount = new Intl.NumberFormat('id-ID', {
            style: 'currency',
            currency: 'IDR',
            minimumFractionDigits: 0
          }).format(existing.amount);

          // Queue notification (non-blocking)
          notificationQueue.enqueue({
            userId: existing.edit_requested_by,
            title: 'Edit Request Ditolak',
            body: `Permintaan edit untuk transaksi ${amount} telah ditolak`,
            data: {
              screen: 'transaction_detail',
              transactionId: parseInt(id),
              branchId: existing.branch_id,
              type: 'edit_rejected',
            },
          });
        } catch (notifError) {
          console.error('Error queuing notification:', notifError);
        }
      });
    }

    // Format lampiran paths to full URLs
    const formattedTransaction = {
      ...transaction,
      lampiran: formatLampiran(transaction.lampiran, req)
    };

    res.json({
      success: true,
      message: 'Permintaan edit ditolak',
      data: { transaction: formattedTransaction }
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

    // Format lampiran paths to full URLs for all transactions
    const formattedTransactions = transactions.map(t => ({
      ...t,
      lampiran: formatLampiran(t.lampiran, req)
    }));

    res.json({
      success: true,
      data: { transactions: formattedTransactions }
    });
  } catch (error) {
    next(error);
  }
};

// Get transaction edit history
const getHistory = async (req, res, next) => {
  try {
    const { id } = req.params;
    const history = await TransactionEdit.getHistory(id);

    // Format lampiran paths in old_data and new_data
    const formattedHistory = history.map(item => {
      let old_data = item.old_data;
      let new_data = item.new_data;

      try {
        if (typeof old_data === 'string') old_data = JSON.parse(old_data);
        if (typeof new_data === 'string') new_data = JSON.parse(new_data);
      } catch (e) { }

      if (old_data && old_data.lampiran) {
        old_data.lampiran = formatLampiran(old_data.lampiran, req);
      }
      if (new_data && new_data.lampiran) {
        new_data.lampiran = formatLampiran(new_data.lampiran, req);
      }

      return {
        ...item,
        old_data,
        new_data
      };
    });

    res.json({
      success: true,
      data: { history: formattedHistory }
    });
  } catch (error) {
    next(error);
  }
};

// Get transaction summary
const getSummary = async (req, res, next) => {
  try {
    const {
      start_date,
      end_date,
      category_id,
      sub_category_id,
      is_umum
    } = req.query;

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
        message: 'Access denied'
      });
    }

    const summary = await Transaction.getSummary({
      branchId: parseInt(branchId),
      categoryId: category_id ? parseInt(category_id) : undefined,
      subCategoryId: sub_category_id ? parseInt(sub_category_id) : undefined,
      startDate: start_date || undefined,
      endDate: end_date || undefined,
      isUmum: is_umum !== undefined ? (is_umum === 'true' || is_umum === '1') : undefined
    });

    res.json({
      success: true,
      data: summary
    });
  } catch (error) {
    next(error);
  }
};

const createRepayment = async (req, res, next) => {
  const { transaction: dbTransaction, query } = require('../config/database');
  try {
    const { id } = req.params; // ID Transaksi Piutang Induk
    const { mitra_piutang_id, amount, date, note, lampiran } = req.body;

    if (!mitra_piutang_id || !amount || !date) {
      return res.status(400).json({
        success: false,
        message: 'Mitra, nominal, dan tanggal wajib diisi'
      });
    }

    const transaction = await Transaction.findById(id);
    if (!transaction) {
      return res.status(404).json({ success: false, message: 'Transaksi tidak ditemukan' });
    }

    if (!transaction.is_debt_payment) {
      return res.status(400).json({ success: false, message: 'Transaksi ini bukan piutang' });
    }

    // Verify branch access
    const Branch = require('../models/Branch');
    const hasAccess = await Branch.userHasAccess(req.userId, transaction.branch_id, req.user.role);
    if (!hasAccess) {
      return res.status(403).json({ success: false, message: 'Akses ditolak' });
    }

    const repaymentAmount = parseFloat(amount);
    const mitraId = parseInt(mitra_piutang_id);

    // Get specific mitra detail
    const mitraDetail = transaction.mitra_details.find(m => m.mitra_piutang_id === mitraId);
    if (!mitraDetail) {
      return res.status(404).json({ success: false, message: 'Data mitra tidak ditemukan di transaksi ini' });
    }

    if (repaymentAmount > mitraDetail.remaining_debt) {
      return res.status(400).json({
        success: false,
        message: `Nominal pelunasan (${repaymentAmount}) melebihi sisa hutang mitra (${mitraDetail.remaining_debt})`
      });
    }

    // Prepare total updates for audit trail
    const newTotalPaid = parseFloat(transaction.paid_amount || 0) + repaymentAmount;
    const newTotalRemaining = parseFloat(transaction.remaining_debt || 0) - repaymentAmount;

    // Handle lampiran - convert array to JSON string if needed
    let lampiranValue = null;
    if (lampiran) {
      lampiranValue = Array.isArray(lampiran) ? JSON.stringify(lampiran) : lampiran;
    }

    // PROCESS REPAYMENT IN DB TRANSACTION
    await dbTransaction(async (conn) => {
      // 1. Update transaction_mitra_details
      const newMitraPaid = parseFloat(mitraDetail.paid_amount) + repaymentAmount;
      const newMitraRemaining = parseFloat(mitraDetail.remaining_debt) - repaymentAmount;

      await conn.execute(
        `UPDATE transaction_mitra_details 
         SET paid_amount = ?, remaining_debt = ? 
         WHERE transaction_id = ? AND mitra_piutang_id = ?`,
        [newMitraPaid, newMitraRemaining, id, mitraId]
      );

      // 2. Update main transactions record
      await conn.execute(
        `UPDATE transactions 
         SET paid_amount = ?, remaining_debt = ? 
         WHERE id = ?`,
        [newTotalPaid, newTotalRemaining, id]
      );

      // 3. Create automatic notification record in transactions (NO CATEGORY, NO BALANCE IMPACT)
      // This is JUST for notification in the dashboard list
      let incomeTransactionId = null;
      // Use the user's note for the notification if provided, otherwise generic
      const repaymentNote = note || `Pelunasan Piutang: ${mitraDetail.mitra_nama} (Ref: #${id})`;

      const [incomeResult] = await conn.execute(
        `INSERT INTO transactions (user_id, branch_id, type, amount, note, transaction_date, lampiran, is_umum, is_debt_payment, paid_amount, remaining_debt, status_deleted, category_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, 0, false, NULL)`,
        [req.userId, transaction.branch_id, 'income', repaymentAmount, repaymentNote, date, lampiranValue, true, repaymentAmount]
      );
      incomeTransactionId = incomeResult.insertId;

      // 4. Insert into transaction_repayments
      await conn.execute(
        `INSERT INTO transaction_repayments (transaction_id, mitra_piutang_id, user_id, amount, payment_date, note, lampiran, income_transaction_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, mitraId, req.userId, repaymentAmount, date, note || null, lampiranValue, incomeTransactionId]
      );
    });

    // 5. Create log
    await LogService.logActivity({
      userId: req.userId,
      branchId: transaction.branch_id,
      action: 'Pelunasan Baru',
      entityType: 'Transaction',
      entityId: id,
      metadata: { description: `Mencatat pelunasan Rp ${repaymentAmount.toLocaleString('id-ID')} untuk mitra ${mitraDetail.mitra_nama}` }
    });

    // 6. Add to transaction history (Audit Trail)
    await TransactionEdit.create({
      transactionId: id,
      requesterId: req.userId,
      reason: 'Pelunasan Baru',
      oldData: { paid_amount: transaction.paid_amount, remaining_debt: transaction.remaining_debt },
      newData: {
        paid_amount: newTotalPaid,
        remaining_debt: newTotalRemaining,
        repayment_amount: repaymentAmount,
        mitra: mitraDetail.mitra_nama
      },
      status: 'approved'
    });

    res.status(201).json({
      success: true,
      message: 'Pelunasan berhasil dicatat'
    });
  } catch (error) {
    next(error);
  }
};

const updateRepayment = async (req, res, next) => {
  const { transaction: dbTransaction } = require('../config/database');
  try {
    const { id, repaymentId } = req.params;
    const { amount, date, note, lampiran } = req.body;

    const repayment = await TransactionRepayment.findById(repaymentId);
    if (!repayment) {
      return res.status(404).json({ success: false, message: 'Data pelunasan tidak ditemukan' });
    }

    const transaction = await Transaction.findById(id);
    const mitraDetail = transaction.mitra_details.find(m => m.mitra_piutang_id === repayment.mitra_piutang_id);

    const oldAmount = parseFloat(repayment.amount);
    const newAmount = parseFloat(amount);
    const diff = newAmount - oldAmount;

    // Check if new amount exceeds remaining debt + old amount
    if (diff > mitraDetail.remaining_debt) {
      return res.status(400).json({
        success: false,
        message: `Nominal baru melebihi sisa hutang (Maks: ${mitraDetail.remaining_debt + oldAmount})`
      });
    }

    let lampiranValue = lampiran !== undefined ? lampiran : repayment.lampiran;
    if (Array.isArray(lampiranValue)) lampiranValue = JSON.stringify(lampiranValue);

    await dbTransaction(async (conn) => {
      // 1. Update mitra detail
      await conn.execute(
        `UPDATE transaction_mitra_details 
         SET paid_amount = paid_amount + ?, remaining_debt = remaining_debt - ? 
         WHERE transaction_id = ? AND mitra_piutang_id = ?`,
        [diff, diff, id, repayment.mitra_piutang_id]
      );

      // 2. Update main transaction
      await conn.execute(
        `UPDATE transactions SET paid_amount = paid_amount + ?, remaining_debt = remaining_debt - ? WHERE id = ?`,
        [diff, diff, id]
      );

      // 3. Update associated income transaction if exists
      if (repayment.income_transaction_id) {
        await conn.execute(
          `UPDATE transactions SET amount = ?, paid_amount = ?, note = ?, transaction_date = ?, lampiran = ? WHERE id = ?`,
          [newAmount, newAmount, `Pelunasan Piutang (Update): ${mitraDetail.mitra_nama} (Ref: #${id})`, date, lampiranValue, repayment.income_transaction_id]
        );
      }

      // 4. Update repayment record
      await TransactionRepayment.update(repaymentId, {
        amount: newAmount,
        paymentDate: date,
        note: note !== undefined ? note : repayment.note,
        lampiran: lampiranValue
      });
    });

    await LogService.logActivity({
      userId: req.userId,
      branchId: transaction.branch_id,
      action: 'Update Pelunasan',
      entityType: 'Transaction',
      entityId: id,
      metadata: { description: `Memperbarui pelunasan mitra ${mitraDetail.mitra_nama} dari Rp ${oldAmount.toLocaleString('id-ID')} menjadi Rp ${newAmount.toLocaleString('id-ID')}` }
    });

    // 6. Add to transaction history (Audit Trail)
    await TransactionEdit.create({
      transactionId: id,
      requesterId: req.userId,
      reason: 'Update Pelunasan',
      oldData: {
        repayment_amount: oldAmount,
        note: repayment.note,
        date: repayment.payment_date,
        lampiran: repayment.lampiran
      },
      newData: {
        repayment_amount: newAmount,
        mitra: mitraDetail.mitra_nama,
        note: note !== undefined ? note : repayment.note,
        date: date,
        lampiran: lampiranValue
      },
      status: 'approved'
    });

    res.json({ success: true, message: 'Pelunasan berhasil diperbarui' });
  } catch (error) {
    next(error);
  }
};

const deleteRepayment = async (req, res, next) => {
  const { transaction: dbTransaction } = require('../config/database');
  try {
    const { id, repaymentId } = req.params;

    const repayment = await TransactionRepayment.findById(repaymentId);
    if (!repayment) {
      return res.status(404).json({ success: false, message: 'Data pelunasan tidak ditemukan' });
    }

    const transaction = await Transaction.findById(id);
    const amount = parseFloat(repayment.amount);
    const mitraDetail = transaction.mitra_details.find(m => m.mitra_piutang_id === repayment.mitra_piutang_id);

    await dbTransaction(async (conn) => {
      // 1. Revert balances
      await conn.execute(
        `UPDATE transaction_mitra_details 
         SET paid_amount = paid_amount - ?, remaining_debt = remaining_debt + ? 
         WHERE transaction_id = ? AND mitra_piutang_id = ?`,
        [amount, amount, id, repayment.mitra_piutang_id]
      );

      await conn.execute(
        `UPDATE transactions SET paid_amount = paid_amount - ?, remaining_debt = remaining_debt + ? WHERE id = ?`,
        [amount, amount, id]
      );

      // 2. Delete income transaction
      if (repayment.income_transaction_id) {
        await conn.execute(`UPDATE transactions SET status_deleted = 1 WHERE id = ?`, [repayment.income_transaction_id]);
      }

      // 3. Delete repayment record
      await TransactionRepayment.delete(repaymentId);
    });

    await LogService.logActivity({
      userId: req.userId,
      branchId: transaction.branch_id,
      action: 'Hapus Pelunasan',
      entityType: 'Transaction',
      entityId: id,
      metadata: { description: `Menghapus pelunasan Rp ${amount.toLocaleString('id-ID')} milik mitra ${mitraDetail ? mitraDetail.mitra_nama : 'Tidak diketahui'}` }
    });

    // 4. Add to transaction history (Audit Trail)
    await TransactionEdit.create({
      transactionId: id,
      requesterId: req.userId,
      reason: 'Hapus Pelunasan',
      oldData: { repayment_amount: amount, mitra: mitraDetail ? mitraDetail.mitra_nama : 'Tidak diketahui' },
      newData: { status: 'deleted' },
      status: 'approved'
    });

    res.json({ success: true, message: 'Pelunasan berhasil dihapus' });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getAll,
  getSummary,
  getById,
  create,
  update,
  softDelete,
  restore,
  hardDelete,
  requestEdit,
  approveEdit,
  rejectEdit,
  getEditRequests,
  getHistory,
  createRepayment,
  updateRepayment,
  deleteRepayment
};

