const CashierReport = require('../models/CashierReport');
const Branch = require('../models/Branch');
const LockedPeriod = require('../models/LockedPeriod');

const REVIEWER_ROLES = new Set(['admin', 'owner', 'co-owner', 'master']);

function resolveBranchId(req) {
  const raw = req.query.branch_id || req.body?.branch_id || req.branchId || req.headers['x-branch-id'];
  const parsed = parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

const cashierReportController = {
  // GET /api/cashier-reports/daily?date=YYYY-MM-DD
  getDaily: async (req, res, next) => {
    try {
      const branchId = resolveBranchId(req);
      if (!branchId) {
        return res.status(400).json({ success: false, message: 'Branch ID wajib dipilih.' });
      }

      const hasAccess = await Branch.userHasAccess(req.userId, branchId, req.user.role);
      if (!hasAccess) {
        return res.status(403).json({ success: false, message: 'Anda tidak memiliki akses ke cabang ini.' });
      }

      const date = req.query.date || new Date().toISOString().split('T')[0];
      const data = await CashierReport.getDailyReport(branchId, date);
      return res.json({ success: true, data });
    } catch (error) {
      if (error.statusCode) {
        return res.status(error.statusCode).json({ success: false, message: error.message });
      }
      next(error);
    }
  },

  // GET /api/cashier-reports/monthly?month=11&year=2026
  listMonthly: async (req, res, next) => {
    try {
      const branchId = resolveBranchId(req);
      if (!branchId) {
        return res.status(400).json({ success: false, message: 'Branch ID wajib dipilih.' });
      }

      const hasAccess = await Branch.userHasAccess(req.userId, branchId, req.user.role);
      if (!hasAccess) {
        return res.status(403).json({ success: false, message: 'Anda tidak memiliki akses ke cabang ini.' });
      }

      const now = new Date();
      const month = parseInt(req.query.month, 10) || (now.getMonth() + 1);
      const year = parseInt(req.query.year, 10) || now.getFullYear();

      const [items, target] = await Promise.all([
        CashierReport.listByMonth({ branchId, month, year }),
        CashierReport.getBranchTarget(branchId, month, year)
      ]);

      return res.json({ success: true, data: { items, target, month, year } });
    } catch (error) {
      if (error.statusCode) {
        return res.status(error.statusCode).json({ success: false, message: error.message });
      }
      next(error);
    }
  },

  // PUT /api/cashier-reports/daily
  saveDaily: async (req, res, next) => {
    try {
      const branchId = resolveBranchId(req);
      if (!branchId) {
        return res.status(400).json({ success: false, message: 'Branch ID wajib dipilih.' });
      }

      const hasAccess = await Branch.userHasAccess(req.userId, branchId, req.user.role);
      if (!hasAccess) {
        return res.status(403).json({ success: false, message: 'Anda tidak memiliki akses ke cabang ini.' });
      }

      // Check role capability (kasir always allowed on assigned outlet; admin checks can_create/can_edit if not master/owner)
      if (req.user.role === 'admin' && req.user.can_create === false && req.user.can_edit === false) {
        return res.status(403).json({
          success: false,
          message: 'Akses Ditolak: Akun Admin Anda tidak memiliki izin input/edit laporan.'
        });
      }

      const reportDate = req.body.report_date || req.query.date;
      if (!reportDate || !/^\d{4}-\d{2}-\d{2}/.test(String(reportDate))) {
        return res.status(400).json({ success: false, message: 'Format tanggal laporan harus YYYY-MM-DD.' });
      }

      const dateOnly = String(reportDate).slice(0, 10);
      const [yStr, mStr] = dateOnly.split('-');
      const isLocked = await LockedPeriod.isLocked(branchId, parseInt(mStr, 10), parseInt(yStr, 10));
      if (isLocked) {
        return res.status(403).json({
          success: false,
          message: 'Pembukuan untuk periode tanggal ini sudah dikunci.'
        });
      }

      const savedSnapshot = await CashierReport.saveDailyReport({
        branchId,
        reportDate: dateOnly,
        payload: req.body,
        user: req.user
      });

      const fullData = await CashierReport.getDailyReport(branchId, dateOnly);

      return res.json({
        success: true,
        message: savedSnapshot.report?.omzet_transaction_id
          ? 'Laporan harian kasir tersimpan & omzet kas berhasil disinkronkan.'
          : 'Laporan harian kasir berhasil disimpan.',
        data: fullData
      });
    } catch (error) {
      if (error.statusCode) {
        return res.status(error.statusCode).json({ success: false, message: error.message });
      }
      next(error);
    }
  },

  // PUT /api/cashier-reports/targets
  upsertTarget: async (req, res, next) => {
    try {
      const branchId = resolveBranchId(req);
      if (!branchId) {
        return res.status(400).json({ success: false, message: 'Branch ID wajib dipilih.' });
      }

      if (!REVIEWER_ROLES.has(req.user.role)) {
        return res.status(403).json({
          success: false,
          message: 'Hanya Admin, Co-Owner, atau Owner yang dapat mengubah target bulanan.'
        });
      }

      const hasAccess = await Branch.userHasAccess(req.userId, branchId, req.user.role);
      if (!hasAccess) {
        return res.status(403).json({ success: false, message: 'Anda tidak memiliki akses ke cabang ini.' });
      }

      const month = parseInt(req.body.month, 10);
      const year = parseInt(req.body.year, 10);
      if (!month || month < 1 || month > 12 || !year || year < 2000) {
        return res.status(400).json({ success: false, message: 'Bulan dan tahun target tidak valid.' });
      }

      const target = await CashierReport.upsertBranchTarget({
        branchId,
        month,
        year,
        target_sales: req.body.target_sales,
        target_tc: req.body.target_tc,
        target_apc: req.body.target_apc,
        user: req.user
      });

      return res.json({
        success: true,
        message: 'Target bulanan outlet berhasil disimpan.',
        data: target
      });
    } catch (error) {
      if (error.statusCode) {
        return res.status(error.statusCode).json({ success: false, message: error.message });
      }
      next(error);
    }
  },

  // POST /api/cashier-reports/:reportId/notes
  addNote: async (req, res, next) => {
    try {
      const branchId = resolveBranchId(req);
      if (!branchId) {
        return res.status(400).json({ success: false, message: 'Branch ID wajib dipilih.' });
      }

      if (!REVIEWER_ROLES.has(req.user.role)) {
        return res.status(403).json({
          success: false,
          message: 'Hanya Admin, Co-Owner, atau Owner yang dapat menambahkan catatan review.'
        });
      }

      const hasAccess = await Branch.userHasAccess(req.userId, branchId, req.user.role);
      if (!hasAccess) {
        return res.status(403).json({ success: false, message: 'Anda tidak memiliki akses ke cabang ini.' });
      }

      const reportId = parseInt(req.params.reportId, 10);
      const content = String(req.body.content || '').trim();
      if (!reportId || !content) {
        return res.status(400).json({ success: false, message: 'Isi catatan wajib diisi.' });
      }

      const note = await CashierReport.addNote({
        reportId,
        branchId,
        noteType: req.body.note_type || 'info',
        content,
        user: req.user
      });

      return res.status(201).json({
        success: true,
        message: 'Catatan review berhasil ditambahkan.',
        data: note
      });
    } catch (error) {
      if (error.message === 'Laporan kasir tidak ditemukan') {
        return res.status(404).json({ success: false, message: error.message });
      }
      next(error);
    }
  },

  // PUT /api/cashier-reports/notes/:noteId/resolve
  toggleNoteResolved: async (req, res, next) => {
    try {
      const branchId = resolveBranchId(req);
      if (!branchId) {
        return res.status(400).json({ success: false, message: 'Branch ID wajib dipilih.' });
      }

      const hasAccess = await Branch.userHasAccess(req.userId, branchId, req.user.role);
      if (!hasAccess) {
        return res.status(403).json({ success: false, message: 'Anda tidak memiliki akses ke cabang ini.' });
      }

      const noteId = parseInt(req.params.noteId, 10);
      const result = await CashierReport.toggleNoteResolved({
        noteId,
        branchId,
        isResolved: Boolean(req.body.is_resolved),
        user: req.user
      });

      return res.json({
        success: true,
        message: result.is_resolved ? 'Catatan ditandai selesai.' : 'Catatan dibuka kembali.',
        data: result
      });
    } catch (error) {
      if (error.message === 'Catatan tidak ditemukan') {
        return res.status(404).json({ success: false, message: error.message });
      }
      next(error);
    }
  },

  // DELETE /api/cashier-reports/notes/:noteId
  deleteNote: async (req, res, next) => {
    try {
      const branchId = resolveBranchId(req);
      if (!branchId) {
        return res.status(400).json({ success: false, message: 'Branch ID wajib dipilih.' });
      }

      if (!REVIEWER_ROLES.has(req.user.role)) {
        return res.status(403).json({
          success: false,
          message: 'Hanya Admin, Co-Owner, atau Owner yang dapat menghapus catatan review.'
        });
      }

      const hasAccess = await Branch.userHasAccess(req.userId, branchId, req.user.role);
      if (!hasAccess) {
        return res.status(403).json({ success: false, message: 'Anda tidak memiliki akses ke cabang ini.' });
      }

      const noteId = parseInt(req.params.noteId, 10);
      await CashierReport.deleteNote({ noteId, branchId, user: req.user });

      return res.json({
        success: true,
        message: 'Catatan review berhasil dihapus.'
      });
    } catch (error) {
      if (error.message === 'Catatan tidak ditemukan') {
        return res.status(404).json({ success: false, message: error.message });
      }
      next(error);
    }
  }
};

module.exports = cashierReportController;
