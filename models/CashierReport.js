const { query, transaction: dbTransaction } = require('../config/database');

const toNum = (val) => {
  if (val === null || val === undefined || val === '') return 0;
  const n = Number(val);
  return Number.isFinite(n) ? n : 0;
};

const toNullableNum = (val) => {
  if (val === null || val === undefined || val === '') return null;
  const n = Number(val);
  return Number.isFinite(n) ? n : null;
};

const round2 = (val) => Math.round((toNum(val) + Number.EPSILON) * 100) / 100;

const sanitizeDateOnly = (val) => {
  if (!val) return null;
  const s = String(val).trim();
  const m = s.match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : null;
};

const getEffectiveOmzetRowAmount = (item) => {
  const appAmt = toNum(item.amount_app);
  const cashierAmt = toNum(item.amount_cashier);
  return cashierAmt > 0 ? cashierAmt : appAmt;
};

const stripUploadPath = (raw) => {
  if (!raw || typeof raw !== 'string') return '';
  let val = raw.replace(/\\/g, '/').trim();
  if (!val) return '';
  if (val.startsWith('http://') || val.startsWith('https://')) {
    try {
      const u = new URL(val);
      val = u.pathname || val;
    } catch {
      const idx = val.indexOf('/uploads/');
      if (idx !== -1) val = val.slice(idx);
    }
  }
  const qIdx = val.indexOf('?');
  if (qIdx !== -1) val = val.slice(0, qIdx);
  if (val.startsWith('uploads/')) val = `/${val}`;
  else if (!val.startsWith('/') && !val.includes('/')) val = `/uploads/${val}`;
  return val;
};

const parseLampiranArray = (raw) => {
  if (!raw) return [];
  let arr = [];
  if (Array.isArray(raw)) {
    arr = raw;
  } else if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (!trimmed || trimmed === '[]' || trimmed === 'null') return [];
    if (trimmed.startsWith('[')) {
      try {
        const parsed = JSON.parse(trimmed);
        if (Array.isArray(parsed)) arr = parsed;
      } catch {
        arr = [trimmed];
      }
    } else {
      arr = [trimmed];
    }
  }
  const seen = new Set();
  const out = [];
  for (const item of arr) {
    const cleaned = stripUploadPath(typeof item === 'string' ? item : item?.path || item?.url || '');
    if (cleaned && !seen.has(cleaned)) {
      seen.add(cleaned);
      out.push(cleaned);
    }
  }
  return out;
};

const formatCurrencySimple = (num) => {
  return `Rp ${Math.round(toNum(num)).toLocaleString('id-ID')}`;
};

const FIELD_LABELS = {
  status: 'Status Laporan',
  created_by_names: 'Dibuat Oleh (Kasir)',
  total_customer: 'Total Customer (TC)',
  omzet_gross: 'Total Omzet Penjualan',
  pb1_amount: 'PB1 10%',
  omzet_net: 'Total Omzet Bersih',
  cash_omzet: 'Omset Tunai',
  cash_shift1: 'Omset Shift 1',
  cash_shift2: 'Omset Shift 2',
  endorse_entertaint_total: 'Endorse / Entertaint',
  admin_pesanan_total: 'Admin Pesanan',
  hpp_daily_override: 'HPP Manual',
  operasional_daily_override: 'Operasional Manual',
  ayam_dioven_ekor: 'Ayam Dioven (Ekor)',
  ayam_dioven_potong: 'Ayam Dioven (Potong)',
  ayam_dijual_ekor: 'Ayam Dijual (Ekor)',
  ayam_dijual_potong: 'Ayam Dijual (Potong)',
  ayam_reject_ekor: 'Ayam Reject (Ekor)',
  ayam_reject_potong: 'Ayam Reject (Potong)',
  kambing_presto_ekor: 'Kambing Presto (Ekor)',
  kambing_presto_potong: 'Kambing Presto (Potong)',
  kambing_dijual_ekor: 'Kambing Dijual (Ekor)',
  kambing_dijual_potong: 'Kambing Dijual (Potong)',
  kambing_kecil_ekor: 'Tambahan Kambing Kecil (Ekor)',
  kambing_kecil_potong: 'Tambahan Kambing Kecil (Potong)',
  kasir_notes: 'Catatan Kasir'
};

function computeReportDiff(prevSnapshot, nextSnapshot) {
  const changes = [];
  if (!prevSnapshot) return changes;

  const prevHeader = prevSnapshot.report || {};
  const nextHeader = nextSnapshot.report || {};

  for (const [key, label] of Object.entries(FIELD_LABELS)) {
    const oldVal = prevHeader[key] ?? null;
    const newVal = nextHeader[key] ?? null;
    const oldNorm = typeof oldVal === 'number' || typeof newVal === 'number'
      ? (oldVal === null ? null : toNum(oldVal))
      : String(oldVal ?? '');
    const newNorm = typeof oldVal === 'number' || typeof newVal === 'number'
      ? (newVal === null ? null : toNum(newVal))
      : String(newVal ?? '');

    if (oldNorm !== newNorm) {
      changes.push({
        field: key,
        label,
        oldValue: oldVal,
        newValue: newVal
      });
    }
  }

  // Compare omzet channels by channel_name
  const prevChannels = new Map(
    (prevSnapshot.omzet_items || []).map((i) => [String(i.channel_name || '').trim().toLowerCase(), i])
  );
  const nextChannels = new Map(
    (nextSnapshot.omzet_items || []).map((i) => [String(i.channel_name || '').trim().toLowerCase(), i])
  );
  const allChannelKeys = new Set([...prevChannels.keys(), ...nextChannels.keys()]);
  for (const ck of allChannelKeys) {
    if (!ck) continue;
    const p = prevChannels.get(ck);
    const n = nextChannels.get(ck);
    const pVal = p ? getEffectiveOmzetRowAmount(p) : 0;
    const nVal = n ? getEffectiveOmzetRowAmount(n) : 0;
    const pApp = p ? toNum(p.amount_app) : 0;
    const nApp = n ? toNum(n.amount_app) : 0;
    const pNote = String(p?.notes || '');
    const nNote = String(n?.notes || '');
    if (pVal !== nVal || pApp !== nApp) {
      changes.push({
        field: `omzet_${ck}`,
        label: `Channel ${n?.channel_name || p?.channel_name}`,
        oldValue: p ? { amount_app: pApp, amount_cashier: toNum(p.amount_cashier) } : null,
        newValue: n ? { amount_app: nApp, amount_cashier: toNum(n.amount_cashier) } : null
      });
    }
    if (pNote !== nNote) {
      changes.push({
        field: `omzet_note_${ck}`,
        label: `Keterangan ${n?.channel_name || p?.channel_name}`,
        oldValue: pNote || null,
        newValue: nNote || null
      });
    }
  }

  // Compare counts of detail sections
  const sectionPairs = [
    ['sales_channel_items', 'Rincian Sales Channel'],
    ['entertainments', 'Rincian Entertaint'],
    ['goods_receipts', 'Penerimaan Barang'],
    ['dp_orders', 'Laporan DP / Deposit'],
    ['admin_orders', 'Laporan Admin Pesanan']
  ];
  for (const [key, label] of sectionPairs) {
    const oldArr = prevSnapshot[key] || [];
    const newArr = nextSnapshot[key] || [];
    if (JSON.stringify(oldArr) !== JSON.stringify(newArr)) {
      changes.push({
        field: key,
        label,
        oldValue: `${oldArr.length} baris`,
        newValue: `${newArr.length} baris`
      });
    }
  }

  return changes;
}

class CashierReport {
  static async findOmzetCategoryId(conn, branchId) {
    const [rows] = await conn.execute(
      `SELECT id, name, branch_id
       FROM categories
       WHERE status_deleted = false
         AND (type = 'income' OR type = 'both')
         AND (branch_id = ? OR branch_id IS NULL)
         AND LOWER(name) LIKE '%omzet%'
       ORDER BY (branch_id IS NOT NULL) DESC, is_default DESC, id ASC
       LIMIT 1`,
      [branchId]
    );
    if (rows && rows.length > 0) return rows[0].id;

    const [fallback] = await conn.execute(
      `SELECT id
       FROM categories
       WHERE status_deleted = false
         AND (type = 'income' OR type = 'both')
         AND (branch_id = ? OR branch_id IS NULL)
       ORDER BY (branch_id IS NOT NULL) DESC, is_default DESC, id ASC
       LIMIT 1`,
      [branchId]
    );
    return fallback[0]?.id || null;
  }

  static async resolvePaymentMethodId(conn, branchId, item) {
    if (item.payment_method_id) {
      const [rows] = await conn.execute(
        `SELECT id, is_taxable, default_bank_account_id FROM payment_methods WHERE id = ? LIMIT 1`,
        [item.payment_method_id]
      );
      if (rows && rows.length > 0) return rows[0];
    }

    const name = String(item.channel_name || '').trim();
    if (!name) return null;

    const [byName] = await conn.execute(
      `SELECT id, is_taxable, default_bank_account_id
       FROM payment_methods
       WHERE (branch_id = ? OR branch_id IS NULL)
         AND LOWER(TRIM(name)) = LOWER(?)
       ORDER BY (branch_id IS NOT NULL) DESC, id ASC
       LIMIT 1`,
      [branchId, name]
    );
    if (byName && byName.length > 0) return byName[0];

    // Create branch-scoped payment method so transaction_income_details FK stays clean
    const [ins] = await conn.execute(
      `INSERT INTO payment_methods (name, branch_id, is_taxable, is_active, default_bank_account_id)
       VALUES (?, ?, ?, 1, ?)`,
      [name, branchId, item.is_taxable ? 1 : 0, item.bank_account_id || null]
    );
    return {
      id: ins.insertId,
      is_taxable: item.is_taxable ? 1 : 0,
      default_bank_account_id: item.bank_account_id || null
    };
  }

  static async getBranchTarget(branchId, month, year) {
    const rows = await query(
      `SELECT id, branch_id, month, year, target_sales, target_tc, target_apc, updated_at
       FROM branch_monthly_targets
       WHERE branch_id = ? AND month = ? AND year = ?
       LIMIT 1`,
      [branchId, month, year]
    );
    if (rows && rows.length > 0) {
      return {
        ...rows[0],
        target_sales: toNum(rows[0].target_sales),
        target_tc: parseInt(rows[0].target_tc || 0, 10),
        target_apc: toNum(rows[0].target_apc)
      };
    }
    return {
      branch_id: Number(branchId),
      month: Number(month),
      year: Number(year),
      target_sales: 0,
      target_tc: 0,
      target_apc: 0
    };
  }

  static async upsertBranchTarget({ branchId, month, year, target_sales, target_tc, target_apc, user }) {
    const tSales = round2(target_sales);
    const tTc = Math.max(0, parseInt(target_tc || 0, 10) || 0);
    const tApc = toNum(target_apc) > 0
      ? round2(target_apc)
      : (tTc > 0 && tSales > 0 ? Math.round(tSales / tTc) : 0);

    await query(
      `INSERT INTO branch_monthly_targets (branch_id, month, year, target_sales, target_tc, target_apc, updated_by)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         target_sales = VALUES(target_sales),
         target_tc = VALUES(target_tc),
         target_apc = VALUES(target_apc),
         updated_by = VALUES(updated_by)`,
      [branchId, month, year, tSales, tTc, tApc, user?.id || null]
    );

    return this.getBranchTarget(branchId, month, year);
  }

  static async getLiveMetrics({ branchId, reportDate, targetSales = null }) {
    const dateStr = sanitizeDateOnly(reportDate);
    const [yearStr, monthStr, dayStr] = dateStr.split('-');
    const year = parseInt(yearStr, 10);
    const month = parseInt(monthStr, 10);
    const dayOfMonth = parseInt(dayStr, 10);
    const daysInMonth = new Date(year, month, 0).getDate();
    const monthStart = `${yearStr}-${monthStr}-01`;

    let resolvedTargetSales = targetSales !== null && targetSales !== undefined ? toNum(targetSales) : null;
    if (resolvedTargetSales === null) {
      const target = await this.getBranchTarget(branchId, month, year);
      resolvedTargetSales = toNum(target?.target_sales);
    }

    // 1. MTD aggregates from cashier_daily_reports (day 1 up to reportDate)
    const [mtdRow] = await query(
      `SELECT
         COUNT(*) as reported_days,
         COALESCE(SUM(total_customer), 0) as mtd_tc,
         COALESCE(SUM(omzet_gross), 0) as mtd_omzet_gross,
         COALESCE(SUM(pb1_amount), 0) as mtd_pb1,
         COALESCE(SUM(omzet_net), 0) as mtd_omzet_net,
         COALESCE(SUM(CASE WHEN report_date < ? THEN total_customer ELSE 0 END), 0) as prior_cdr_tc,
         COALESCE(SUM(CASE WHEN report_date < ? THEN omzet_gross ELSE 0 END), 0) as prior_cdr_omzet_gross,
         COALESCE(SUM(CASE WHEN report_date < ? THEN pb1_amount ELSE 0 END), 0) as prior_cdr_pb1,
         COALESCE(SUM(CASE WHEN report_date < ? THEN omzet_net ELSE 0 END), 0) as prior_cdr_omzet_net,
         COALESCE(SUM(CASE WHEN report_date = ? THEN COALESCE(hpp_daily_override, 0) ELSE 0 END), 0) as daily_hpp_kasir,
         COALESCE(SUM(CASE WHEN report_date = ? THEN COALESCE(operasional_daily_override, 0) ELSE 0 END), 0) as daily_operasional_kasir,
         COALESCE(SUM(COALESCE(hpp_daily_override, 0)), 0) as mtd_hpp_kasir,
         COALESCE(SUM(COALESCE(operasional_daily_override, 0)), 0) as mtd_operasional_kasir,
         COALESCE(SUM(CASE WHEN report_date < ? THEN COALESCE(hpp_daily_override, 0) ELSE 0 END), 0) as prior_mtd_hpp_kasir,
         COALESCE(SUM(CASE WHEN report_date < ? THEN COALESCE(operasional_daily_override, 0) ELSE 0 END), 0) as prior_mtd_operasional_kasir,
         COALESCE(SUM(cash_omzet), 0) as mtd_cash_omzet,
         COALESCE(SUM(endorse_entertaint_total), 0) as mtd_endorse,
         COALESCE(SUM(admin_pesanan_total), 0) as mtd_admin_pesanan,
         COALESCE(SUM(ayam_dioven_ekor), 0) as mtd_ayam_dioven_ekor,
         COALESCE(SUM(ayam_dioven_potong), 0) as mtd_ayam_dioven_potong,
         COALESCE(SUM(ayam_dijual_ekor), 0) as mtd_ayam_dijual_ekor,
         COALESCE(SUM(ayam_dijual_potong), 0) as mtd_ayam_dijual_potong,
         COALESCE(SUM(ayam_reject_ekor), 0) as mtd_ayam_reject_ekor,
         COALESCE(SUM(ayam_reject_potong), 0) as mtd_ayam_reject_potong,
         COALESCE(SUM(kambing_presto_ekor), 0) as mtd_kambing_presto_ekor,
         COALESCE(SUM(kambing_presto_potong), 0) as mtd_kambing_presto_potong,
         COALESCE(SUM(kambing_dijual_ekor), 0) as mtd_kambing_dijual_ekor,
         COALESCE(SUM(kambing_dijual_potong), 0) as mtd_kambing_dijual_potong,
         COALESCE(SUM(kambing_kecil_ekor), 0) as mtd_kambing_kecil_ekor,
         COALESCE(SUM(kambing_kecil_potong), 0) as mtd_kambing_kecil_potong
       FROM cashier_daily_reports
       WHERE branch_id = ?
         AND report_date BETWEEN ? AND ?`,
      [dateStr, dateStr, dateStr, dateStr, dateStr, dateStr, dateStr, dateStr, branchId, monthStart, dateStr]
    );

    // 1b. Unlinked Omzet Penjualan transactions in the same MTD window (not already linked to cashier_daily_reports)
    const [txMtdRow] = await query(
      `SELECT
         COUNT(*) as tx_count,
         COALESCE(SUM(src.total_customer), 0) as tx_mtd_tc,
         COALESCE(SUM(src.amount), 0) as tx_mtd_gross,
         COALESCE(SUM(src.tx_pb1), 0) as tx_mtd_pb1,
         COALESCE(SUM(GREATEST(0, src.amount - src.tx_pb1)), 0) as tx_mtd_net,
         COALESCE(SUM(CASE WHEN DATE(src.transaction_date) < ? THEN src.total_customer ELSE 0 END), 0) as tx_prior_tc,
         COALESCE(SUM(CASE WHEN DATE(src.transaction_date) < ? THEN src.amount ELSE 0 END), 0) as tx_prior_gross,
         COALESCE(SUM(CASE WHEN DATE(src.transaction_date) < ? THEN src.tx_pb1 ELSE 0 END), 0) as tx_prior_pb1,
         COALESCE(SUM(CASE WHEN DATE(src.transaction_date) < ? THEN GREATEST(0, src.amount - src.tx_pb1) ELSE 0 END), 0) as tx_prior_net
       FROM (
         SELECT
           t.id,
           t.transaction_date,
           t.amount,
           COALESCE(t.total_customer, 0) as total_customer,
           COALESCE(
             t.pb1,
             (
               SELECT COALESCE(SUM(
                 COALESCE(
                   tid.pb1_amount,
                   CASE WHEN pm.is_taxable = 1
                     THEN ROUND((CASE WHEN tid.amount_cashier > 0 THEN tid.amount_cashier ELSE tid.amount_app END) * 10 / 110)
                     ELSE 0
                   END
                 )
               ), 0)
               FROM transaction_income_details tid
               LEFT JOIN payment_methods pm ON tid.payment_method_id = pm.id
               WHERE tid.transaction_id = t.id
             ),
             0
           ) as tx_pb1
         FROM transactions t
         LEFT JOIN categories c ON t.category_id = c.id
         WHERE t.branch_id = ?
           AND t.type = 'income'
           AND t.status_deleted = false
           AND (t.is_draft = false OR t.is_draft IS NULL)
           AND t.is_umum = 1
           AND LOWER(COALESCE(c.name, '')) LIKE '%omzet%'
           AND DATE(t.transaction_date) BETWEEN ? AND ?
           AND t.id NOT IN (
             SELECT omzet_transaction_id
             FROM cashier_daily_reports
             WHERE branch_id = ? AND omzet_transaction_id IS NOT NULL
           )
       ) src`,
      [dateStr, dateStr, dateStr, dateStr, branchId, monthStart, dateStr, branchId]
    );

    // 2. Per-channel MTD totals (cashier_report_omzet_items + unlinked transaction_income_details)
    const channelMtdRows = await query(
      `SELECT
         COALESCE(croi.payment_method_id, 0) as payment_method_id,
         croi.channel_name,
         COALESCE(SUM(CASE WHEN croi.amount_cashier > 0 THEN croi.amount_cashier ELSE croi.amount_app END), 0) as mtd_amount,
         COALESCE(SUM(CASE WHEN cdr.report_date < ? THEN (CASE WHEN croi.amount_cashier > 0 THEN croi.amount_cashier ELSE croi.amount_app END) ELSE 0 END), 0) as prior_mtd_amount,
         COALESCE(SUM(croi.pb1_amount), 0) as mtd_pb1
       FROM cashier_report_omzet_items croi
       JOIN cashier_daily_reports cdr ON croi.report_id = cdr.id
       WHERE cdr.branch_id = ?
         AND cdr.report_date BETWEEN ? AND ?
       GROUP BY COALESCE(croi.payment_method_id, 0), croi.channel_name`,
      [dateStr, branchId, monthStart, dateStr]
    );

    const txChannelMtdRows = await query(
      `SELECT
         COALESCE(tid.payment_method_id, 0) as payment_method_id,
         COALESCE(pm.name, 'Lainnya') as channel_name,
         COALESCE(SUM(CASE WHEN tid.amount_cashier > 0 THEN tid.amount_cashier ELSE tid.amount_app END), 0) as mtd_amount,
         COALESCE(SUM(CASE WHEN DATE(t.transaction_date) < ? THEN (CASE WHEN tid.amount_cashier > 0 THEN tid.amount_cashier ELSE tid.amount_app END) ELSE 0 END), 0) as prior_mtd_amount,
         COALESCE(SUM(
           COALESCE(
             tid.pb1_amount,
             CASE WHEN pm.is_taxable = 1
               THEN ROUND((CASE WHEN tid.amount_cashier > 0 THEN tid.amount_cashier ELSE tid.amount_app END) * 10 / 110)
               ELSE 0
             END
           )
         ), 0) as mtd_pb1
       FROM transaction_income_details tid
       JOIN transactions t ON tid.transaction_id = t.id
       LEFT JOIN categories c ON t.category_id = c.id
       LEFT JOIN payment_methods pm ON tid.payment_method_id = pm.id
       WHERE t.branch_id = ?
         AND t.type = 'income'
         AND t.status_deleted = false
         AND (t.is_draft = false OR t.is_draft IS NULL)
         AND t.is_umum = 1
         AND LOWER(COALESCE(c.name, '')) LIKE '%omzet%'
         AND DATE(t.transaction_date) BETWEEN ? AND ?
         AND t.id NOT IN (
           SELECT omzet_transaction_id
           FROM cashier_daily_reports
           WHERE branch_id = ? AND omzet_transaction_id IS NOT NULL
         )
       GROUP BY COALESCE(tid.payment_method_id, 0), COALESCE(pm.name, 'Lainnya')`,
      [dateStr, branchId, monthStart, dateStr, branchId]
    );

    const channelMap = new Map();
    let txCashOmzet = 0;
    const mergeChannelRows = (rows, isFromTx = false) => {
      for (const r of rows) {
        const pmId = Number(r.payment_method_id) || null;
        const name = String(r.channel_name || 'Lainnya');
        const key = pmId ? `id:${pmId}` : `name:${name.toLowerCase().trim()}`;
        const amt = toNum(r.mtd_amount);
        const priorAmt = toNum(r.prior_mtd_amount);
        const pb1 = toNum(r.mtd_pb1);
        if (isFromTx) {
          const lowerName = name.toLowerCase();
          if (lowerName.includes('cash') || lowerName.includes('tunai')) {
            txCashOmzet += amt;
          }
        }
        const existing = channelMap.get(key);
        if (existing) {
          existing.mtd_amount += amt;
          existing.prior_mtd_amount += priorAmt;
          existing.mtd_pb1 += pb1;
        } else {
          channelMap.set(key, {
            payment_method_id: pmId,
            channel_name: name,
            mtd_amount: amt,
            prior_mtd_amount: priorAmt,
            mtd_pb1: pb1
          });
        }
      }
    };
    mergeChannelRows(channelMtdRows, false);
    mergeChannelRows(txChannelMtdRows, true);
    const mergedChannelMtd = Array.from(channelMap.values());

    // 3. HPP / Bahan Baku & Operasional dihitung dari akumulasi inputan harian kasir (cashier_daily_reports)

    const mtdTc = parseInt(mtdRow?.mtd_tc || 0, 10) + parseInt(txMtdRow?.tx_mtd_tc || 0, 10);
    const mtdOmzetGross = toNum(mtdRow?.mtd_omzet_gross) + toNum(txMtdRow?.tx_mtd_gross);
    const mtdPb1 = toNum(mtdRow?.mtd_pb1) + toNum(txMtdRow?.tx_mtd_pb1);
    const mtdOmzetNet = toNum(mtdRow?.mtd_omzet_net) + toNum(txMtdRow?.tx_mtd_net);
    const mtdApc = mtdTc > 0 ? Math.round(mtdOmzetNet / mtdTc) : 0;

    const priorMtdTc = parseInt(mtdRow?.prior_cdr_tc || 0, 10) + parseInt(txMtdRow?.tx_prior_tc || 0, 10);
    const priorMtdOmzetGross = toNum(mtdRow?.prior_cdr_omzet_gross) + toNum(txMtdRow?.tx_prior_gross);
    const priorMtdPb1 = toNum(mtdRow?.prior_cdr_pb1) + toNum(txMtdRow?.tx_prior_pb1);
    const priorMtdOmzetNet = toNum(mtdRow?.prior_cdr_omzet_net) + toNum(txMtdRow?.tx_prior_net);

    // Monthulized = TARGET SALES - TOTAL OMZET BERSIH BULAN BERJALAN (Excel: E8 = E7 - E36)
    const monthulizedOmzetNet = resolvedTargetSales > 0 ? Math.round(resolvedTargetSales - mtdOmzetNet) : 0;
    const monthulizedTc = dayOfMonth > 0 ? Math.round((mtdTc / dayOfMonth) * daysInMonth) : 0;
    const projectedOmzetNet = dayOfMonth > 0 ? Math.round((mtdOmzetNet / dayOfMonth) * daysInMonth) : 0;
    const monthulizedApc = monthulizedTc > 0 ? Math.round(projectedOmzetNet / monthulizedTc) : 0;

    return {
      period: { month, year, day_of_month: dayOfMonth, days_in_month: daysInMonth, month_start: monthStart },
      reported_days: parseInt(mtdRow?.reported_days || 0, 10) + parseInt(txMtdRow?.tx_count || 0, 10),
      mtd_tc: mtdTc,
      mtd_apc: mtdApc,
      mtd_omzet_gross: mtdOmzetGross,
      mtd_pb1: mtdPb1,
      mtd_omzet_net: mtdOmzetNet,
      prior_mtd_tc: priorMtdTc,
      prior_mtd_omzet_gross: priorMtdOmzetGross,
      prior_mtd_pb1: priorMtdPb1,
      prior_mtd_omzet_net: priorMtdOmzetNet,
      mtd_cash_omzet: toNum(mtdRow?.mtd_cash_omzet) + txCashOmzet,
      mtd_endorse: toNum(mtdRow?.mtd_endorse),
      mtd_admin_pesanan: toNum(mtdRow?.mtd_admin_pesanan),
      monthulized_omzet_net: monthulizedOmzetNet,
      monthulized_tc: monthulizedTc,
      monthulized_apc: monthulizedApc,
      channel_mtd: mergedChannelMtd,
      expenses: {
        hpp_daily: toNum(mtdRow?.daily_hpp_kasir),
        operasional_daily: toNum(mtdRow?.daily_operasional_kasir),
        hpp_mtd: toNum(mtdRow?.mtd_hpp_kasir),
        operasional_mtd: toNum(mtdRow?.mtd_operasional_kasir),
        prior_hpp_mtd: toNum(mtdRow?.prior_mtd_hpp_kasir),
        prior_operasional_mtd: toNum(mtdRow?.prior_mtd_operasional_kasir)
      },
      poultry_mtd: {
        ayam_dioven_ekor: toNum(mtdRow?.mtd_ayam_dioven_ekor),
        ayam_dioven_potong: toNum(mtdRow?.mtd_ayam_dioven_potong),
        ayam_dijual_ekor: toNum(mtdRow?.mtd_ayam_dijual_ekor),
        ayam_dijual_potong: toNum(mtdRow?.mtd_ayam_dijual_potong),
        ayam_reject_ekor: toNum(mtdRow?.mtd_ayam_reject_ekor),
        ayam_reject_potong: toNum(mtdRow?.mtd_ayam_reject_potong),
        kambing_presto_ekor: toNum(mtdRow?.mtd_kambing_presto_ekor),
        kambing_presto_potong: toNum(mtdRow?.mtd_kambing_presto_potong),
        kambing_dijual_ekor: toNum(mtdRow?.mtd_kambing_dijual_ekor),
        kambing_dijual_potong: toNum(mtdRow?.mtd_kambing_dijual_potong),
        kambing_kecil_ekor: toNum(mtdRow?.mtd_kambing_kecil_ekor),
        kambing_kecil_potong: toNum(mtdRow?.mtd_kambing_kecil_potong)
      }
    };
  }

  static async getReportSnapshotById(reportId, conn = null) {
    const exec = conn ? (sql, p) => conn.execute(sql, p).then(([r]) => r) : query;

    const reports = await exec(
      `SELECT cdr.*, COALESCE(u.name, u.email) as submitted_by_name, u.role as submitted_by_role,
              t.amount as synced_transaction_amount, t.status_deleted as synced_transaction_deleted
       FROM cashier_daily_reports cdr
       LEFT JOIN users u ON cdr.submitted_by = u.id
       LEFT JOIN transactions t ON cdr.omzet_transaction_id = t.id
       WHERE cdr.id = ?
       LIMIT 1`,
      [reportId]
    );
    if (!reports || reports.length === 0) return null;

    const r = reports[0];
    const numericHeader = {
      ...r,
      total_customer: parseInt(r.total_customer || 0, 10),
      apc: toNum(r.apc),
      omzet_gross: toNum(r.omzet_gross),
      pb1_amount: toNum(r.pb1_amount),
      pb1_app_amount: toNullableNum(r.pb1_app_amount),
      omzet_net: toNum(r.omzet_net),
      omzet_sales_app: toNullableNum(r.omzet_sales_app),
      omzet_sales_cashier: toNullableNum(r.omzet_sales_cashier),
      omzet_sales_notes: r.omzet_sales_notes || '',
      cash_omzet: toNum(r.cash_omzet),
      cash_shift1: toNum(r.cash_shift1),
      cash_shift2: toNum(r.cash_shift2),
      endorse_entertaint_total: toNum(r.endorse_entertaint_total),
      admin_pesanan_total: toNum(r.admin_pesanan_total),
      hpp_daily_override: toNullableNum(r.hpp_daily_override),
      operasional_daily_override: toNullableNum(r.operasional_daily_override),
      ayam_dioven_ekor: toNum(r.ayam_dioven_ekor),
      ayam_dioven_potong: toNum(r.ayam_dioven_potong),
      ayam_dijual_ekor: toNum(r.ayam_dijual_ekor),
      ayam_dijual_potong: toNum(r.ayam_dijual_potong),
      ayam_reject_ekor: toNum(r.ayam_reject_ekor),
      ayam_reject_potong: toNum(r.ayam_reject_potong),
      kambing_presto_ekor: toNum(r.kambing_presto_ekor),
      kambing_presto_potong: toNum(r.kambing_presto_potong),
      kambing_dijual_ekor: toNum(r.kambing_dijual_ekor),
      kambing_dijual_potong: toNum(r.kambing_dijual_potong),
      kambing_kecil_ekor: toNum(r.kambing_kecil_ekor),
      kambing_kecil_potong: toNum(r.kambing_kecil_potong),
      auto_sync_omzet: Boolean(r.auto_sync_omzet)
    };

    const omzetItems = await exec(
      `SELECT croi.*, pm.name as payment_method_name, pm.parent_id as parent_id, pm.sort_order as pm_sort_order,
              COALESCE(ba.name, ba_def.name) as bank_account_name
       FROM cashier_report_omzet_items croi
       LEFT JOIN payment_methods pm ON croi.payment_method_id = pm.id
       LEFT JOIN bank_accounts ba ON croi.bank_account_id = ba.id
       LEFT JOIN bank_accounts ba_def ON pm.default_bank_account_id = ba_def.id
       WHERE croi.report_id = ?
       ORDER BY COALESCE(pm.sort_order, 999999) ASC, croi.sort_order ASC, croi.id ASC`,
      [reportId]
    );

    const salesChannelItems = await exec(
      `SELECT crsc.*, sc.name as master_sales_channel_name, pm.name as master_payment_method_name
       FROM cashier_report_sales_channels crsc
       LEFT JOIN sales_channels sc ON crsc.sales_channel_id = sc.id
       LEFT JOIN payment_methods pm ON crsc.payment_method_id = pm.id
       WHERE crsc.report_id = ?
       ORDER BY crsc.sort_order ASC, crsc.id ASC`,
      [reportId]
    );

    const entertainments = await exec(
      `SELECT * FROM cashier_report_entertainments WHERE report_id = ? ORDER BY sort_order ASC, id ASC`,
      [reportId]
    );

    const goodsReceipts = await exec(
      `SELECT * FROM cashier_report_goods_receipts WHERE report_id = ? ORDER BY sort_order ASC, id ASC`,
      [reportId]
    );

    const orders = await exec(
      `SELECT cro.*, ba.name as bank_account_name, ba_set.name as settlement_bank_account_name
       FROM cashier_report_orders cro
       LEFT JOIN bank_accounts ba ON cro.bank_account_id = ba.id
       LEFT JOIN bank_accounts ba_set ON cro.settlement_bank_account_id = ba_set.id
       WHERE cro.report_id = ?
       ORDER BY cro.sort_order ASC, cro.id ASC`,
      [reportId]
    );

    const formatOrderRow = (o) => ({
      ...o,
      bank_account_id: o.bank_account_id ? Number(o.bank_account_id) : null,
      bank_account_name: o.bank_account_name || o.dp_channel || null,
      settlement_bank_account_id: o.settlement_bank_account_id ? Number(o.settlement_bank_account_id) : null,
      settlement_bank_account_name: o.settlement_bank_account_name || o.settlement_channel || null,
      product_total_amount: toNum(o.product_total_amount),
      tf_bca_amount: toNum(o.tf_bca_amount),
      tf_mandiri_amount: toNum(o.tf_mandiri_amount),
      dp_amount: toNum(o.dp_amount),
      settlement_amount: toNum(o.settlement_amount),
      ongkir_bca_amount: toNum(o.ongkir_bca_amount),
      ongkir_mandiri_amount: toNum(o.ongkir_mandiri_amount),
      ongkir_amount: toNum(o.ongkir_amount),
      total_amount: toNum(o.total_amount)
    });

    const notes = await exec(
      `SELECT * FROM cashier_report_notes WHERE report_id = ? ORDER BY created_at DESC, id DESC`,
      [reportId]
    );

    const logs = await exec(
      `SELECT * FROM cashier_report_logs WHERE report_id = ? ORDER BY created_at DESC, id DESC LIMIT 100`,
      [reportId]
    );

    return {
      report: numericHeader,
      omzet_items: omzetItems.map((i) => ({
        ...i,
        amount_app: toNum(i.amount_app),
        amount_cashier: toNum(i.amount_cashier),
        pb1_amount: toNum(i.pb1_amount),
        is_taxable: Boolean(i.is_taxable),
        lampiran: parseLampiranArray(i.lampiran)
      })),
      sales_channel_items: salesChannelItems.map((sc) => ({
        id: sc.id,
        report_id: sc.report_id,
        sales_channel_id: sc.sales_channel_id ? Number(sc.sales_channel_id) : null,
        sales_channel_name: sc.master_sales_channel_name || sc.sales_channel_name || '',
        payment_method_id: sc.payment_method_id ? Number(sc.payment_method_id) : null,
        payment_method_name: sc.master_payment_method_name || sc.payment_method_name || '',
        omzet_item_index:
          sc.omzet_item_index !== null && sc.omzet_item_index !== undefined
            ? Number(sc.omzet_item_index)
            : null,
        amount: toNum(sc.amount),
        pb1_amount: sc.pb1_amount !== null && sc.pb1_amount !== undefined ? toNum(sc.pb1_amount) : null,
        sort_order: sc.sort_order
      })),
      entertainments: entertainments.map((e) => ({
        ...e,
        total_price: toNum(e.total_price)
      })),
      goods_receipts: goodsReceipts.map((g) => ({
        ...g,
        qty: toNum(g.qty)
      })),
      dp_orders: orders
        .filter((o) => o.order_section === 'dp_deposit')
        .map(formatOrderRow),
      admin_orders: orders
        .filter((o) => o.order_section === 'admin_pesanan')
        .map(formatOrderRow),
      notes: notes.map((n) => ({
        ...n,
        is_resolved: Boolean(n.is_resolved)
      })),
      logs: logs.map((l) => ({
        ...l,
        changes: typeof l.changes === 'string' ? JSON.parse(l.changes || '[]') : (l.changes || [])
      }))
    };
  }

  static async getLegacyOmzetSnapshot(branchId, dateStr) {
    const txRows = await query(
      `SELECT t.id, t.user_id, t.amount, t.total_customer, t.apc, t.pb1, t.note, t.created_at, t.updated_at,
              COALESCE(u.name, u.email) as user_name
       FROM transactions t
       LEFT JOIN categories c ON t.category_id = c.id
       LEFT JOIN users u ON t.user_id = u.id
       WHERE t.branch_id = ?
         AND t.type = 'income'
         AND t.status_deleted = false
         AND (t.is_draft = false OR t.is_draft IS NULL)
         AND t.is_umum = 1
         AND LOWER(COALESCE(c.name, '')) LIKE '%omzet%'
         AND DATE(t.transaction_date) = ?
       ORDER BY t.id ASC`,
      [branchId, dateStr]
    );

    if (!txRows || txRows.length === 0) {
      return null;
    }

    const txIds = txRows.map((t) => Number(t.id)).filter(Boolean);
    const placeholders = txIds.map(() => '?').join(', ');
    const detailRows = txIds.length > 0
      ? await query(
          `SELECT tid.payment_method_id, tid.bank_account_id, tid.amount_app, tid.amount_cashier, tid.pb1_amount, tid.lampiran,
                  pm.name as payment_method_name, pm.parent_id, pm.is_taxable, ba.name as bank_account_name
           FROM transaction_income_details tid
           LEFT JOIN payment_methods pm ON tid.payment_method_id = pm.id
           LEFT JOIN bank_accounts ba ON tid.bank_account_id = ba.id
           WHERE tid.transaction_id IN (${placeholders})
           ORDER BY tid.id ASC`,
          txIds
        )
      : [];

    const itemMap = new Map();
    for (const d of detailRows) {
      const pmId = d.payment_method_id ? Number(d.payment_method_id) : null;
      const channelName = d.payment_method_name || 'Lainnya';
      const key = pmId ? `id:${pmId}` : `name:${channelName.toLowerCase().trim()}`;
      const appAmt = toNum(d.amount_app);
      const cashierAmt = toNum(d.amount_cashier);
      const pb1Amt = toNum(d.pb1_amount);
      const rowLampiran = parseLampiranArray(d.lampiran);

      const existing = itemMap.get(key);
      if (existing) {
        existing.amount_app = round2(existing.amount_app + appAmt);
        existing.amount_cashier = round2(existing.amount_cashier + cashierAmt);
        existing.pb1_amount = round2(existing.pb1_amount + pb1Amt);
        if (rowLampiran.length > 0) {
          existing.lampiran = Array.from(new Set([...(existing.lampiran || []), ...rowLampiran]));
        }
      } else {
        itemMap.set(key, {
          payment_method_id: pmId,
          parent_id: d.parent_id ? Number(d.parent_id) : null,
          payment_method_name: d.payment_method_name || undefined,
          channel_name: channelName,
          bank_account_id: d.bank_account_id ? Number(d.bank_account_id) : null,
          bank_account_name: d.bank_account_name || undefined,
          amount_app: appAmt,
          amount_cashier: cashierAmt,
          is_taxable: Boolean(d.is_taxable),
          pb1_amount: pb1Amt,
          sort_order: itemMap.size,
          notes: '',
          lampiran: rowLampiran
        });
      }
    }

    const legacyScRows = txIds.length > 0
      ? await query(
          `SELECT tsc.sales_channel_id, tsc.payment_method_id, tsc.amount, tsc.pb1_amount,
                  sc.name as sales_channel_name, pm.name as payment_method_name
           FROM transaction_sales_channels tsc
           LEFT JOIN sales_channels sc ON tsc.sales_channel_id = sc.id
           LEFT JOIN payment_methods pm ON tsc.payment_method_id = pm.id
           WHERE tsc.transaction_id IN (${placeholders})
           ORDER BY tsc.id ASC`,
          txIds
        )
      : [];

    const omzetItems = Array.from(itemMap.values());
    const legacySalesChannelItems = legacyScRows.map((row, idx) => ({
      sales_channel_id: row.sales_channel_id ? Number(row.sales_channel_id) : null,
      sales_channel_name: row.sales_channel_name || '',
      payment_method_id: row.payment_method_id ? Number(row.payment_method_id) : null,
      payment_method_name: row.payment_method_name || '',
      omzet_item_index: null,
      amount: toNum(row.amount),
      pb1_amount: row.pb1_amount !== null && row.pb1_amount !== undefined ? toNum(row.pb1_amount) : null,
      sort_order: idx
    }));
    const omzetGross = round2(txRows.reduce((s, t) => s + toNum(t.amount), 0));
    const detailPb1Sum = round2(omzetItems.reduce((s, i) => s + toNum(i.pb1_amount), 0));
    const pb1Amount = round2(
      txRows.reduce((s, t) => s + (t.pb1 !== null && t.pb1 !== undefined ? toNum(t.pb1) : 0), 0)
    ) || detailPb1Sum;
    const omzetNet = Math.max(0, round2(omzetGross - pb1Amount));
    const totalCustomer = txRows.reduce((s, t) => s + parseInt(t.total_customer || 0, 10), 0);
    const apc =
      txRows.length === 1 && toNum(txRows[0].apc) > 0
        ? toNum(txRows[0].apc)
        : (totalCustomer > 0 ? Math.round(omzetNet / totalCustomer) : 0);
    const totalAppSum = round2(omzetItems.reduce((s, i) => s + toNum(i.amount_app), 0));
    const cashOmzet = round2(
      omzetItems
        .filter((i) => {
          const lower = String(i.channel_name || '').toLowerCase();
          return lower.includes('cash') || lower.includes('tunai');
        })
        .reduce((s, i) => s + (toNum(i.amount_cashier) > 0 ? toNum(i.amount_cashier) : toNum(i.amount_app)), 0)
    );
    const combinedNotes = txRows.map((t) => t.note).filter(Boolean).join('; ');

    return {
      report: {
        id: 0,
        branch_id: Number(branchId),
        report_date: dateStr,
        created_by_names: txRows[0].user_name || null,
        submitted_by: txRows[0].user_id || null,
        submitted_by_name: txRows[0].user_name || null,
        submitted_by_role: null,
        status: 'submitted',
        is_legacy_transaction: true,
        total_customer: totalCustomer,
        apc,
        omzet_gross: omzetGross,
        pb1_amount: pb1Amount,
        pb1_app_amount: null,
        omzet_net: omzetNet,
        omzet_sales_app: totalAppSum > 0 ? totalAppSum : null,
        omzet_sales_cashier: omzetGross > 0 ? omzetGross : null,
        omzet_sales_notes: combinedNotes || '',
        cash_omzet: cashOmzet,
        cash_shift1: 0,
        cash_shift2: 0,
        endorse_entertaint_total: 0,
        admin_pesanan_total: 0,
        hpp_daily_override: null,
        operasional_daily_override: null,
        ayam_dioven_ekor: 0,
        ayam_dioven_potong: 0,
        ayam_dijual_ekor: 0,
        ayam_dijual_potong: 0,
        ayam_reject_ekor: 0,
        ayam_reject_potong: 0,
        kambing_presto_ekor: 0,
        kambing_presto_potong: 0,
        kambing_dijual_ekor: 0,
        kambing_dijual_potong: 0,
        kambing_kecil_ekor: 0,
        kambing_kecil_potong: 0,
        kasir_notes: combinedNotes || null,
        omzet_transaction_id: Number(txRows[0].id),
        auto_sync_omzet: true,
        last_synced_at: null,
        created_at: txRows[0].created_at,
        updated_at: txRows[0].updated_at
      },
      omzet_items: omzetItems,
      sales_channel_items: legacySalesChannelItems,
      entertainments: [],
      goods_receipts: [],
      dp_orders: [],
      admin_orders: [],
      notes: [],
      logs: []
    };
  }

  static async getDailyReport(branchId, reportDate) {
    const dateStr = sanitizeDateOnly(reportDate) || new Date().toISOString().split('T')[0];
    const [yearStr, monthStr] = dateStr.split('-');
    const year = parseInt(yearStr, 10);
    const month = parseInt(monthStr, 10);

    const existingRows = await query(
      `SELECT id FROM cashier_daily_reports WHERE branch_id = ? AND report_date = ? LIMIT 1`,
      [branchId, dateStr]
    );

    let snapshot = existingRows.length > 0
      ? await this.getReportSnapshotById(existingRows[0].id)
      : null;

    if (!snapshot) {
      snapshot = await this.getLegacyOmzetSnapshot(branchId, dateStr);
    }

    const target = await this.getBranchTarget(branchId, month, year);
    const [liveMetrics, paymentMethods, bankAccounts, salesChannels] = await Promise.all([
      this.getLiveMetrics({ branchId, reportDate: dateStr, targetSales: target.target_sales }),
      query(
        `SELECT pm.*, ba.name as default_bank_account_name
         FROM payment_methods pm
         LEFT JOIN bank_accounts ba ON pm.default_bank_account_id = ba.id
         WHERE (pm.branch_id = ? OR pm.branch_id IS NULL) AND pm.is_active = 1
         ORDER BY pm.sort_order ASC, pm.name ASC, pm.id ASC`,
        [branchId]
      ),
      query(
        `SELECT id, name, account_number, type
         FROM bank_accounts
         WHERE branch_id = ? AND is_active = 1 AND type != 'savings'
         ORDER BY name ASC`,
        [branchId]
      ),
      query(
        `SELECT id, name, description, category_id
         FROM sales_channels
         WHERE branch_id = ? AND status_deleted = 0 AND is_active = 1
         ORDER BY name ASC, id ASC`,
        [branchId]
      )
    ]);

    return {
      report_date: dateStr,
      branch_id: Number(branchId),
      report: snapshot ? snapshot.report : null,
      omzet_items: snapshot ? snapshot.omzet_items : [],
      sales_channel_items: snapshot ? (snapshot.sales_channel_items || []) : [],
      entertainments: snapshot ? snapshot.entertainments : [],
      goods_receipts: snapshot ? snapshot.goods_receipts : [],
      dp_orders: snapshot ? snapshot.dp_orders : [],
      admin_orders: snapshot ? snapshot.admin_orders : [],
      notes: snapshot ? snapshot.notes : [],
      logs: snapshot ? snapshot.logs : [],
      target,
      live_metrics: liveMetrics,
      payment_methods: paymentMethods.map((pm) => ({
        ...pm,
        is_taxable: Boolean(pm.is_taxable)
      })),
      bank_accounts: bankAccounts,
      sales_channels: salesChannels
    };
  }

  static async listByMonth({ branchId, month, year }) {
    const start = `${year}-${String(month).padStart(2, '0')}-01`;
    const endDay = new Date(year, month, 0).getDate();
    const end = `${year}-${String(month).padStart(2, '0')}-${String(endDay).padStart(2, '0')}`;

    const rows = await query(
      `SELECT cdr.id, cdr.branch_id, cdr.report_date, cdr.created_by_names, cdr.status,
              cdr.total_customer, cdr.apc, cdr.omzet_gross, cdr.pb1_amount, cdr.omzet_net,
              cdr.cash_omzet, cdr.endorse_entertaint_total, cdr.admin_pesanan_total,
              cdr.omzet_transaction_id, cdr.last_synced_at, cdr.updated_at,
              COALESCE(u.name, u.email) as submitted_by_name,
              (SELECT COUNT(*) FROM cashier_report_notes crn WHERE crn.report_id = cdr.id) as notes_count,
              (SELECT COUNT(*) FROM cashier_report_notes crn WHERE crn.report_id = cdr.id AND crn.is_resolved = 0) as unresolved_notes_count
       FROM cashier_daily_reports cdr
       LEFT JOIN users u ON cdr.submitted_by = u.id
       WHERE cdr.branch_id = ? AND cdr.report_date BETWEEN ? AND ?
       ORDER BY cdr.report_date DESC`,
      [branchId, start, end]
    );

    const reportList = rows.map((r) => ({
      ...r,
      total_customer: parseInt(r.total_customer || 0, 10),
      apc: toNum(r.apc),
      omzet_gross: toNum(r.omzet_gross),
      pb1_amount: toNum(r.pb1_amount),
      pb1_app_amount: toNullableNum(r.pb1_app_amount),
      omzet_net: toNum(r.omzet_net),
      omzet_sales_app: toNullableNum(r.omzet_sales_app),
      omzet_sales_notes: r.omzet_sales_notes || '',
      cash_omzet: toNum(r.cash_omzet),
      endorse_entertaint_total: toNum(r.endorse_entertaint_total),
      admin_pesanan_total: toNum(r.admin_pesanan_total),
      notes_count: parseInt(r.notes_count || 0, 10),
      unresolved_notes_count: parseInt(r.unresolved_notes_count || 0, 10),
      is_legacy_transaction: false
    }));

    const reportedDateSet = new Set(
      reportList.map((r) => sanitizeDateOnly(r.report_date)).filter(Boolean)
    );

    const legacyRows = await query(
      `SELECT
         MIN(t.id) as id,
         t.branch_id,
         DATE_FORMAT(DATE(t.transaction_date), '%Y-%m-%d') as report_date,
         COALESCE(MAX(u.name), MAX(u.email)) as created_by_names,
         'submitted' as status,
         COALESCE(SUM(t.total_customer), 0) as total_customer,
         COALESCE(SUM(t.amount), 0) as omzet_gross,
         COALESCE(SUM(COALESCE(t.pb1, 0)), 0) as pb1_amount,
         MIN(t.id) as omzet_transaction_id,
         MAX(t.updated_at) as updated_at,
         COALESCE(MAX(u.name), MAX(u.email)) as submitted_by_name
       FROM transactions t
       LEFT JOIN categories c ON t.category_id = c.id
       LEFT JOIN users u ON t.user_id = u.id
       WHERE t.branch_id = ?
         AND t.type = 'income'
         AND t.status_deleted = false
         AND (t.is_draft = false OR t.is_draft IS NULL)
         AND t.is_umum = 1
         AND LOWER(COALESCE(c.name, '')) LIKE '%omzet%'
         AND DATE(t.transaction_date) BETWEEN ? AND ?
         AND t.id NOT IN (
           SELECT omzet_transaction_id
           FROM cashier_daily_reports
           WHERE branch_id = ? AND omzet_transaction_id IS NOT NULL
         )
       GROUP BY t.branch_id, DATE(t.transaction_date)
       ORDER BY DATE(t.transaction_date) DESC`,
      [branchId, start, end, branchId]
    );

    for (const lr of legacyRows) {
      const dateKey = sanitizeDateOnly(lr.report_date);
      if (!dateKey || reportedDateSet.has(dateKey)) continue;
      const gross = toNum(lr.omzet_gross);
      const pb1 = toNum(lr.pb1_amount);
      const net = Math.max(0, round2(gross - pb1));
      const tc = parseInt(lr.total_customer || 0, 10);
      reportList.push({
        id: 0,
        branch_id: Number(lr.branch_id),
        report_date: dateKey,
        created_by_names: lr.created_by_names || null,
        status: 'submitted',
        total_customer: tc,
        apc: tc > 0 ? Math.round(net / tc) : 0,
        omzet_gross: gross,
        pb1_amount: pb1,
        omzet_net: net,
        cash_omzet: 0,
        endorse_entertaint_total: 0,
        admin_pesanan_total: 0,
        omzet_transaction_id: Number(lr.omzet_transaction_id),
        last_synced_at: null,
        updated_at: lr.updated_at,
        submitted_by_name: lr.submitted_by_name || null,
        notes_count: 0,
        unresolved_notes_count: 0,
        is_legacy_transaction: true
      });
    }

    reportList.sort((a, b) => String(b.report_date).localeCompare(String(a.report_date)));
    return reportList;
  }

  static async saveDailyReport({ branchId, reportDate, payload, user }) {
    const dateStr = sanitizeDateOnly(reportDate);
    if (!dateStr) {
      throw new Error('Tanggal laporan tidak valid');
    }

    const resultId = await dbTransaction(async (conn) => {
      const [existingRows] = await conn.execute(
        `SELECT id, omzet_transaction_id, status FROM cashier_daily_reports WHERE branch_id = ? AND report_date = ? LIMIT 1`,
        [branchId, dateStr]
      );

      const isUpdate = existingRows.length > 0;
      const existingId = isUpdate ? existingRows[0].id : null;
      const existingOmzetTxId = isUpdate ? existingRows[0].omzet_transaction_id : null;
      const prevSnapshot = isUpdate ? await this.getReportSnapshotById(existingId, conn) : null;

      // Normalize entertainments & goods receipts & orders
      const entertainments = (Array.isArray(payload.entertainments) ? payload.entertainments : [])
        .filter((e) => e.taker_name || e.purpose || e.product_desc || toNum(e.total_price) > 0)
        .map((e, idx) => ({
          taker_name: String(e.taker_name || '').trim(),
          purpose: String(e.purpose || '').trim(),
          product_desc: String(e.product_desc || '').trim(),
          total_price: round2(e.total_price),
          sort_order: idx
        }));

      const goodsReceipts = (Array.isArray(payload.goods_receipts) ? payload.goods_receipts : [])
        .filter((g) => g.item_name || g.unit || toNum(g.qty) > 0)
        .map((g, idx) => ({
          item_name: String(g.item_name || '').trim(),
          unit: String(g.unit || '').trim(),
          qty: round2(g.qty),
          notes: g.notes ? String(g.notes).trim() : null,
          sort_order: idx
        }));

      const [branchBankRows] = await conn.execute(
        `SELECT id, name FROM bank_accounts WHERE branch_id = ? AND is_active = 1`,
        [branchId]
      );
      const bankById = new Map(branchBankRows.map((b) => [Number(b.id), b]));
      const bankByName = new Map(branchBankRows.map((b) => [String(b.name || '').trim().toLowerCase(), b]));

      const resolveBankChannel = (rawIdVal, rawTextVal) => {
        const parsedId = rawIdVal ? parseInt(rawIdVal, 10) : null;
        const text = rawTextVal ? String(rawTextVal).trim() : null;
        const matched =
          (parsedId ? bankById.get(parsedId) : null) ||
          (text ? bankByName.get(text.toLowerCase()) : null) ||
          null;
        return {
          id: matched ? Number(matched.id) : null,
          name: matched ? String(matched.name).trim() : text
        };
      };

      const normalizeOrders = (arr, section) =>
        (Array.isArray(arr) ? arr : [])
          .filter((o) =>
            o.customer_name ||
            o.planned_pickup_date ||
            toNum(o.product_total_amount) > 0 ||
            toNum(o.tf_bca_amount) > 0 ||
            toNum(o.tf_mandiri_amount) > 0 ||
            toNum(o.dp_amount) > 0 ||
            o.dp_transfer_date ||
            o.dp_channel ||
            o.bank_account_id ||
            o.settlement_transfer_date ||
            o.settlement_channel ||
            o.settlement_bank_account_id ||
            toNum(o.settlement_amount) > 0 ||
            toNum(o.ongkir_amount) > 0 ||
            toNum(o.total_amount) > 0 ||
            o.pickup_date ||
            o.notes
          )
          .map((o, idx) => {
            const productTotal = round2(o.product_total_amount);
            const bca = round2(o.tf_bca_amount);
            const mandiri = round2(o.tf_mandiri_amount);
            const ongkirBca = round2(o.ongkir_bca_amount);
            const ongkirMandiri = round2(o.ongkir_mandiri_amount);
            const ongkirAmt = round2(
              o.ongkir_amount !== undefined && o.ongkir_amount !== null
                ? o.ongkir_amount
                : (ongkirBca + ongkirMandiri)
            );
            const computedTotal = section === 'dp_deposit'
              ? (productTotal + ongkirAmt)
              : (bca + mandiri + ongkirBca + ongkirMandiri);
            const totalAmt = toNum(o.total_amount) > 0 ? round2(o.total_amount) : computedTotal;

            const dpAmt = round2(o.dp_amount);
            const autoSettlement =
              section === 'admin_pesanan' && dpAmt > 0
                ? Math.max(0, round2(bca + mandiri - dpAmt))
                : 0;
            const settlementAmt =
              o.settlement_amount !== undefined && o.settlement_amount !== null
                ? round2(o.settlement_amount)
                : autoSettlement;

            const dpBank = resolveBankChannel(o.bank_account_id, o.dp_channel);
            const settlementBank = resolveBankChannel(o.settlement_bank_account_id, o.settlement_channel);

            return {
              order_section: section,
              customer_name: String(o.customer_name || '').trim(),
              planned_pickup_date: o.planned_pickup_date ? String(o.planned_pickup_date).trim() : null,
              product_total_amount: productTotal,
              tf_bca_amount: bca,
              tf_mandiri_amount: mandiri,
              dp_amount: dpAmt,
              dp_transfer_date: o.dp_transfer_date ? String(o.dp_transfer_date).trim() : null,
              dp_channel: dpBank.name,
              bank_account_id: dpBank.id,
              settlement_amount: settlementAmt,
              settlement_transfer_date: o.settlement_transfer_date ? String(o.settlement_transfer_date).trim() : null,
              settlement_channel: settlementBank.name,
              settlement_bank_account_id: settlementBank.id,
              ongkir_bca_amount: ongkirBca,
              ongkir_mandiri_amount: ongkirMandiri,
              ongkir_amount: ongkirAmt,
              total_amount: totalAmt,
              pickup_date: o.pickup_date ? String(o.pickup_date).trim() : null,
              notes: o.notes ? String(o.notes).trim() : null,
              sort_order: idx
            };
          });

      const dpOrders = normalizeOrders(payload.dp_orders, 'dp_deposit');
      const adminOrders = normalizeOrders(payload.admin_orders, 'admin_pesanan');

      const entertainTotalFromRows = round2(
        entertainments.reduce((sum, e) => sum + e.total_price, 0)
      );
      const adminPesananFromRows = round2(
        adminOrders.reduce((sum, o) => sum + o.tf_bca_amount + o.tf_mandiri_amount, 0)
      );

      // Load branch payment methods to enforce authoritative PB1, default bank account & parent grouping
      const [branchPmRows] = await conn.execute(
        `SELECT id, name, parent_id, is_taxable, default_bank_account_id FROM payment_methods WHERE branch_id = ? OR branch_id IS NULL`,
        [branchId]
      );
      const pmMap = new Map(branchPmRows.map((r) => [Number(r.id), r]));
      const adminParentIds = new Set(
        branchPmRows.filter((r) => String(r.name || '').toLowerCase().includes('admin pesanan')).map((r) => Number(r.id))
      );

      // Compute omzet items authoritatively
      const rawOmzetItems = Array.isArray(payload.omzet_items) ? payload.omzet_items : [];
      const omzetItems = rawOmzetItems.map((item, idx) => {
        const pmId = item.payment_method_id ? parseInt(item.payment_method_id, 10) : null;
        const dbPm = pmId ? pmMap.get(pmId) : null;
        const channelName = String(item.channel_name || dbPm?.name || '').trim();
        const lowerName = channelName.toLowerCase();
        const isAdminPesananRow = lowerName.includes('admin pesanan');
        const isTaxable = dbPm
          ? Boolean(dbPm.is_taxable)
          : (item.is_taxable !== undefined ? Boolean(item.is_taxable) : !isAdminPesananRow);
        const appAmt = round2(item.amount_app);
        const cashierAmt = round2(item.amount_cashier);
        const pb1Amt =
          item.pb1_amount !== undefined && item.pb1_amount !== null
            ? round2(item.pb1_amount)
            : 0;
        const resolvedBankId = dbPm?.default_bank_account_id || (item.bank_account_id ? parseInt(item.bank_account_id, 10) : null);
        const lampiranList = parseLampiranArray(item.lampiran);
        const lampiranJson = lampiranList.length > 0 ? JSON.stringify(lampiranList) : null;

        return {
          payment_method_id: pmId,
          channel_name: channelName || `Channel ${idx + 1}`,
          bank_account_id: resolvedBankId,
          amount_app: appAmt,
          amount_cashier: cashierAmt,
          is_taxable: isTaxable ? 1 : 0,
          pb1_amount: pb1Amt,
          sort_order: idx,
          notes: item.notes ? String(item.notes).trim() : null,
          lampiran: lampiranList,
          lampiranJson
        };
      });

      const channelGross = round2(
        omzetItems.reduce((sum, i) => sum + getEffectiveOmzetRowAmount(i), 0)
      );
      const manualOmzetSalesCashier = toNullableNum(payload.omzet_sales_cashier);
      const omzetGross = channelGross > 0 ? channelGross : Math.max(0, manualOmzetSalesCashier || 0);
      const channelPb1Sum = round2(
        omzetItems.reduce((sum, i) => sum + i.pb1_amount, 0)
      );
      const manualPb1 = payload.pb1_amount !== undefined && payload.pb1_amount !== null
        ? round2(payload.pb1_amount)
        : null;
      const pb1Amount = manualPb1 !== null && manualPb1 >= 0 ? manualPb1 : channelPb1Sum;
      const omzetNet = Math.max(0, round2(omzetGross - pb1Amount));
      const totalCustomer = Math.max(0, parseInt(payload.total_customer || 0, 10) || 0);
      const computedApc = totalCustomer > 0 ? Math.round(omzetNet / totalCustomer) : 0;
      const manualApc = payload.apc !== undefined && payload.apc !== null ? round2(payload.apc) : null;
      const apc = manualApc !== null && manualApc >= 0 ? manualApc : computedApc;

      // Derive endorse & admin pesanan totals either from detail rows or matching omzet item (including Admin Pesanan sub-methods)
      const endorseFromOmzet = omzetItems
        .filter((i) => i.channel_name.toLowerCase().includes('endorse') || i.channel_name.toLowerCase().includes('entertain'))
        .reduce((s, i) => s + getEffectiveOmzetRowAmount(i), 0);
      const adminFromOmzet = omzetItems
        .filter((i) => {
          if (i.channel_name.toLowerCase().includes('admin pesanan')) return true;
          const dbPm = i.payment_method_id ? pmMap.get(Number(i.payment_method_id)) : null;
          return dbPm?.parent_id ? adminParentIds.has(Number(dbPm.parent_id)) : false;
        })
        .reduce((s, i) => s + getEffectiveOmzetRowAmount(i), 0);

      const endorseTotal = entertainments.length > 0 ? entertainTotalFromRows : (toNum(payload.endorse_entertaint_total) || endorseFromOmzet);
      const adminPesananTotal = adminOrders.length > 0 ? adminPesananFromRows : (adminFromOmzet || toNum(payload.admin_pesanan_total));

      const validStatuses = ['draft', 'submitted', 'reviewed'];
      const nextStatus = validStatuses.includes(payload.status) ? payload.status : (existingRows[0]?.status || 'submitted');
      const autoSyncOmzet = payload.auto_sync_omzet !== undefined ? Boolean(payload.auto_sync_omzet) : true;

      // Load active branch sales channels and normalize payload.sales_channel_items
      const [branchScRows] = await conn.execute(
        `SELECT id, name FROM sales_channels WHERE branch_id = ? AND status_deleted = 0 AND is_active = 1`,
        [branchId]
      );
      const scMap = new Map(branchScRows.map((s) => [Number(s.id), s]));

      const rawSalesChannelItems = Array.isArray(payload.sales_channel_items) ? payload.sales_channel_items : [];
      const salesChannelItems = rawSalesChannelItems
        .filter((sc) => sc && sc.sales_channel_id && toNum(sc.amount) > 0)
        .map((sc, idx) => {
          const scId = parseInt(sc.sales_channel_id, 10);
          const dbSc = scMap.get(scId);
          const omzetIdx =
            sc.omzet_item_index !== undefined && sc.omzet_item_index !== null && sc.omzet_item_index !== ''
              ? parseInt(sc.omzet_item_index, 10)
              : null;
          const srcItem = Number.isFinite(omzetIdx) && omzetItems[omzetIdx] ? omzetItems[omzetIdx] : null;
          const pmId = srcItem
            ? srcItem.payment_method_id
            : (sc.payment_method_id ? parseInt(sc.payment_method_id, 10) : null);
          const pmName = srcItem
            ? srcItem.channel_name
            : (sc.payment_method_name ? String(sc.payment_method_name).trim() : (pmId && pmMap.get(pmId)?.name) || '');
          const scPb1 =
            sc.pb1_amount !== undefined && sc.pb1_amount !== null && sc.pb1_amount !== ''
              ? round2(sc.pb1_amount)
              : null;

          return {
            sales_channel_id: Number.isFinite(scId) ? scId : null,
            sales_channel_name: dbSc ? dbSc.name : String(sc.sales_channel_name || '').trim(),
            payment_method_id: pmId,
            payment_method_name: pmName,
            omzet_item_index: Number.isFinite(omzetIdx) ? omzetIdx : null,
            amount: round2(sc.amount),
            pb1_amount: scPb1,
            sort_order: idx
          };
        })
        .filter((sc) => sc.sales_channel_id);

      // Mandatory 100% allocation validation when submitting/saving final report (non-draft)
      if (nextStatus !== 'draft' && omzetGross > 0 && branchScRows.length > 0) {
        const totalAllocated = round2(salesChannelItems.reduce((s, r) => s + r.amount, 0));
        if (Math.abs(totalAllocated - omzetGross) > 1) {
          const err = new Error(
            `Alokasi Rincian Sales Channel wajib diisi dan harus sama 100% dengan Total Omzet (${formatCurrencySimple(totalAllocated)} / ${formatCurrencySimple(omzetGross)}).`
          );
          err.statusCode = 400;
          throw err;
        }

        if (channelGross > 0) {
          for (let i = 0; i < omzetItems.length; i++) {
            const oi = omzetItems[i];
            const targetAmt = getEffectiveOmzetRowAmount(oi);
            if (targetAmt <= 0) continue;

            const srcAllocated = round2(
              salesChannelItems
                .filter((sc) => {
                  if (sc.omzet_item_index !== null) return sc.omzet_item_index === i;
                  if (sc.payment_method_id && oi.payment_method_id) {
                    return Number(sc.payment_method_id) === Number(oi.payment_method_id);
                  }
                  return (
                    sc.payment_method_name.toLowerCase().trim() ===
                    String(oi.channel_name || '').toLowerCase().trim()
                  );
                })
                .reduce((s, r) => s + r.amount, 0)
            );

            if (Math.abs(srcAllocated - targetAmt) > 1) {
              const err = new Error(
                `Alokasi Sales Channel untuk "${oi.channel_name}" belum sesuai (${formatCurrencySimple(srcAllocated)} / ${formatCurrencySimple(targetAmt)}).`
              );
              err.statusCode = 400;
              throw err;
            }
          }
        }
      }

      const headerData = {
        created_by_names: payload.created_by_names ? String(payload.created_by_names).trim() : (user?.name || null),
        submitted_by: user?.id || null,
        status: nextStatus,
        total_customer: totalCustomer,
        apc,
        omzet_gross: omzetGross,
        pb1_amount: pb1Amount,
        pb1_app_amount: toNullableNum(payload.pb1_app_amount),
        omzet_net: omzetNet,
        omzet_sales_app: toNullableNum(payload.omzet_sales_app),
        omzet_sales_cashier: manualOmzetSalesCashier,
        omzet_sales_notes: payload.omzet_sales_notes ? String(payload.omzet_sales_notes).trim() : null,
        cash_omzet: round2(payload.cash_omzet),
        cash_shift1: round2(payload.cash_shift1),
        cash_shift2: round2(payload.cash_shift2),
        endorse_entertaint_total: round2(endorseTotal),
        admin_pesanan_total: round2(adminPesananTotal),
        hpp_daily_override: toNullableNum(payload.hpp_daily_override),
        operasional_daily_override: toNullableNum(payload.operasional_daily_override),
        ayam_dioven_ekor: round2(payload.ayam_dioven_ekor),
        ayam_dioven_potong: round2(payload.ayam_dioven_potong),
        ayam_dijual_ekor: round2(payload.ayam_dijual_ekor),
        ayam_dijual_potong: round2(payload.ayam_dijual_potong),
        ayam_reject_ekor: round2(payload.ayam_reject_ekor),
        ayam_reject_potong: round2(payload.ayam_reject_potong),
        kambing_presto_ekor: round2(payload.kambing_presto_ekor),
        kambing_presto_potong: round2(payload.kambing_presto_potong),
        kambing_dijual_ekor: round2(payload.kambing_dijual_ekor),
        kambing_dijual_potong: round2(payload.kambing_dijual_potong),
        kambing_kecil_ekor: round2(payload.kambing_kecil_ekor),
        kambing_kecil_potong: round2(payload.kambing_kecil_potong),
        kasir_notes: payload.kasir_notes ? String(payload.kasir_notes).trim() : null,
        auto_sync_omzet: autoSyncOmzet ? 1 : 0
      };

      let reportId = existingId;
      if (isUpdate) {
        await conn.execute(
          `UPDATE cashier_daily_reports SET
             created_by_names = ?, submitted_by = ?, status = ?,
             total_customer = ?, apc = ?, omzet_gross = ?, pb1_amount = ?, pb1_app_amount = ?, omzet_net = ?,
             omzet_sales_app = ?, omzet_sales_cashier = ?, omzet_sales_notes = ?,
             cash_omzet = ?, cash_shift1 = ?, cash_shift2 = ?,
             endorse_entertaint_total = ?, admin_pesanan_total = ?,
             hpp_daily_override = ?, operasional_daily_override = ?,
             ayam_dioven_ekor = ?, ayam_dioven_potong = ?,
             ayam_dijual_ekor = ?, ayam_dijual_potong = ?,
             ayam_reject_ekor = ?, ayam_reject_potong = ?,
             kambing_presto_ekor = ?, kambing_presto_potong = ?,
             kambing_dijual_ekor = ?, kambing_dijual_potong = ?,
             kambing_kecil_ekor = ?, kambing_kecil_potong = ?,
             kasir_notes = ?, auto_sync_omzet = ?
           WHERE id = ?`,
          [
            headerData.created_by_names, headerData.submitted_by, headerData.status,
            headerData.total_customer, headerData.apc, headerData.omzet_gross, headerData.pb1_amount, headerData.pb1_app_amount, headerData.omzet_net,
            headerData.omzet_sales_app, headerData.omzet_sales_cashier, headerData.omzet_sales_notes,
            headerData.cash_omzet, headerData.cash_shift1, headerData.cash_shift2,
            headerData.endorse_entertaint_total, headerData.admin_pesanan_total,
            headerData.hpp_daily_override, headerData.operasional_daily_override,
            headerData.ayam_dioven_ekor, headerData.ayam_dioven_potong,
            headerData.ayam_dijual_ekor, headerData.ayam_dijual_potong,
            headerData.ayam_reject_ekor, headerData.ayam_reject_potong,
            headerData.kambing_presto_ekor, headerData.kambing_presto_potong,
            headerData.kambing_dijual_ekor, headerData.kambing_dijual_potong,
            headerData.kambing_kecil_ekor, headerData.kambing_kecil_potong,
            headerData.kasir_notes, headerData.auto_sync_omzet,
            reportId
          ]
        );
      } else {
        const [ins] = await conn.execute(
          `INSERT INTO cashier_daily_reports (
             branch_id, report_date, created_by_names, submitted_by, status,
             total_customer, apc, omzet_gross, pb1_amount, pb1_app_amount, omzet_net,
             omzet_sales_app, omzet_sales_cashier, omzet_sales_notes,
             cash_omzet, cash_shift1, cash_shift2,
             endorse_entertaint_total, admin_pesanan_total,
             hpp_daily_override, operasional_daily_override,
             ayam_dioven_ekor, ayam_dioven_potong,
             ayam_dijual_ekor, ayam_dijual_potong,
             ayam_reject_ekor, ayam_reject_potong,
             kambing_presto_ekor, kambing_presto_potong,
             kambing_dijual_ekor, kambing_dijual_potong,
             kambing_kecil_ekor, kambing_kecil_potong,
             kasir_notes, auto_sync_omzet
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            branchId, dateStr, headerData.created_by_names, headerData.submitted_by, headerData.status,
            headerData.total_customer, headerData.apc, headerData.omzet_gross, headerData.pb1_amount, headerData.pb1_app_amount, headerData.omzet_net,
            headerData.omzet_sales_app, headerData.omzet_sales_cashier, headerData.omzet_sales_notes,
            headerData.cash_omzet, headerData.cash_shift1, headerData.cash_shift2,
            headerData.endorse_entertaint_total, headerData.admin_pesanan_total,
            headerData.hpp_daily_override, headerData.operasional_daily_override,
            headerData.ayam_dioven_ekor, headerData.ayam_dioven_potong,
            headerData.ayam_dijual_ekor, headerData.ayam_dijual_potong,
            headerData.ayam_reject_ekor, headerData.ayam_reject_potong,
            headerData.kambing_presto_ekor, headerData.kambing_presto_potong,
            headerData.kambing_dijual_ekor, headerData.kambing_dijual_potong,
            headerData.kambing_kecil_ekor, headerData.kambing_kecil_potong,
            headerData.kasir_notes, headerData.auto_sync_omzet
          ]
        );
        reportId = ins.insertId;
      }

      // Replace child tables atomically
      await conn.execute(`DELETE FROM cashier_report_omzet_items WHERE report_id = ?`, [reportId]);
      for (const item of omzetItems) {
        await conn.execute(
          `INSERT INTO cashier_report_omzet_items
           (report_id, payment_method_id, channel_name, bank_account_id, amount_app, amount_cashier, is_taxable, pb1_amount, sort_order, notes, lampiran)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            reportId, item.payment_method_id, item.channel_name, item.bank_account_id,
            item.amount_app, item.amount_cashier, item.is_taxable, item.pb1_amount, item.sort_order, item.notes, item.lampiranJson
          ]
        );
      }

      await conn.execute(`DELETE FROM cashier_report_sales_channels WHERE report_id = ?`, [reportId]);
      for (const sc of salesChannelItems) {
        await conn.execute(
          `INSERT INTO cashier_report_sales_channels
           (report_id, sales_channel_id, sales_channel_name, payment_method_id, payment_method_name, omzet_item_index, amount, pb1_amount, sort_order)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            reportId, sc.sales_channel_id, sc.sales_channel_name,
            sc.payment_method_id, sc.payment_method_name, sc.omzet_item_index,
            sc.amount, sc.pb1_amount, sc.sort_order
          ]
        );
      }

      await conn.execute(`DELETE FROM cashier_report_entertainments WHERE report_id = ?`, [reportId]);
      for (const e of entertainments) {
        await conn.execute(
          `INSERT INTO cashier_report_entertainments (report_id, taker_name, purpose, product_desc, total_price, sort_order)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [reportId, e.taker_name, e.purpose, e.product_desc, e.total_price, e.sort_order]
        );
      }

      await conn.execute(`DELETE FROM cashier_report_goods_receipts WHERE report_id = ?`, [reportId]);
      for (const g of goodsReceipts) {
        await conn.execute(
          `INSERT INTO cashier_report_goods_receipts (report_id, item_name, unit, qty, notes, sort_order)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [reportId, g.item_name, g.unit, g.qty, g.notes, g.sort_order]
        );
      }

      await conn.execute(`DELETE FROM cashier_report_orders WHERE report_id = ?`, [reportId]);
      for (const o of [...dpOrders, ...adminOrders]) {
        await conn.execute(
          `INSERT INTO cashier_report_orders
           (report_id, order_section, customer_name, planned_pickup_date, product_total_amount, tf_bca_amount, tf_mandiri_amount, dp_amount, dp_transfer_date, dp_channel, bank_account_id,
            settlement_amount, settlement_transfer_date, settlement_channel, settlement_bank_account_id, ongkir_bca_amount, ongkir_mandiri_amount, ongkir_amount, total_amount, pickup_date, notes, sort_order)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            reportId, o.order_section, o.customer_name, o.planned_pickup_date, o.product_total_amount,
            o.tf_bca_amount, o.tf_mandiri_amount,
            o.dp_amount, o.dp_transfer_date, o.dp_channel, o.bank_account_id, o.settlement_amount, o.settlement_transfer_date,
            o.settlement_channel, o.settlement_bank_account_id, o.ongkir_bca_amount, o.ongkir_mandiri_amount, o.ongkir_amount, o.total_amount,
            o.pickup_date, o.notes, o.sort_order
          ]
        );
      }

      // Sync Omzet Penjualan transaction to Kas if non-draft & auto_sync_omzet (or already linked)
      let linkedTxId = existingOmzetTxId;
      let syncLogNote = null;
      const shouldSyncKas = (autoSyncOmzet && nextStatus !== 'draft' && omzetGross > 0) || Boolean(existingOmzetTxId);

      if (shouldSyncKas) {
        const omzetCategoryId = await this.findOmzetCategoryId(conn, branchId);
        if (omzetCategoryId) {
          const txNote = `Omzet Harian Kasir (${dateStr})${headerData.created_by_names ? ` - ${headerData.created_by_names}` : ''}`;

          // Check if linked transaction still exists and is not deleted
          let existingTxValid = false;
          if (linkedTxId) {
            const [txRows] = await conn.execute(
              `SELECT id, status_deleted FROM transactions WHERE id = ? LIMIT 1`,
              [linkedTxId]
            );
            if (txRows.length > 0 && !txRows[0].status_deleted) {
              existingTxValid = true;
            } else {
              linkedTxId = null;
            }
          }

          const isTxDraft = nextStatus === 'draft' ? 1 : 0;

          if (existingTxValid && linkedTxId) {
            await conn.execute(
              `UPDATE transactions
               SET amount = ?, total_customer = ?, apc = ?, pb1 = ?, note = ?, transaction_date = ?, is_draft = ?
               WHERE id = ?`,
              [omzetGross, totalCustomer || null, apc || null, pb1Amount, txNote, dateStr, isTxDraft, linkedTxId]
            );
            await conn.execute(`DELETE FROM transaction_sales_channels WHERE transaction_id = ?`, [linkedTxId]);
            await conn.execute(`DELETE FROM transaction_income_details WHERE transaction_id = ?`, [linkedTxId]);
            syncLogNote = `Transaksi Omzet #${linkedTxId} diperbarui otomatis (${formatCurrencySimple(omzetGross)})`;
          } else if (omzetGross > 0 && nextStatus !== 'draft') {
            const extRef = `cashier_report_${branchId}_${dateStr}`;
            const [insTx] = await conn.execute(
              `INSERT INTO transactions (user_id, branch_id, type, category_id, amount, total_customer, apc, pb1, note, transaction_date, is_umum, is_draft, external_reference_id, status_deleted)
               VALUES (?, ?, 'income', ?, ?, ?, ?, ?, ?, ?, true, ?, ?, false)`,
              [user?.id || null, branchId, omzetCategoryId, omzetGross, totalCustomer || null, apc || null, pb1Amount, txNote, dateStr, isTxDraft, extRef]
            );
            linkedTxId = insTx.insertId;
            syncLogNote = `Transaksi Omzet #${linkedTxId} dibuat otomatis (${formatCurrencySimple(omzetGross)})`;
          }

          if (linkedTxId) {
            const createdIncomeDetails = [];
            for (let itemIdx = 0; itemIdx < omzetItems.length; itemIdx++) {
              const item = omzetItems[itemIdx];
              const effectiveAmt = getEffectiveOmzetRowAmount(item);
              if (effectiveAmt <= 0 && item.amount_app <= 0 && item.amount_cashier <= 0) continue;

              const pm = await this.resolvePaymentMethodId(conn, branchId, item);
              if (!pm) continue;
              const bankId = item.bank_account_id || pm.default_bank_account_id || null;
              // Ensure BankAccount balance helper COALESCE(tid.amount_cashier, tid.amount_app, 0) receives positive nominal
              const persistedCashier = item.amount_cashier > 0 ? item.amount_cashier : item.amount_app;

              const [insTid] = await conn.execute(
                `INSERT INTO transaction_income_details (transaction_id, payment_method_id, bank_account_id, amount_app, amount_cashier, pb1_amount, lampiran)
                 VALUES (?, ?, ?, ?, ?, ?, ?)`,
                [linkedTxId, pm.id, bankId, item.amount_app, persistedCashier, item.pb1_amount, item.lampiranJson]
              );
              createdIncomeDetails.push({
                id: insTid.insertId,
                payment_method_id: pm.id,
                channel_name: item.channel_name,
                omzet_item_index: itemIdx
              });
            }

            await conn.execute(`DELETE FROM transaction_sales_channels WHERE transaction_id = ?`, [linkedTxId]);
            for (const sc of salesChannelItems) {
              const matchedTid =
                (sc.omzet_item_index !== null
                  ? createdIncomeDetails.find((cid) => cid.omzet_item_index === sc.omzet_item_index)
                  : null) ||
                (sc.payment_method_id
                  ? createdIncomeDetails.find((cid) => Number(cid.payment_method_id) === Number(sc.payment_method_id))
                  : null) ||
                createdIncomeDetails.find(
                  (cid) =>
                    String(cid.channel_name || '').toLowerCase().trim() ===
                    String(sc.payment_method_name || '').toLowerCase().trim()
                ) ||
                (createdIncomeDetails.length === 1 ? createdIncomeDetails[0] : null);

              await conn.execute(
                `INSERT INTO transaction_sales_channels
                 (transaction_id, sales_channel_id, payment_method_id, transaction_income_detail_id, amount, pb1_amount)
                 VALUES (?, ?, ?, ?, ?, ?)`,
                [
                  linkedTxId,
                  sc.sales_channel_id,
                  matchedTid ? matchedTid.payment_method_id : sc.payment_method_id,
                  matchedTid ? matchedTid.id : null,
                  sc.amount,
                  sc.pb1_amount
                ]
              );
            }

            await conn.execute(
              `UPDATE cashier_daily_reports SET omzet_transaction_id = ?, last_synced_at = NOW() WHERE id = ?`,
              [linkedTxId, reportId]
            );
          }
        }
      }

      // Compute diff and write audit log
      const nextSnapshot = {
        report: headerData,
        omzet_items: omzetItems,
        sales_channel_items: salesChannelItems,
        entertainments,
        goods_receipts: goodsReceipts,
        dp_orders: dpOrders,
        admin_orders: adminOrders
      };

      const changes = isUpdate ? computeReportDiff(prevSnapshot, nextSnapshot) : [
        { field: 'omzet_gross', label: 'Total Omzet Penjualan', oldValue: null, newValue: omzetGross },
        { field: 'total_customer', label: 'Total Customer (TC)', oldValue: null, newValue: totalCustomer },
        { field: 'status', label: 'Status Laporan', oldValue: null, newValue: nextStatus }
      ];

      if (syncLogNote) {
        changes.push({ field: 'omzet_transaction_id', label: 'Sinkronisasi Kas', oldValue: existingOmzetTxId || null, newValue: linkedTxId });
      }

      const action = isUpdate ? 'update_report' : 'create_report';
      const baseSummary = isUpdate
        ? `Memperbarui laporan kasir tanggal ${dateStr} (${changes.length} perubahan)`
        : `Membuat laporan harian kasir tanggal ${dateStr} — Omzet ${formatCurrencySimple(omzetGross)}`;
      const summary = syncLogNote ? `${baseSummary}. ${syncLogNote}` : baseSummary;

      await conn.execute(
        `INSERT INTO cashier_report_logs (report_id, branch_id, report_date, user_id, user_name, user_role, action, summary, changes)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          reportId,
          branchId,
          dateStr,
          user?.id || null,
          user?.name || user?.email || 'Sistem',
          user?.role || '',
          action,
          summary.slice(0, 500),
          JSON.stringify(changes)
        ]
      );

      return reportId;
    });

    return this.getReportSnapshotById(resultId);
  }

  static async addNote({ reportId, branchId, noteType, content, user }) {
    const allowedTypes = ['info', 'revisi', 'terverifikasi'];
    const safeType = allowedTypes.includes(noteType) ? noteType : 'info';

    return await dbTransaction(async (conn) => {
      const [reports] = await conn.execute(
        `SELECT id, branch_id, report_date, status FROM cashier_daily_reports WHERE id = ? AND branch_id = ? LIMIT 1`,
        [reportId, branchId]
      );
      if (reports.length === 0) {
        throw new Error('Laporan kasir tidak ditemukan');
      }
      const rep = reports[0];

      const [ins] = await conn.execute(
        `INSERT INTO cashier_report_notes (report_id, user_id, user_name, user_role, note_type, content, is_resolved)
         VALUES (?, ?, ?, ?, ?, ?, 0)`,
        [reportId, user?.id || null, user?.name || user?.email || 'Admin', user?.role || 'admin', safeType, content]
      );

      if (safeType === 'terverifikasi') {
        await conn.execute(
          `UPDATE cashier_daily_reports SET status = 'reviewed' WHERE id = ?`,
          [reportId]
        );
      }

      await conn.execute(
        `INSERT INTO cashier_report_logs (report_id, branch_id, report_date, user_id, user_name, user_role, action, summary, changes)
         VALUES (?, ?, ?, ?, ?, ?, 'add_note', ?, ?)`,
        [
          reportId,
          rep.branch_id,
          rep.report_date,
          user?.id || null,
          user?.name || user?.email || 'Admin',
          user?.role || 'admin',
          `Menambahkan catatan [${safeType}]: "${content.slice(0, 120)}${content.length > 120 ? '...' : ''}"`,
          JSON.stringify([{ field: 'note', label: `Catatan (${safeType})`, oldValue: null, newValue: content }])
        ]
      );

      const [noteRows] = await conn.execute(`SELECT * FROM cashier_report_notes WHERE id = ?`, [ins.insertId]);
      return {
        ...noteRows[0],
        is_resolved: Boolean(noteRows[0].is_resolved)
      };
    });
  }

  static async toggleNoteResolved({ noteId, branchId, isResolved, user }) {
    return await dbTransaction(async (conn) => {
      const [rows] = await conn.execute(
        `SELECT crn.*, cdr.branch_id, cdr.report_date
         FROM cashier_report_notes crn
         JOIN cashier_daily_reports cdr ON crn.report_id = cdr.id
         WHERE crn.id = ? AND cdr.branch_id = ?
         LIMIT 1`,
        [noteId, branchId]
      );
      if (rows.length === 0) {
        throw new Error('Catatan tidak ditemukan');
      }
      const note = rows[0];
      const nextResolved = isResolved ? 1 : 0;

      await conn.execute(`UPDATE cashier_report_notes SET is_resolved = ? WHERE id = ?`, [nextResolved, noteId]);

      await conn.execute(
        `INSERT INTO cashier_report_logs (report_id, branch_id, report_date, user_id, user_name, user_role, action, summary, changes)
         VALUES (?, ?, ?, ?, ?, ?, 'resolve_note', ?, ?)`,
        [
          note.report_id,
          note.branch_id,
          note.report_date,
          user?.id || null,
          user?.name || user?.email || 'User',
          user?.role || '',
          `${nextResolved ? 'Menandai catatan selesai' : 'Membuka kembali catatan'}: "${String(note.content).slice(0, 100)}"`,
          JSON.stringify([{ field: 'note_resolved', label: 'Status Catatan', oldValue: Boolean(note.is_resolved), newValue: Boolean(nextResolved) }])
        ]
      );

      return { id: Number(noteId), is_resolved: Boolean(nextResolved) };
    });
  }

  static async deleteNote({ noteId, branchId, user }) {
    return await dbTransaction(async (conn) => {
      const [rows] = await conn.execute(
        `SELECT crn.*, cdr.branch_id, cdr.report_date
         FROM cashier_report_notes crn
         JOIN cashier_daily_reports cdr ON crn.report_id = cdr.id
         WHERE crn.id = ? AND cdr.branch_id = ?
         LIMIT 1`,
        [noteId, branchId]
      );
      if (rows.length === 0) {
        throw new Error('Catatan tidak ditemukan');
      }
      const note = rows[0];
      await conn.execute(`DELETE FROM cashier_report_notes WHERE id = ?`, [noteId]);

      await conn.execute(
        `INSERT INTO cashier_report_logs (report_id, branch_id, report_date, user_id, user_name, user_role, action, summary, changes)
         VALUES (?, ?, ?, ?, ?, ?, 'delete_note', ?, ?)`,
        [
          note.report_id,
          note.branch_id,
          note.report_date,
          user?.id || null,
          user?.name || user?.email || 'User',
          user?.role || '',
          `Menghapus catatan [${note.note_type}]: "${String(note.content).slice(0, 100)}"`,
          JSON.stringify([{ field: 'note_deleted', label: 'Hapus Catatan', oldValue: note.content, newValue: null }])
        ]
      );

      return true;
    });
  }
}

module.exports = CashierReport;
