const FundTransfer = require('../models/FundTransfer');
const BankAccount = require('../models/BankAccount');
const LockedPeriod = require('../models/LockedPeriod');
const LogService = require('../services/logService');

// 1. Get all fund transfers
exports.getAll = async (req, res, next) => {
  try {
    const branchId = req.query.branch_id || req.branchId || req.user?.branch_id;
    if (!branchId) {
      return res.status(400).json({ success: false, message: 'Branch ID wajib disertakan' });
    }

    const {
      start_date,
      end_date,
      bank_account_id,
      from_bank_account_id,
      to_bank_account_id,
      search,
      page = 1,
      limit = 20
    } = req.query;

    const result = await FundTransfer.findAll({
      branchId: parseInt(branchId),
      startDate: start_date || null,
      endDate: end_date || null,
      bankAccountId: bank_account_id ? parseInt(bank_account_id) : null,
      fromBankAccountId: from_bank_account_id ? parseInt(from_bank_account_id) : null,
      toBankAccountId: to_bank_account_id ? parseInt(to_bank_account_id) : null,
      search: search || '',
      page: parseInt(page),
      limit: parseInt(limit)
    });

    res.json({
      success: true,
      data: result.transfers,
      total: result.total,
      total_amount: result.totalAmount,
      page: result.page,
      limit: result.limit,
      total_pages: result.totalPages
    });
  } catch (error) {
    next(error);
  }
};

// 2. Get fund transfer by ID
exports.getById = async (req, res, next) => {
  try {
    const { id } = req.params;
    const transfer = await FundTransfer.findById(id);

    if (!transfer || transfer.status_deleted) {
      return res.status(404).json({ success: false, message: 'Data pemindahan dana tidak ditemukan' });
    }

    res.json({
      success: true,
      data: transfer
    });
  } catch (error) {
    next(error);
  }
};

// 3. Create fund transfer
exports.create = async (req, res, next) => {
  try {
    const {
      branch_id,
      from_bank_account_id,
      to_bank_account_id,
      amount,
      transfer_date,
      note,
      lampiran
    } = req.body;

    const branchId = branch_id || req.branchId || req.user?.branch_id;
    if (!branchId) {
      return res.status(400).json({ success: false, message: 'Branch ID wajib disertakan' });
    }

    if (!from_bank_account_id || !to_bank_account_id) {
      return res.status(400).json({ success: false, message: 'Rekening asal dan tujuan wajib dipilih' });
    }

    if (parseInt(from_bank_account_id) === parseInt(to_bank_account_id)) {
      return res.status(400).json({ success: false, message: 'Rekening asal dan tujuan tidak boleh sama' });
    }

    const numAmount = parseFloat(amount);
    if (isNaN(numAmount) || numAmount <= 0) {
      return res.status(400).json({ success: false, message: 'Nominal pemindahan dana harus lebih dari 0' });
    }

    if (!transfer_date) {
      return res.status(400).json({ success: false, message: 'Tanggal transfer wajib diisi' });
    }

    // Verify bank accounts exist
    const fromAccount = await BankAccount.findById(from_bank_account_id);
    const toAccount = await BankAccount.findById(to_bank_account_id);

    if (!fromAccount || !toAccount) {
      return res.status(404).json({ success: false, message: 'Rekening bank tidak ditemukan' });
    }

    // Check locked period
    const tDate = new Date(transfer_date);
    const isLocked = await LockedPeriod.isLocked(branchId, tDate.getMonth() + 1, tDate.getFullYear());
    if (isLocked) {
      return res.status(403).json({
        success: false,
        message: 'Periode transaksi untuk tanggal ini telah dikunci oleh Owner'
      });
    }

    const newId = await FundTransfer.create({
      branchId: parseInt(branchId),
      userId: req.userId,
      fromBankAccountId: parseInt(from_bank_account_id),
      toBankAccountId: parseInt(to_bank_account_id),
      amount: numAmount,
      transferDate: transfer_date,
      note: note || null,
      lampiran: lampiran || null
    });

    const createdTransfer = await FundTransfer.findById(newId);

    // Audit Log via LogService
    LogService.logActivity({
      userId: req.userId,
      action: 'FUND_TRANSFER_CREATE',
      entityType: 'fund_transfer',
      entityId: newId,
      branchId: parseInt(branchId),
      newValues: {
        from_bank_account_id: parseInt(from_bank_account_id),
        from_bank_name: fromAccount.name,
        to_bank_account_id: parseInt(to_bank_account_id),
        to_bank_name: toAccount.name,
        amount: numAmount,
        transfer_date,
        note
      },
      metadata: {
        from_bank: fromAccount.name,
        to_bank: toAccount.name,
        amount: numAmount,
        date: transfer_date
      }
    });

    res.status(201).json({
      success: true,
      message: 'Pemindahan dana berhasil disimpan',
      data: createdTransfer
    });
  } catch (error) {
    next(error);
  }
};

// 4. Update fund transfer
exports.update = async (req, res, next) => {
  try {
    const { id } = req.params;
    const {
      from_bank_account_id,
      to_bank_account_id,
      amount,
      transfer_date,
      note,
      lampiran,
      reason
    } = req.body;

    const existing = await FundTransfer.findById(id);
    if (!existing || existing.status_deleted) {
      return res.status(404).json({ success: false, message: 'Data pemindahan dana tidak ditemukan' });
    }

    // Check locked period on old date
    const oldDate = new Date(existing.transfer_date);
    const isOldLocked = await LockedPeriod.isLocked(existing.branch_id, oldDate.getMonth() + 1, oldDate.getFullYear());
    if (isOldLocked) {
      return res.status(403).json({
        success: false,
        message: 'Tidak dapat mengubah pemindahan dana pada periode yang telah dikunci'
      });
    }

    // Check locked period on new date if date changed
    if (transfer_date) {
      const newDate = new Date(transfer_date);
      const isNewLocked = await LockedPeriod.isLocked(existing.branch_id, newDate.getMonth() + 1, newDate.getFullYear());
      if (isNewLocked) {
        return res.status(403).json({
          success: false,
          message: 'Periode tanggal pemindahan dana baru telah dikunci'
        });
      }
    }

    const updates = {};
    if (from_bank_account_id !== undefined) updates.fromBankAccountId = parseInt(from_bank_account_id);
    if (to_bank_account_id !== undefined) updates.toBankAccountId = parseInt(to_bank_account_id);
    if (amount !== undefined) updates.amount = parseFloat(amount);
    if (transfer_date !== undefined) updates.transferDate = transfer_date;
    if (note !== undefined) updates.note = note;
    if (lampiran !== undefined) updates.lampiran = lampiran;

    // Validate account difference
    const targetFrom = updates.fromBankAccountId || existing.from_bank_account_id;
    const targetTo = updates.toBankAccountId || existing.to_bank_account_id;
    if (targetFrom === targetTo) {
      return res.status(400).json({ success: false, message: 'Rekening asal dan tujuan tidak boleh sama' });
    }

    await FundTransfer.update(id, updates, req.userId, reason || 'Update pemindahan dana');

    const updatedTransfer = await FundTransfer.findById(id);

    // Audit Log via LogService
    LogService.logActivity({
      userId: req.userId,
      action: 'FUND_TRANSFER_UPDATE',
      entityType: 'fund_transfer',
      entityId: parseInt(id),
      branchId: existing.branch_id,
      oldValues: {
        from_bank_account_id: existing.from_bank_account_id,
        to_bank_account_id: existing.to_bank_account_id,
        amount: existing.amount,
        transfer_date: existing.transfer_date,
        note: existing.note
      },
      newValues: {
        from_bank_account_id: updatedTransfer.from_bank_account_id,
        to_bank_account_id: updatedTransfer.to_bank_account_id,
        amount: updatedTransfer.amount,
        transfer_date: updatedTransfer.transfer_date,
        note: updatedTransfer.note
      },
      changes: {
        reason: reason || 'Pembaruan data'
      },
      metadata: {
        from_bank: updatedTransfer.from_bank_account_name,
        to_bank: updatedTransfer.to_bank_account_name,
        amount: updatedTransfer.amount
      }
    });

    res.json({
      success: true,
      message: 'Pemindahan dana berhasil diperbarui',
      data: updatedTransfer
    });
  } catch (error) {
    next(error);
  }
};

// 5. Delete fund transfer
exports.delete = async (req, res, next) => {
  try {
    const { id } = req.params;
    const reason = req.body?.reason || req.query?.reason;

    const existing = await FundTransfer.findById(id);
    if (!existing || existing.status_deleted) {
      return res.status(404).json({ success: false, message: 'Data pemindahan dana tidak ditemukan' });
    }

    // Check locked period
    const tDate = new Date(existing.transfer_date);
    const isLocked = await LockedPeriod.isLocked(existing.branch_id, tDate.getMonth() + 1, tDate.getFullYear());
    if (isLocked) {
      return res.status(403).json({
        success: false,
        message: 'Tidak dapat menghapus pemindahan dana pada periode yang telah dikunci'
      });
    }

    await FundTransfer.softDelete(id, req.userId, reason || 'Penghapusan pemindahan dana');

    // Audit Log via LogService
    LogService.logActivity({
      userId: req.userId,
      action: 'FUND_TRANSFER_DELETE',
      entityType: 'fund_transfer',
      entityId: parseInt(id),
      branchId: existing.branch_id,
      oldValues: {
        from_bank_account_id: existing.from_bank_account_id,
        from_bank_name: existing.from_bank_account_name,
        to_bank_account_id: existing.to_bank_account_id,
        to_bank_name: existing.to_bank_account_name,
        amount: existing.amount,
        transfer_date: existing.transfer_date,
        note: existing.note
      },
      changes: {
        reason: reason || 'Penghapusan pemindahan dana'
      },
      metadata: {
        deleted_amount: existing.amount,
        deleted_from: existing.from_bank_account_name,
        deleted_to: existing.to_bank_account_name
      }
    });

    res.json({
      success: true,
      message: 'Pemindahan dana berhasil dihapus'
    });
  } catch (error) {
    next(error);
  }
};

// 6. Get audit logs feed for fund transfers
exports.getAuditLogs = async (req, res, next) => {
  try {
    const branchId = req.query.branch_id || req.branchId || req.user?.branch_id;
    if (!branchId) {
      return res.status(400).json({ success: false, message: 'Branch ID wajib disertakan' });
    }

    const {
      start_date,
      end_date,
      action,
      search,
      page = 1,
      limit = 20
    } = req.query;

    const result = await FundTransfer.getAuditLogs({
      branchId: parseInt(branchId),
      startDate: start_date || null,
      endDate: end_date || null,
      action: action || null,
      search: search || '',
      page: parseInt(page),
      limit: parseInt(limit)
    });

    res.json({
      success: true,
      data: result.logs,
      total: result.total,
      stats: result.stats,
      page: result.page,
      limit: result.limit,
      total_pages: result.totalPages
    });
  } catch (error) {
    next(error);
  }
};
