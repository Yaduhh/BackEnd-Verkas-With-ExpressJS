const axios = require('axios');
const CashierReport = require('../models/CashierReport');
const Branch = require('../models/Branch');
const LockedPeriod = require('../models/LockedPeriod');
const { query } = require('../config/database');
const { parseOrderExcelPreview, buildOrderExcelTemplate } = require('../services/cashierOrderExcelService');

const REVIEWER_ROLES = new Set(['admin', 'owner', 'co-owner', 'master']);

function resolveBranchId(req) {
  const raw = req.query.branch_id || req.body?.branch_id || req.branchId || req.headers['x-branch-id'];
  const parsed = parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

async function authorizePiutangItemAction(req, res, { mode = 'edit' } = {}) {
  if (!REVIEWER_ROLES.has(req.user.role)) {
    res.status(403).json({
      success: false,
      message: 'Hanya Admin, Co-Owner, Owner, atau Master yang dapat mengelola Piutang Mitra.'
    });
    return null;
  }

  if (req.user.role === 'admin') {
    if (mode === 'delete' && req.user.can_delete === false) {
      res.status(403).json({
        success: false,
        message: 'Akses Ditolak: Akun Admin Anda tidak memiliki izin hapus.'
      });
      return null;
    }
    if (mode !== 'delete' && req.user.can_edit === false) {
      res.status(403).json({
        success: false,
        message: 'Akses Ditolak: Akun Admin Anda tidak memiliki izin edit/verifikasi.'
      });
      return null;
    }
  }

  const itemId = parseInt(req.params.itemId, 10);
  if (!Number.isFinite(itemId) || itemId <= 0) {
    res.status(400).json({ success: false, message: 'ID item piutang tidak valid.' });
    return null;
  }

  const item = await CashierReport.getPiutangItemById(itemId);
  if (!item) {
    res.status(404).json({ success: false, message: 'Data Piutang Mitra tidak ditemukan.' });
    return null;
  }

  const branchId = Number(item.report_branch_id);
  const hasAccess = await Branch.userHasAccess(req.userId, branchId, req.user.role);
  if (!hasAccess) {
    res.status(403).json({ success: false, message: 'Anda tidak memiliki akses ke cabang ini.' });
    return null;
  }

  const dateOnly = item.report_date ? String(item.report_date).slice(0, 10) : '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(dateOnly)) {
    const [yStr, mStr] = dateOnly.split('-');
    if (await LockedPeriod.isLocked(branchId, parseInt(mStr, 10), parseInt(yStr, 10))) {
      res.status(403).json({ success: false, message: 'Pembukuan untuk periode tanggal ini sudah dikunci.' });
      return null;
    }
  }

  return { itemId, item, branchId, dateOnly };
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

      const [items, target, branch_config] = await Promise.all([
        CashierReport.listByMonth({ branchId, month, year }),
        CashierReport.getBranchTarget(branchId, month, year),
        CashierReport.getBranchConfig(branchId)
      ]);

      return res.json({ success: true, data: { items, target, branch_config, month, year } });
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

  // POST /api/cashier-reports/pull-pesan-bosgil
  // Tarik data order terbaru langsung dari Pesan-BosGiL backend lalu sinkronkan ke 2 tabel order saja
  pullPesanBosgilOrders: async (req, res, next) => {
    try {
      const branchId = resolveBranchId(req);
      if (!branchId) {
        return res.status(400).json({ success: false, message: 'Branch ID wajib dipilih.' });
      }

      const hasAccess = await Branch.userHasAccess(req.userId, branchId, req.user.role);
      if (!hasAccess) {
        return res.status(403).json({ success: false, message: 'Anda tidak memiliki akses ke cabang ini.' });
      }

      if (req.user.role === 'admin' && req.user.can_create === false && req.user.can_edit === false) {
        return res.status(403).json({
          success: false,
          message: 'Akses Ditolak: Akun Admin Anda tidak memiliki izin menarik/memperbarui data order.'
        });
      }

      const reportDate = req.body?.report_date || req.body?.date || req.query?.date;
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

      const branch = await Branch.findById(branchId);
      if (!branch) {
        return res.status(404).json({ success: false, message: 'Cabang VerKas tidak ditemukan.' });
      }

      // Resolve shared secret / active VerKas API key so Pesan-BosGiL recognizes VerKas backend
      let syncSecret = String(
        process.env.PESAN_BOSGIL_SYNC_SECRET || process.env.PESAN_BOSGIL_API_KEY || ''
      ).trim();
      if (!syncSecret) {
        try {
          const keyRows = await query(
            `SELECT api_key FROM api_keys
             WHERE is_active = 1
               AND (expires_at IS NULL OR expires_at > NOW())
               AND (branch_id = ? OR branch_id IS NULL)
             ORDER BY (branch_id = ?) DESC, id DESC
             LIMIT 1`,
            [branchId, branchId]
          );
          if (keyRows && keyRows[0]?.api_key) {
            syncSecret = String(keyRows[0].api_key).trim();
          }
        } catch (keyErr) {
          console.warn('[CashierReport pullPesanBosgilOrders] Lookup api_keys gagal:', keyErr.message);
        }
      }

      const pesanBosgilBaseUrl = String(
        process.env.PESAN_BOSGIL_API_URL || 'http://127.0.0.1:3002'
      ).replace(/\/+$/, '');

      const headers = { 'Content-Type': 'application/json' };
      if (syncSecret) {
        headers['X-API-Key'] = syncSecret;
        headers['X-Verkas-Sync-Secret'] = syncSecret;
      }

      let pulledData;
      try {
        const response = await axios.post(
          `${pesanBosgilBaseUrl}/verkas-sync/pull-orders`,
          {
            report_date: dateOnly,
            branch_id: branch.id,
            branch_code: branch.code || '',
            branch_key: req.body?.branch_key || '',
            branch_name: branch.name || ''
          },
          { headers, timeout: 15000 }
        );
        pulledData = response.data?.data;
      } catch (pullErr) {
        const remoteStatus = pullErr.response?.status;
        const remoteMsg = pullErr.response?.data?.message;
        if (remoteStatus) {
          return res.status(remoteStatus >= 400 && remoteStatus < 500 ? remoteStatus : 502).json({
            success: false,
            message: remoteMsg || `Gagal menarik data dari Pesan-BosGiL (HTTP ${remoteStatus}).`
          });
        }
        return res.status(502).json({
          success: false,
          message: `Server Pesan-BosGiL tidak dapat dihubungi (${pesanBosgilBaseUrl}): ${pullErr.message}`
        });
      }

      const pulledOrders = Array.isArray(pulledData?.orders) ? pulledData.orders : [];
      const fetchedRefsSet = new Set(
        pulledOrders.map((o) => String(o?.external_reference_id || '').trim()).filter(Boolean)
      );

      // Clean up stale pesan_bosgil rows that were previously synced for this date but no longer exist/match
      const existingReport = await CashierReport.getDailyReport(branchId, dateOnly);
      const existingBosgilRefs = [
        ...(existingReport?.dp_orders || []),
        ...(existingReport?.admin_orders || [])
      ]
        .filter((o) => o?.external_source === 'pesan_bosgil' && o?.external_reference_id)
        .map((o) => String(o.external_reference_id).trim());

      const missingFromFreshPull = existingBosgilRefs.filter((ref) => !fetchedRefsSet.has(ref));
      const mergedDeleteRefs = Array.from(
        new Set([
          ...(Array.isArray(pulledData?.delete_external_refs) ? pulledData.delete_external_refs : []),
          ...missingFromFreshPull
        ])
      );

      const synced = await CashierReport.syncExternalOrders({
        branchId,
        reportDate: dateOnly,
        externalSource: 'pesan_bosgil',
        orders: pulledOrders,
        deleteExternalRefs: mergedDeleteRefs,
        user: {
          id: req.user?.id || req.userId || null,
          name: req.user?.name ? `${req.user.name} (Sinkron Pesan-BosGiL)` : 'Sinkron Pesan-BosGiL',
          role: req.user?.role || 'kasir'
        }
      });

      const fullData = await CashierReport.getDailyReport(branchId, dateOnly);
      const dpCount = Number(pulledData?.dp_deposit_count || 0);
      const adminCount = Number(pulledData?.admin_pesanan_count || 0);

      return res.json({
        success: true,
        message: `Sinkron Pesan-BosGiL selesai (${dpCount} DP/Deposit, ${adminCount} Admin Pesanan).`,
        data: {
          ...fullData,
          sync_result: {
            ...synced,
            fetched_orders: pulledOrders.length,
            dp_deposit_count: dpCount,
            admin_pesanan_count: adminCount,
            bosgil_branch: pulledData?.branch_key || null
          }
        }
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

  // PUT /api/cashier-reports/:reportId/sales-channels
  updateSalesChannels: async (req, res, next) => {
    try {
      const branchId = resolveBranchId(req);
      if (!branchId) {
        return res.status(400).json({ success: false, message: 'Branch ID wajib dipilih.' });
      }

      if (!REVIEWER_ROLES.has(req.user.role)) {
        return res.status(403).json({
          success: false,
          message: 'Hanya Admin, Co-Owner, atau Owner yang dapat mengisi/mengedit Rincian Sales Channel.'
        });
      }

      const hasAccess = await Branch.userHasAccess(req.userId, branchId, req.user.role);
      if (!hasAccess) {
        return res.status(403).json({ success: false, message: 'Anda tidak memiliki akses ke cabang ini.' });
      }

      const reportId = parseInt(req.params.reportId, 10);
      if (!Number.isFinite(reportId) || reportId <= 0) {
        return res.status(400).json({ success: false, message: 'ID laporan tidak valid.' });
      }

      const existing = await CashierReport.getReportSnapshotById(reportId);
      if (!existing || Number(existing.report.branch_id) !== Number(branchId)) {
        return res.status(404).json({ success: false, message: 'Laporan kasir tidak ditemukan.' });
      }

      const hasExistingSalesChannels = Array.isArray(existing.sales_channel_items) && existing.sales_channel_items.length > 0;
      if (req.user.role === 'admin') {
        if (hasExistingSalesChannels && req.user.can_edit === false) {
          return res.status(403).json({
            success: false,
            message: 'Akses Ditolak: Akun Admin Anda tidak memiliki izin edit.'
          });
        }
        if (!hasExistingSalesChannels && req.user.can_create === false && req.user.can_edit === false) {
          return res.status(403).json({
            success: false,
            message: 'Akses Ditolak: Akun Admin Anda tidak memiliki izin input/edit Sales Channel.'
          });
        }
      }

      const dateOnly = String(existing.report.report_date).slice(0, 10);
      if (/^\d{4}-\d{2}-\d{2}$/.test(dateOnly)) {
        const [yStr, mStr] = dateOnly.split('-');
        const isLocked = await LockedPeriod.isLocked(branchId, parseInt(mStr, 10), parseInt(yStr, 10));
        if (isLocked) {
          return res.status(403).json({
            success: false,
            message: 'Pembukuan untuk periode tanggal ini sudah dikunci.'
          });
        }
      }

      await CashierReport.updateReportSalesChannels({
        reportId,
        branchId,
        salesChannelItems: req.body.sales_channel_items,
        user: req.user
      });

      const fullData = await CashierReport.getDailyReport(branchId, dateOnly);

      return res.json({
        success: true,
        message: existing.report.omzet_transaction_id
          ? 'Rincian Sales Channel berhasil disimpan & disinkronkan ke Transaksi Omzet.'
          : 'Rincian Sales Channel berhasil disimpan.',
        data: fullData
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
  },

  // GET /api/cashier-reports/sold-items
  getSoldItemMasters: async (req, res, next) => {
    try {
      const branchId = resolveBranchId(req);
      if (!branchId) {
        return res.status(400).json({ success: false, message: 'Branch ID wajib dipilih.' });
      }
      const hasAccess = await Branch.userHasAccess(req.userId, branchId, req.user.role);
      if (!hasAccess) {
        return res.status(403).json({ success: false, message: 'Anda tidak memiliki akses ke cabang ini.' });
      }
      const includeInactive = req.query.include_inactive !== '0';
      const items = await CashierReport.getSoldItemMasters(branchId, { includeInactive });
      return res.json({ success: true, data: items });
    } catch (error) {
      next(error);
    }
  },

  // POST /api/cashier-reports/sold-items
  createSoldItemMaster: async (req, res, next) => {
    try {
      const branchId = resolveBranchId(req);
      if (!branchId) {
        return res.status(400).json({ success: false, message: 'Branch ID wajib dipilih.' });
      }
      if (!REVIEWER_ROLES.has(req.user.role)) {
        return res.status(403).json({
          success: false,
          message: 'Hanya Admin, Co-Owner, atau Owner yang dapat menambah item terjual.'
        });
      }
      if (req.user.role === 'admin' && req.user.can_edit === false) {
        return res.status(403).json({ success: false, message: 'Akses Ditolak: Akun Admin tidak memiliki izin edit.' });
      }
      const hasAccess = await Branch.userHasAccess(req.userId, branchId, req.user.role);
      if (!hasAccess) {
        return res.status(403).json({ success: false, message: 'Anda tidak memiliki akses ke cabang ini.' });
      }

      const created = await CashierReport.createSoldItemMaster({
        branchId,
        name: req.body.name,
        unit1_label: req.body.unit1_label,
        unit2_label: req.body.unit2_label
      });
      return res.status(201).json({
        success: true,
        message: 'Item laporan terjual berhasil ditambahkan.',
        data: created
      });
    } catch (error) {
      if (error.statusCode) {
        return res.status(error.statusCode).json({ success: false, message: error.message });
      }
      next(error);
    }
  },

  // PUT /api/cashier-reports/sold-items/reorder
  reorderSoldItemMasters: async (req, res, next) => {
    try {
      const branchId = resolveBranchId(req);
      if (!branchId) {
        return res.status(400).json({ success: false, message: 'Branch ID wajib dipilih.' });
      }
      if (!REVIEWER_ROLES.has(req.user.role)) {
        return res.status(403).json({
          success: false,
          message: 'Hanya Admin, Co-Owner, atau Owner yang dapat mengubah urutan item.'
        });
      }
      if (req.user.role === 'admin' && req.user.can_edit === false) {
        return res.status(403).json({ success: false, message: 'Akses Ditolak: Akun Admin tidak memiliki izin edit.' });
      }
      const hasAccess = await Branch.userHasAccess(req.userId, branchId, req.user.role);
      if (!hasAccess) {
        return res.status(403).json({ success: false, message: 'Anda tidak memiliki akses ke cabang ini.' });
      }

      const items = await CashierReport.reorderSoldItemMasters({
        branchId,
        orderedIds: req.body.ordered_ids
      });
      return res.json({ success: true, message: 'Urutan item berhasil diperbarui.', data: items });
    } catch (error) {
      if (error.statusCode) {
        return res.status(error.statusCode).json({ success: false, message: error.message });
      }
      next(error);
    }
  },

  // PUT /api/cashier-reports/sold-items/:itemId
  updateSoldItemMaster: async (req, res, next) => {
    try {
      const branchId = resolveBranchId(req);
      if (!branchId) {
        return res.status(400).json({ success: false, message: 'Branch ID wajib dipilih.' });
      }
      if (!REVIEWER_ROLES.has(req.user.role)) {
        return res.status(403).json({
          success: false,
          message: 'Hanya Admin, Co-Owner, atau Owner yang dapat mengubah item terjual.'
        });
      }
      if (req.user.role === 'admin' && req.user.can_edit === false) {
        return res.status(403).json({ success: false, message: 'Akses Ditolak: Akun Admin tidak memiliki izin edit.' });
      }
      const hasAccess = await Branch.userHasAccess(req.userId, branchId, req.user.role);
      if (!hasAccess) {
        return res.status(403).json({ success: false, message: 'Anda tidak memiliki akses ke cabang ini.' });
      }

      const itemId = parseInt(req.params.itemId, 10);
      const updated = await CashierReport.updateSoldItemMaster({
        branchId,
        itemId,
        name: req.body.name,
        unit1_label: req.body.unit1_label,
        unit2_label: req.body.unit2_label,
        is_active: req.body.is_active
      });
      return res.json({ success: true, message: 'Item laporan terjual berhasil diperbarui.', data: updated });
    } catch (error) {
      if (error.statusCode) {
        return res.status(error.statusCode).json({ success: false, message: error.message });
      }
      next(error);
    }
  },

  // DELETE /api/cashier-reports/sold-items/:itemId
  deleteSoldItemMaster: async (req, res, next) => {
    try {
      const branchId = resolveBranchId(req);
      if (!branchId) {
        return res.status(400).json({ success: false, message: 'Branch ID wajib dipilih.' });
      }
      if (!REVIEWER_ROLES.has(req.user.role)) {
        return res.status(403).json({
          success: false,
          message: 'Hanya Admin, Co-Owner, atau Owner yang dapat menghapus item terjual.'
        });
      }
      if (req.user.role === 'admin' && req.user.can_edit === false) {
        return res.status(403).json({ success: false, message: 'Akses Ditolak: Akun Admin tidak memiliki izin edit.' });
      }
      const hasAccess = await Branch.userHasAccess(req.userId, branchId, req.user.role);
      if (!hasAccess) {
        return res.status(403).json({ success: false, message: 'Anda tidak memiliki akses ke cabang ini.' });
      }

      const itemId = parseInt(req.params.itemId, 10);
      await CashierReport.deleteSoldItemMaster({ branchId, itemId });
      return res.json({ success: true, message: 'Item laporan terjual berhasil dihapus.' });
    } catch (error) {
      if (error.statusCode) {
        return res.status(error.statusCode).json({ success: false, message: error.message });
      }
      next(error);
    }
  },

  // PUT /api/cashier-reports/orders/:orderId/verify
  toggleOrderVerification: async (req, res, next) => {
    try {
      if (!REVIEWER_ROLES.has(req.user.role)) {
        return res.status(403).json({
          success: false,
          message: 'Hanya Admin, Co-Owner, Owner, atau Master yang dapat memverifikasi data order.'
        });
      }

      if (req.user.role === 'admin' && req.user.can_edit === false) {
        return res.status(403).json({
          success: false,
          message: 'Akses Ditolak: Akun Admin Anda tidak memiliki izin verifikasi.'
        });
      }

      const orderId = parseInt(req.params.orderId, 10);
      if (!Number.isFinite(orderId) || orderId <= 0) {
        return res.status(400).json({ success: false, message: 'ID order tidak valid.' });
      }

      const order = await CashierReport.getOrderById(orderId);
      if (!order) {
        return res.status(404).json({ success: false, message: 'Data order tidak ditemukan.' });
      }

      const hasAccess = await Branch.userHasAccess(req.userId, order.branch_id, req.user.role);
      if (!hasAccess) {
        return res.status(403).json({ success: false, message: 'Anda tidak memiliki akses ke cabang ini.' });
      }

      const dateOnly = order.report_date ? String(order.report_date).slice(0, 10) : '';
      if (/^\d{4}-\d{2}-\d{2}$/.test(dateOnly)) {
        const [yStr, mStr] = dateOnly.split('-');
        const isLocked = await LockedPeriod.isLocked(order.branch_id, parseInt(mStr, 10), parseInt(yStr, 10));
        if (isLocked) {
          return res.status(403).json({
            success: false,
            message: 'Pembukuan untuk periode tanggal ini sudah dikunci.'
          });
        }
      }

      const nextVerified =
        typeof req.body?.is_verified === 'boolean'
          ? req.body.is_verified
          : !Boolean(order.is_verified);

      const updated = await CashierReport.toggleOrderVerification({
        orderId,
        isVerified: nextVerified,
        user: req.user
      });

      return res.json({
        success: true,
        message: nextVerified ? 'Order ditandai sudah dicek/benar.' : 'Verifikasi order dibatalkan.',
        data: updated
      });
    } catch (error) {
      if (error.statusCode) {
        return res.status(error.statusCode).json({ success: false, message: error.message });
      }
      next(error);
    }
  },

  // POST /api/cashier-reports/:reportId/piutang
  createPiutangItem: async (req, res, next) => {
    try {
      const branchId = resolveBranchId(req);
      if (!branchId) {
        return res.status(400).json({ success: false, message: 'Branch ID wajib dipilih.' });
      }

      if (!REVIEWER_ROLES.has(req.user.role)) {
        return res.status(403).json({
          success: false,
          message: 'Hanya Admin, Co-Owner, Owner, atau Master yang dapat menginput Piutang Mitra.'
        });
      }

      if (req.user.role === 'admin' && req.user.can_create === false && req.user.can_edit === false) {
        return res.status(403).json({
          success: false,
          message: 'Akses Ditolak: Akun Admin Anda tidak memiliki izin input Piutang Mitra.'
        });
      }

      const hasAccess = await Branch.userHasAccess(req.userId, branchId, req.user.role);
      if (!hasAccess) {
        return res.status(403).json({ success: false, message: 'Anda tidak memiliki akses ke cabang ini.' });
      }

      const reportId = parseInt(req.params.reportId, 10);
      if (!Number.isFinite(reportId) || reportId < 0) {
        return res.status(400).json({ success: false, message: 'ID laporan tidak valid.' });
      }

      let dateOnly = '';
      if (reportId > 0) {
        const existing = await CashierReport.getReportSnapshotById(reportId);
        if (!existing || Number(existing.report.branch_id) !== Number(branchId)) {
          return res.status(404).json({ success: false, message: 'Laporan kasir tidak ditemukan.' });
        }
        dateOnly = String(existing.report.report_date).slice(0, 10);
      } else {
        const rawDate = String(req.body?.report_date || '').slice(0, 10);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(rawDate)) {
          return res.status(400).json({ success: false, message: 'Tanggal laporan (report_date) wajib disertakan.' });
        }
        dateOnly = rawDate;
      }

      if (/^\d{4}-\d{2}-\d{2}$/.test(dateOnly)) {
        const [yStr, mStr] = dateOnly.split('-');
        if (await LockedPeriod.isLocked(branchId, parseInt(mStr, 10), parseInt(yStr, 10))) {
          return res.status(403).json({ success: false, message: 'Pembukuan untuk periode tanggal ini sudah dikunci.' });
        }
      }

      const created = await CashierReport.createPiutangItem({
        reportId,
        reportDate: dateOnly,
        branchId,
        payload: req.body,
        user: req.user
      });

      const fullData = await CashierReport.getDailyReport(branchId, created.report_date || dateOnly);
      return res.status(201).json({
        success: true,
        message: created.attached_to_omzet
          ? created.count > 1
            ? `${created.count} Alokasi Piutang Mitra berhasil ditempelkan ke Omzet #${created.transaction_id} dan saldo Mitra Piutang.`
            : `Alokasi Piutang Mitra berhasil ditempelkan ke Omzet #${created.transaction_id} dan saldo Mitra Piutang.`
          : 'Piutang Mitra tersimpan di laporan kasir dan akan otomatis masuk ke Alokasi Piutang Mitra setelah Transaksi Omzet tanggal ini dibuat.',
        data: fullData
      });
    } catch (error) {
      if (error.statusCode) {
        return res.status(error.statusCode).json({ success: false, message: error.message });
      }
      next(error);
    }
  },

  // PUT /api/cashier-reports/piutang/:itemId
  updatePiutangItem: async (req, res, next) => {
    try {
      const ctx = await authorizePiutangItemAction(req, res, { mode: 'edit' });
      if (!ctx) return;

      await CashierReport.updatePiutangItem({
        itemId: ctx.itemId,
        branchId: ctx.branchId,
        payload: req.body,
        user: req.user
      });

      const fullData = await CashierReport.getDailyReport(ctx.branchId, ctx.dateOnly);
      return res.json({
        success: true,
        message: 'Piutang Mitra berhasil diperbarui.',
        data: fullData
      });
    } catch (error) {
      if (error.statusCode) {
        return res.status(error.statusCode).json({ success: false, message: error.message });
      }
      next(error);
    }
  },

  // DELETE /api/cashier-reports/piutang/:itemId
  deletePiutangItem: async (req, res, next) => {
    try {
      const ctx = await authorizePiutangItemAction(req, res, { mode: 'delete' });
      if (!ctx) return;

      await CashierReport.deletePiutangItem({
        itemId: ctx.itemId,
        branchId: ctx.branchId,
        user: req.user
      });

      const fullData = await CashierReport.getDailyReport(ctx.branchId, ctx.dateOnly);
      return res.json({
        success: true,
        message: 'Piutang Mitra berhasil dihapus.',
        data: fullData
      });
    } catch (error) {
      if (error.statusCode) {
        return res.status(error.statusCode).json({ success: false, message: error.message });
      }
      next(error);
    }
  },

  // PUT /api/cashier-reports/piutang/:itemId/verify
  togglePiutangVerification: async (req, res, next) => {
    try {
      const ctx = await authorizePiutangItemAction(req, res, { mode: 'edit' });
      if (!ctx) return;

      const nextVerified =
        typeof req.body?.is_verified === 'boolean'
          ? req.body.is_verified
          : !Boolean(ctx.item.is_verified);

      const updated = await CashierReport.togglePiutangVerification({
        itemId: ctx.itemId,
        isVerified: nextVerified,
        user: req.user
      });

      return res.json({
        success: true,
        message: nextVerified ? 'Piutang Mitra ditandai sudah dicek/benar.' : 'Verifikasi Piutang Mitra dibatalkan.',
        data: updated
      });
    } catch (error) {
      if (error.statusCode) {
        return res.status(error.statusCode).json({ success: false, message: error.message });
      }
      next(error);
    }
  },

  // PUT /api/cashier-reports/branch-config
  updateBranchConfig: async (req, res, next) => {
    try {
      const branchId = resolveBranchId(req);
      if (!branchId) {
        return res.status(400).json({ success: false, message: 'Branch ID wajib dipilih.' });
      }

      if (!REVIEWER_ROLES.has(req.user.role)) {
        return res.status(403).json({
          success: false,
          message: 'Hanya Admin, Co-Owner, Owner, atau Master yang dapat mengubah template laporan kasir.'
        });
      }

      const hasAccess = await Branch.userHasAccess(req.userId, branchId, req.user.role);
      if (!hasAccess) {
        return res.status(403).json({ success: false, message: 'Anda tidak memiliki akses ke cabang ini.' });
      }

      const { order_template, show_sold_items, show_pesan_bosgil, show_offline_sales, show_hpp, show_entertain_goods, show_tc_apc, show_pb1 } = req.body || {};
      const updated = await CashierReport.updateBranchConfig(branchId, {
        order_template,
        show_sold_items,
        show_pesan_bosgil,
        show_offline_sales,
        show_hpp,
        show_entertain_goods,
        show_tc_apc,
        show_pb1
      });

      return res.json({
        success: true,
        message: 'Pengaturan template laporan kasir berhasil disimpan.',
        data: updated
      });
    } catch (error) {
      if (error.statusCode) {
        return res.status(error.statusCode).json({ success: false, message: error.message });
      }
      next(error);
    }
  },

  // POST /api/cashier-reports/orders/preview-excel
  previewOrderExcel: async (req, res, next) => {
    try {
      const branchId = resolveBranchId(req);
      if (!branchId) {
        return res.status(400).json({ success: false, message: 'Branch ID wajib dipilih.' });
      }

      const hasAccess = await Branch.userHasAccess(req.userId, branchId, req.user.role);
      if (!hasAccess) {
        return res.status(403).json({ success: false, message: 'Anda tidak memiliki akses ke cabang ini.' });
      }

      if (!req.file || !req.file.buffer) {
        return res.status(400).json({ success: false, message: 'File Excel (.xlsx / .xls / .csv) wajib diunggah.' });
      }

      const tableType = String(req.body?.table_type || req.query.table_type || '').trim();
      const requestedSheetName = req.body?.sheet_name || req.query.sheet_name || null;

      const data = await parseOrderExcelPreview({
        buffer: req.file.buffer,
        branchId,
        tableType,
        requestedSheetName: requestedSheetName ? String(requestedSheetName) : null
      });

      return res.json({ success: true, data });
    } catch (error) {
      if (error.statusCode) {
        return res.status(error.statusCode).json({ success: false, message: error.message });
      }
      next(error);
    }
  },

  // GET /api/cashier-reports/orders/template-excel?table_type=...&branch_name=...
  downloadOrderExcelTemplate: async (req, res, next) => {
    try {
      const tableType = String(req.query.table_type || '').trim();
      const branchName = String(req.query.branch_name || '').trim();
      const { buffer, fileName } = await buildOrderExcelTemplate({ tableType, branchName });

      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
      return res.send(Buffer.from(buffer));
    } catch (error) {
      if (error.statusCode) {
        return res.status(error.statusCode).json({ success: false, message: error.message });
      }
      next(error);
    }
  }
};

module.exports = cashierReportController;
