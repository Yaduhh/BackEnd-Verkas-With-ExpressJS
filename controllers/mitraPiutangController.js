const MitraPiutang = require('../models/MitraPiutang');
const LogService = require('../services/logService');
const Branch = require('../models/Branch');

// Get all mitra piutang
const getAll = async (req, res, next) => {
  try {
    const { include_deleted = false, startDate, endDate } = req.query;
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
      includeDeleted: include_deleted === 'true',
      startDate,
      endDate
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
    const { nama, initial_balance, initial_balance_date, initial_balance_note } = req.body;
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
      createdBy: req.userId,
      initialBalance: initial_balance,
      initialBalanceDate: initial_balance_date,
      initialBalanceNote: initial_balance_note
    });

    // Log activity
    LogService.logActivity({
      userId: req.userId,
      action: 'create_mitra_piutang',
      entityType: 'mitra_piutang',
      entityId: mitraPiutang.id,
      branchId: parseInt(branchId),
      newValues: {
        nama: mitraPiutang.nama,
        initial_balance: mitraPiutang.initial_balance
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
    const { nama, initial_balance, initial_balance_date, initial_balance_note } = req.body;
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
      nama: nama ? nama.trim() : undefined,
      initialBalance: initial_balance,
      initialBalanceDate: initial_balance_date,
      initialBalanceNote: initial_balance_note
    });

    // Log activity
    LogService.logActivity({
      userId: req.userId,
      action: 'update_mitra_piutang',
      entityType: 'mitra_piutang',
      entityId: mitraPiutang.id,
      branchId: parseInt(branchId),
      oldValues: {
        nama: existing.nama,
        initial_balance: existing.initial_balance
      },
      newValues: {
        nama: mitraPiutang.nama,
        initial_balance: mitraPiutang.initial_balance
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

// Bulk / Lump-sum Repayment for Mitra Piutang (FIFO or Manual Allocation)
const bulkRepayment = async (req, res, next) => {
  const { transaction: dbTransaction } = require('../config/database');
  try {
    const { id } = req.params;
    const { amount, date, bank_account_id, note, lampiran, manual_allocations } = req.body;
    const branchId = req.branchId || req.headers['x-branch-id'];

    if (!branchId) {
      return res.status(400).json({
        success: false,
        message: 'Branch ID is required. Please provide X-Branch-Id header.'
      });
    }

    const repaymentAmount = parseFloat(amount);
    if (!repaymentAmount || repaymentAmount <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Nominal pelunasan harus lebih dari 0'
      });
    }

    const paymentDate = date || new Date().toISOString().split('T')[0];

    // Verify branch access
    const hasAccess = await Branch.userHasAccess(req.userId, parseInt(branchId), req.user.role);
    if (!hasAccess) {
      return res.status(403).json({
        success: false,
        message: 'No access to this branch'
      });
    }

    const mitraId = parseInt(id);
    const existingMitra = await MitraPiutang.findById(mitraId, parseInt(branchId));
    if (!existingMitra) {
      return res.status(404).json({
        success: false,
        message: 'Mitra Piutang not found'
      });
    }

    const currentTotalPiutang = parseFloat(existingMitra.total_piutang || 0);
    if (repaymentAmount > currentTotalPiutang) {
      return res.status(400).json({
        success: false,
        message: `Nominal pelunasan (Rp ${repaymentAmount.toLocaleString('id-ID')}) melebihi total piutang mitra (Rp ${currentTotalPiutang.toLocaleString('id-ID')})`
      });
    }

    let lampiranValue = null;
    if (lampiran) {
      lampiranValue = Array.isArray(lampiran) ? JSON.stringify(lampiran) : lampiran;
    }

    const bulkRepaymentId = `BLK-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
    const allocations = [];

    await dbTransaction(async (conn) => {
      let remainingToAllocate = repaymentAmount;

      // 1. Initial balance repayment (if exists and remaining > 0)
      const initialBalance = parseFloat(existingMitra.initial_balance || 0);
      const initialBalancePaid = parseFloat(existingMitra.initial_balance_paid || 0);
      const remainingInitial = Math.max(0, initialBalance - initialBalancePaid);

      if (remainingInitial > 0 && remainingToAllocate > 0) {
        const allocInit = Math.min(remainingToAllocate, remainingInitial);
        await conn.execute(
          `UPDATE mitra_piutang 
           SET initial_balance_paid = initial_balance_paid + ?, updated_at = CURRENT_TIMESTAMP
           WHERE id = ? AND branch_id = ?`,
          [allocInit, mitraId, parseInt(branchId)]
        );

        await conn.execute(
          `INSERT INTO transaction_repayments (transaction_id, mitra_piutang_id, user_id, amount, payment_date, note, lampiran, bulk_repayment_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [null, mitraId, req.userId, allocInit, paymentDate, note || `Pelunasan Saldo Awal: ${existingMitra.nama}`, lampiranValue, bulkRepaymentId]
        );

        remainingToAllocate -= allocInit;
        allocations.push({
          type: 'initial_balance',
          allocated_amount: allocInit
        });
      }

      // 2. Transaksi Piutang (FIFO)
      if (remainingToAllocate > 0) {
        const [debtRows] = await conn.execute(
          `SELECT t.id as transaction_id, t.branch_id, t.transaction_date, t.note as transaction_note,
                  t.remaining_debt as trans_remaining, t.paid_amount as trans_paid,
                  tmd.id as tmd_id, tmd.remaining_debt as tmd_remaining, tmd.paid_amount as tmd_paid
           FROM transactions t
           LEFT JOIN transaction_mitra_details tmd ON tmd.transaction_id = t.id AND tmd.mitra_piutang_id = ?
           WHERE (t.mitra_piutang_id = ? OR tmd.mitra_piutang_id = ?)
             AND t.branch_id = ?
             AND t.status_deleted = false
             AND (
               (tmd.id IS NOT NULL AND tmd.remaining_debt > 0)
               OR (tmd.id IS NULL AND t.remaining_debt > 0)
             )
           ORDER BY t.transaction_date ASC, t.id ASC
           FOR UPDATE`,
          [mitraId, mitraId, mitraId, parseInt(branchId)]
        );

        for (const row of debtRows) {
          if (remainingToAllocate <= 0) break;

          const isMultiMitra = !!row.tmd_id;
          const currentDebt = isMultiMitra ? parseFloat(row.tmd_remaining) : parseFloat(row.trans_remaining);

          if (currentDebt <= 0) continue;

          const alloc = Math.min(remainingToAllocate, currentDebt);

          // Update multi-mitra details if applicable
          if (isMultiMitra) {
            await conn.execute(
              `UPDATE transaction_mitra_details 
               SET paid_amount = paid_amount + ?, remaining_debt = remaining_debt - ? 
               WHERE id = ?`,
              [alloc, alloc, row.tmd_id]
            );
          }

          // Always update main transaction
          await conn.execute(
            `UPDATE transactions 
             SET paid_amount = paid_amount + ?, remaining_debt = remaining_debt - ? 
             WHERE id = ?`,
            [alloc, alloc, row.transaction_id]
          );

          // Insert repayment record
          await conn.execute(
            `INSERT INTO transaction_repayments (transaction_id, mitra_piutang_id, transaction_mitra_detail_id, user_id, amount, payment_date, note, lampiran, bulk_repayment_id)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [row.transaction_id, mitraId, row.tmd_id || null, req.userId, alloc, paymentDate, note || `Pelunasan Piutang: ${existingMitra.nama} (Ref: #${row.transaction_id})`, lampiranValue, bulkRepaymentId]
          );

          remainingToAllocate -= alloc;
          allocations.push({
            type: 'transaction',
            transaction_id: row.transaction_id,
            allocated_amount: alloc
          });
        }
      }

      // 3. Create notification / cash record in transactions (is_debt_payment = 1)
      const repaymentNote = note || `Pelunasan Piutang Gelondongan: ${existingMitra.nama}`;
      await conn.execute(
        `INSERT INTO transactions (user_id, branch_id, type, amount, note, transaction_date, lampiran, is_umum, is_debt_payment, paid_amount, remaining_debt, status_deleted, category_id, bank_account_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, 0, false, NULL, ?)`,
        [req.userId, parseInt(branchId), 'income', repaymentAmount, repaymentNote, paymentDate, lampiranValue, true, repaymentAmount, bank_account_id ? parseInt(bank_account_id) : null]
      );
    });

    // Log activity
    LogService.logActivity({
      userId: req.userId,
      branchId: parseInt(branchId),
      action: 'Pelunasan Gelondongan',
      entityType: 'MitraPiutang',
      entityId: mitraId,
      metadata: {
        description: `Mencatat pelunasan gelondongan Rp ${repaymentAmount.toLocaleString('id-ID')} untuk mitra ${existingMitra.nama}`,
        bulk_repayment_id: bulkRepaymentId,
        allocations_count: allocations.length
      }
    });

    const updatedMitra = await MitraPiutang.findById(mitraId, parseInt(branchId));

    res.status(201).json({
      success: true,
      message: `Pelunasan gelondongan sebesar Rp ${repaymentAmount.toLocaleString('id-ID')} berhasil dicatat`,
      data: {
        mitra_piutang: updatedMitra,
        bulk_repayment_id: bulkRepaymentId,
        allocations
      }
    });
  } catch (error) {
    console.error('=== BULK REPAYMENT ERROR ===', error);
    next(error);
  }
};

module.exports = {
  getAll,
  getById,
  create,
  update,
  delete: deleteMitraPiutang,
  restore,
  bulkRepayment
};

