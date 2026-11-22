const xlsx = require('xlsx');
const ExcelJS = require('exceljs');
const { query } = require('../config/database');

const VALID_TABLE_TYPES = new Set([
  'offline_sales',
  'toko_online_dp',
  'toko_online_sales',
  'outlet_dp',
  'outlet_admin'
]);

const normalizeText = (val) =>
  String(val === undefined || val === null ? '' : val)
    .replace(/[\r\n]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();

const parseExcelDateCell = (val) => {
  if (val === undefined || val === null || val === '') return '';
  if (val instanceof Date && !Number.isNaN(val.getTime())) {
    const y = val.getFullYear();
    const m = String(val.getMonth() + 1).padStart(2, '0');
    const d = String(val.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  if (typeof val === 'number' && Number.isFinite(val) && val > 20000 && val < 90000) {
    const parsed = xlsx.SSF.parse_date_code(val);
    if (parsed && parsed.y && parsed.m && parsed.d) {
      return `${String(parsed.y).padStart(4, '0')}-${String(parsed.m).padStart(2, '0')}-${String(parsed.d).padStart(2, '0')}`;
    }
  }
  const s = String(val).trim();
  if (!s || s === '-') return '';

  // YYYY-MM-DD or YYYY/MM/DD
  let m = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:\b|T)/);
  if (m) {
    return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  }

  // DD/MM/YYYY or DD-MM-YYYY or DD/MM/YY or DD-MM-YY
  m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
  if (m) {
    const day = m[1].padStart(2, '0');
    const month = m[2].padStart(2, '0');
    let year = m[3];
    if (year.length === 2) {
      year = parseInt(year, 10) <= 79 ? `20${year}` : `19${year}`;
    }
    const numM = parseInt(month, 10);
    const numD = parseInt(day, 10);
    if (numM >= 1 && numM <= 12 && numD >= 1 && numD <= 31) {
      return `${year}-${month}-${day}`;
    }
  }

  return '';
};

const parseExcelNumberCell = (val) => {
  if (val === undefined || val === null || val === '') return 0;
  if (typeof val === 'number') {
    return Number.isFinite(val) ? Math.max(0, Math.round(val * 100) / 100) : 0;
  }
  let s = String(val).trim();
  if (!s || s === '-') return 0;
  s = s.replace(/rp/gi, '').replace(/\s+/g, '');

  // Handle formatted decimals vs thousands separators
  if (/^\d{1,3}(\.\d{3})+(,\d{1,2})?$/.test(s)) {
    s = s.replace(/\./g, '').replace(',', '.');
  } else if (/^\d{1,3}(,\d{3})+(\.\d{1,2})?$/.test(s)) {
    s = s.replace(/,/g, '');
  } else if (/^\d+,\d{1,2}$/.test(s)) {
    s = s.replace(',', '.');
  } else {
    s = s.replace(/[^0-9.-]/g, '');
  }

  const n = parseFloat(s);
  return Number.isFinite(n) ? Math.max(0, Math.round(n * 100) / 100) : 0;
};

const TABLE_SPECS = {
  offline_sales: {
    label: 'Laporan Penjualan Offline',
    orderSection: 'offline_sales',
    titleKeywords: ['penjualan offline'],
    requiredAny: ['customer_name', 'total_amount'],
    fields: [
      { key: 'customer_name', label: 'Nama Konsumen', aliases: ['nama konsumen', 'nama customer', 'nama rekening', 'konsumen', 'customer', 'nama'] },
      { key: 'total_amount', label: 'Total', aliases: ['total', 'nominal', 'jumlah'] },
      { key: 'cara_bayar', label: 'Cara Bayar', aliases: ['cara bayar', 'pembayaran via', 'metode bayar', 'pembayaran', 'via', 'rekening'] }
    ],
    templateHeaders: ['No', 'Nama Konsumen', 'Total', 'Cara Bayar']
  },
  toko_online_dp: {
    label: 'Laporan DP/Deposit Penjualan Toko',
    orderSection: 'dp_deposit',
    titleKeywords: ['dp/deposit penjualan', 'dp / deposit penjualan'],
    requiredAny: ['customer_name', 'product_total_amount'],
    fields: [
      { key: 'customer_name', label: 'Nama Customer', aliases: ['nama customer', 'nama konsumen', 'customer', 'konsumen', 'nama'] },
      { key: 'dp_transfer_date', label: 'Tanggal Transfer', aliases: ['tanggal transfer', 'tgl transfer', 'tgl tf'] },
      { key: 'pickup_date', label: 'Tanggal Kirim', aliases: ['tanggal kirim', 'tgl kirim', 'tanggal ambil', 'tgl ambil'] },
      { key: 'notes', label: 'Keterangan', aliases: ['keterangan lain-lain', 'keterangan lain', 'keterangan', 'catatan', 'notes'] },
      { key: 'product_total_amount', label: 'Total Harga Barang', aliases: ['total harga barang', 'total harga produk', 'harga barang', 'total harga'] },
      { key: 'dp_channel', label: 'Pembayaran Via', aliases: ['pembayaran via', 'cara bayar', 'via', 'rekening'] },
      { key: 'item_name', label: 'Nama Barang', aliases: ['nama barang', 'nama produk', 'barang', 'produk', 'item'] },
      { key: 'order_channel', label: 'Channel (Offline / Online)', aliases: ['channel (offline / online)', 'channel', 'saluran'] }
    ],
    templateHeaders: [
      'No',
      'Nama Customer',
      'Tanggal Transfer',
      'Tanggal Kirim',
      'Keterangan',
      'Total Harga Barang',
      'Pembayaran Via',
      'Nama Barang',
      'Channel (Offline / Online)'
    ]
  },
  toko_online_sales: {
    label: 'Laporan Penjualan Online Web Hari Ini',
    orderSection: 'admin_pesanan',
    titleKeywords: ['penjualan online web'],
    requiredAny: ['tf_bca_amount', 'tf_bca_c1_amount', 'tf_mandiri_amount', 'ongkir_amount'],
    fields: [
      { key: 'customer_name', label: 'Nama Konsumen', aliases: ['nama konsumen', 'nama customer', 'konsumen', 'customer', 'nama'] },
      { key: 'dp_transfer_date', label: 'Tanggal Transfer', aliases: ['tanggal transfer', 'tgl transfer', 'tgl tf'] },
      { key: 'pickup_date', label: 'Tanggal Kirim', aliases: ['tanggal kirim', 'tgl kirim'] },
      { key: 'tf_bca_amount', label: 'Pembayaran TF BCA CV', aliases: ['pembayaran tf bca cv', 'tf bca cv', 'bca cv'] },
      { key: 'tf_bca_c1_amount', label: 'Pembayaran TF BCA C1', aliases: ['pembayaran tf bca c1', 'tf bca c1', 'bca c1'] },
      { key: 'tf_mandiri_amount', label: 'Pembayaran TF Mandiri', aliases: ['pembayaran tf mandiri', 'tf mandiri', 'mandiri'] },
      { key: 'ongkir_amount', label: 'Nominal Ongkir', aliases: ['nominal ongkir', 'ongkir'] },
      { key: 'total_amount', label: 'Total', aliases: ['total'] },
      { key: 'notes', label: 'Keterangan Lain-Lain', aliases: ['keterangan lain-lain', 'keterangan lain', 'keterangan', 'catatan', 'notes'] }
    ],
    templateHeaders: [
      'No',
      'Nama Konsumen',
      'Tanggal Transfer',
      'Tanggal Kirim',
      'Pembayaran TF BCA CV',
      'Pembayaran TF BCA C1',
      'Pembayaran TF Mandiri',
      'Nominal Ongkir',
      'Total',
      'Keterangan Lain-Lain'
    ]
  },
  outlet_dp: {
    label: 'Laporan DP / Deposit Penjualan Outlet',
    orderSection: 'dp_deposit',
    titleKeywords: ['dp / deposit penjualan outlet', 'dp/deposit penjualan outlet'],
    requiredAny: ['planned_pickup_date', 'product_total_amount', 'dp_amount'],
    fields: [
      { key: 'customer_name', label: 'Nama Konsumen', aliases: ['nama konsumen', 'nama rekening', 'nama customer', 'konsumen', 'nama'] },
      { key: 'planned_pickup_date', label: 'Rencana Tgl Ambil', aliases: ['rencana tgl ambil', 'rencana tanggal ambil', 'rencana tgl pengambilan', 'rencana ambil'] },
      { key: 'product_total_amount', label: 'Total Harga Produk', aliases: ['total harga produk', 'harga produk', 'total harga'] },
      { key: 'dp_transfer_date', label: 'Tgl TF Deposit / DP', aliases: ['tgl tf deposit / dp', 'tgl tf deposit', 'tanggal tf deposit', 'tgl tf dp', 'tanggal tf dp'] },
      { key: 'dp_amount', label: 'DP / Deposit', aliases: ['dp / deposit', 'deposit', 'dp'] },
      { key: 'settlement_transfer_date', label: 'Tgl TF Pelunasan', aliases: ['tgl tf pelunasan', 'tanggal tf pelunasan'] },
      { key: 'settlement_amount', label: 'Sisa Pelunasan', aliases: ['sisa pelunasan', 'pelunasan'] },
      { key: 'ongkir_amount', label: 'Ongkir', aliases: ['nominal ongkir', 'ongkir'] },
      { key: 'total_amount', label: 'Total', aliases: ['total'] },
      { key: 'dp_channel', label: 'Pembayaran Via', aliases: ['pembayaran via', 'cara bayar', 'via'] },
      { key: 'pickup_date', label: 'Tgl Ambil Akhir', aliases: ['tgl ambil akhir', 'tanggal ambil akhir', 'tgl pengambilan akhir', 'tgl ambil'] },
      { key: 'notes', label: 'Keterangan Lain-Lain', aliases: ['keterangan lain-lain', 'keterangan lain', 'keterangan', 'catatan', 'notes'] }
    ],
    templateHeaders: [
      'No',
      'Nama Konsumen',
      'Rencana Tgl Ambil',
      'Total Harga Produk',
      'Tgl TF Deposit / DP',
      'DP / Deposit',
      'Tgl TF Pelunasan',
      'Sisa Pelunasan',
      'Ongkir',
      'Total',
      'Pembayaran Via',
      'Tgl Ambil Akhir',
      'Keterangan Lain-Lain'
    ]
  },
  outlet_admin: {
    label: 'Laporan Admin Pesanan Penjualan Hari Ini',
    orderSection: 'admin_pesanan',
    titleKeywords: ['admin pesanan'],
    requiredAny: ['tf_bca_amount', 'tf_mandiri_amount', 'dp_channel', 'settlement_channel', 'ongkir_bca_amount'],
    fields: [
      { key: 'customer_name', label: 'Nama Konsumen', aliases: ['nama konsumen', 'nama rekening', 'nama customer', 'konsumen', 'nama'] },
      { key: 'tf_bca_amount', label: 'Pembayaran TF BCA', aliases: ['pembayaran tf bca', 'tf bca'] },
      { key: 'tf_mandiri_amount', label: 'Pembayaran TF Mandiri', aliases: ['pembayaran tf mandiri', 'tf mandiri'] },
      { key: 'dp_amount', label: 'DP', aliases: ['dp'] },
      { key: 'dp_transfer_date', label: 'Tanggal TF DP', aliases: ['tanggal tf dp', 'tgl tf dp'] },
      { key: 'dp_channel', label: 'Pembayaran DP Lewat', aliases: ['pembayaran dp lewat', 'dp lewat'] },
      { key: 'settlement_amount', label: 'Sisa Pelunasan', aliases: ['sisa pelunasan', 'pelunasan'] },
      { key: 'settlement_transfer_date', label: 'Tgl TF Pelunasan', aliases: ['tgl tf pelunasan', 'tanggal tf pelunasan'] },
      { key: 'settlement_channel', label: 'Pembayaran Pelunasan Lewat', aliases: ['pembayaran pelunasan lewat', 'pelunasan lewat'] },
      { key: 'ongkir_bca_amount', label: 'Ongkir via BCA', aliases: ['ongkir via bca', 'ongkir bca'] },
      { key: 'ongkir_mandiri_amount', label: 'Ongkir via Mandiri', aliases: ['ongkir via mandiri', 'ongkir mandiri'] },
      { key: 'total_amount', label: 'Total', aliases: ['total'] },
      { key: 'notes', label: 'Keterangan Lain-Lain', aliases: ['keterangan lain-lain', 'keterangan lain', 'keterangan', 'catatan', 'notes'] }
    ],
    templateHeaders: [
      'No',
      'Nama Konsumen',
      'Pembayaran TF BCA',
      'Pembayaran TF Mandiri',
      'DP',
      'Tanggal TF DP',
      'Pembayaran DP Lewat',
      'Sisa Pelunasan',
      'Tgl TF Pelunasan',
      'Pembayaran Pelunasan Lewat',
      'Ongkir via BCA',
      'Ongkir via Mandiri',
      'Total',
      'Keterangan Lain-Lain'
    ]
  }
};

function mapHeaderColumns(rowCells, spec) {
  const normalizedCells = rowCells.map(normalizeText);
  const colMap = {};
  const usedCols = new Set();

  // Pass 1: exact alias matches (longest alias first)
  const fieldAliasPairs = [];
  for (const field of spec.fields) {
    for (const alias of field.aliases) {
      fieldAliasPairs.push({ key: field.key, alias, len: alias.length });
    }
  }
  fieldAliasPairs.sort((a, b) => b.len - a.len);

  for (const { key, alias } of fieldAliasPairs) {
    if (colMap[key] !== undefined) continue;
    const colIdx = normalizedCells.findIndex((cell, idx) => !usedCols.has(idx) && cell === alias);
    if (colIdx !== -1) {
      colMap[key] = colIdx;
      usedCols.add(colIdx);
    }
  }

  // Pass 2: substring alias matches for remaining unmapped fields
  for (const { key, alias } of fieldAliasPairs) {
    if (colMap[key] !== undefined) continue;
    const colIdx = normalizedCells.findIndex(
      (cell, idx) => !usedCols.has(idx) && cell && cell.includes(alias)
    );
    if (colIdx !== -1) {
      colMap[key] = colIdx;
      usedCols.add(colIdx);
    }
  }

  const noColIdx = normalizedCells.findIndex((c) => c === 'no' || c === 'no.');
  return { colMap, noColIdx };
}

function detectBestHeaderInMatrix(matrix, spec) {
  if (!Array.isArray(matrix) || matrix.length === 0) return null;

  let best = null;
  const maxScan = Math.min(matrix.length, 250);

  for (let i = 0; i < maxScan; i++) {
    const row = matrix[i] || [];
    const { colMap, noColIdx } = mapHeaderColumns(row, spec);
    const matchedCount = Object.keys(colMap).length;
    if (matchedCount < 2) continue;

    let score = matchedCount * 10;
    if (colMap.customer_name !== undefined) score += 15;
    if (noColIdx !== -1) score += 5;

    for (const reqKey of spec.requiredAny || []) {
      if (colMap[reqKey] !== undefined) score += 12;
    }

    // Check previous 1-2 rows for matching section title banner
    for (let lookback = 1; lookback <= 2 && i - lookback >= 0; lookback++) {
      const prevRowText = (matrix[i - lookback] || []).map(normalizeText).join(' ');
      if (prevRowText) {
        for (const kw of spec.titleKeywords || []) {
          if (prevRowText.includes(kw)) score += 35;
        }
      }
    }

    if (!best || score > best.score) {
      best = { headerRowIdx: i, colMap, noColIdx, score, matchedCount };
    }
  }

  return best && best.matchedCount >= 2 ? best : null;
}

function resolveBankAccountMatch(rawText, bankAccounts) {
  const clean = String(rawText || '').trim();
  if (!clean) return { id: null, name: '' };

  const norm = normalizeText(clean);
  const exact = bankAccounts.find((b) => normalizeText(b.name) === norm);
  if (exact) return { id: Number(exact.id), name: exact.name };

  // Token-stripped match (e.g. "BCA CV" vs "Bank BCA CV")
  const partialMatches = bankAccounts.filter((b) => {
    const bn = normalizeText(b.name);
    return bn.includes(norm) || norm.includes(bn);
  });
  if (partialMatches.length === 1) {
    return { id: Number(partialMatches[0].id), name: partialMatches[0].name };
  }

  return { id: null, name: clean };
}

function isTotalOrNextSectionRow(rowCells, noColIdx, customerColIdx) {
  const firstFew = rowCells.slice(0, 4).map(normalizeText).filter(Boolean);
  if (firstFew.some((t) => t === 'total' || t === 'grand total' || t === 'jumlah total')) {
    return true;
  }
  const rowText = rowCells.map(normalizeText).join(' ');
  if (
    rowText.includes('laporan dp') ||
    rowText.includes('laporan penjualan') ||
    rowText.includes('laporan admin pesanan')
  ) {
    return true;
  }
  if (
    noColIdx !== -1 &&
    customerColIdx !== undefined &&
    normalizeText(rowCells[noColIdx]) === 'no' &&
    normalizeText(rowCells[customerColIdx]).includes('nama')
  ) {
    return true;
  }
  return false;
}

function parseRowsFromMatrix(matrix, detected, spec, bankAccounts) {
  const { headerRowIdx, colMap, noColIdx } = detected;
  const rows = [];
  let skippedRows = 0;

  const getCell = (row, key) => {
    const colIdx = colMap[key];
    return colIdx !== undefined ? row[colIdx] : '';
  };

  for (let rIdx = headerRowIdx + 1; rIdx < matrix.length; rIdx++) {
    const rawRow = matrix[rIdx] || [];
    if (isTotalOrNextSectionRow(rawRow, noColIdx, colMap.customer_name)) {
      break;
    }

    const customerName = String(getCell(rawRow, 'customer_name') || '').trim();
    const dpTransferDate = parseExcelDateCell(getCell(rawRow, 'dp_transfer_date'));
    const plannedPickupDate = parseExcelDateCell(getCell(rawRow, 'planned_pickup_date'));
    const pickupDate = parseExcelDateCell(getCell(rawRow, 'pickup_date'));
    const settlementTransferDate = parseExcelDateCell(getCell(rawRow, 'settlement_transfer_date'));
    const notes = String(getCell(rawRow, 'notes') || '').trim();

    const productTotal = parseExcelNumberCell(getCell(rawRow, 'product_total_amount'));
    const tfBca = parseExcelNumberCell(getCell(rawRow, 'tf_bca_amount'));
    const tfBcaC1 = parseExcelNumberCell(getCell(rawRow, 'tf_bca_c1_amount'));
    const tfMandiri = parseExcelNumberCell(getCell(rawRow, 'tf_mandiri_amount'));
    const dpAmount = parseExcelNumberCell(getCell(rawRow, 'dp_amount'));
    const settlementAmount = parseExcelNumberCell(getCell(rawRow, 'settlement_amount'));
    const ongkirBca = parseExcelNumberCell(getCell(rawRow, 'ongkir_bca_amount'));
    const ongkirMandiri = parseExcelNumberCell(getCell(rawRow, 'ongkir_mandiri_amount'));
    const rawOngkir = parseExcelNumberCell(getCell(rawRow, 'ongkir_amount'));
    const rawTotal = parseExcelNumberCell(getCell(rawRow, 'total_amount'));

    const itemName = String(getCell(rawRow, 'item_name') || '').trim();
    const rawChannel = String(getCell(rawRow, 'order_channel') || '').trim();
    const orderChannel =
      rawChannel.toLowerCase() === 'offline'
        ? 'Offline'
        : rawChannel.toLowerCase() === 'online'
          ? 'Online'
          : rawChannel;

    const caraBayarRaw = String(getCell(rawRow, 'cara_bayar') || '').trim();
    const dpChannelRaw = String(getCell(rawRow, 'dp_channel') || caraBayarRaw || '').trim();
    const settlementChannelRaw = String(getCell(rawRow, 'settlement_channel') || '').trim();

    const dpBank = resolveBankAccountMatch(dpChannelRaw, bankAccounts);
    const settlementBank = resolveBankAccountMatch(settlementChannelRaw, bankAccounts);

    let totalAmount = rawTotal;
    if (spec.orderSection === 'dp_deposit' && !totalAmount) {
      totalAmount = productTotal + rawOngkir;
    } else if (spec.orderSection === 'admin_pesanan') {
      const hasAnyComponent = tfBca + tfBcaC1 + tfMandiri + rawOngkir + dpAmount + settlementAmount + ongkirBca + ongkirMandiri;
      if (hasAnyComponent > 0 && !rawTotal) {
        totalAmount = hasAnyComponent;
      }
    }

    const hasMeaningfulContent = Boolean(
      customerName ||
      dpTransferDate ||
      plannedPickupDate ||
      pickupDate ||
      settlementTransferDate ||
      notes ||
      itemName ||
      orderChannel ||
      dpChannelRaw ||
      settlementChannelRaw ||
      productTotal > 0 ||
      tfBca > 0 ||
      tfBcaC1 > 0 ||
      tfMandiri > 0 ||
      dpAmount > 0 ||
      settlementAmount > 0 ||
      ongkirBca > 0 ||
      ongkirMandiri > 0 ||
      rawOngkir > 0 ||
      totalAmount > 0
    );

    if (!hasMeaningfulContent) {
      skippedRows += 1;
      continue;
    }

    const extraData = {};
    if (tfBcaC1 > 0) extraData.tf_bca_c1_amount = tfBcaC1;
    if (itemName) extraData.item_name = itemName;
    if (orderChannel) extraData.order_channel = orderChannel;

    rows.push({
      order_section: spec.orderSection,
      customer_name: customerName,
      planned_pickup_date: plannedPickupDate,
      product_total_amount: productTotal,
      tf_bca_amount: tfBca,
      tf_mandiri_amount: tfMandiri,
      dp_amount: dpAmount,
      dp_transfer_date: dpTransferDate,
      dp_channel: dpBank.name,
      bank_account_id: dpBank.id,
      bank_account_name: dpBank.name || null,
      settlement_amount: settlementAmount,
      settlement_transfer_date: settlementTransferDate,
      settlement_channel: settlementBank.name,
      settlement_bank_account_id: settlementBank.id,
      settlement_bank_account_name: settlementBank.name || null,
      ongkir_bca_amount: ongkirBca,
      ongkir_mandiri_amount: ongkirMandiri,
      ongkir_amount: rawOngkir || (ongkirBca + ongkirMandiri),
      total_amount: totalAmount,
      pickup_date: pickupDate,
      notes,
      extra_data: extraData
    });
  }

  return { rows, skippedRows };
}

async function getBranchActiveBankAccounts(branchId) {
  if (!branchId) return [];
  return await query(
    `SELECT ba.id, ba.name
     FROM bank_accounts ba
     WHERE ba.is_active = 1 AND ba.type != 'savings'
       AND (
         ba.branch_id = ?
         OR EXISTS (
           SELECT 1 FROM bank_account_branches bab
           WHERE bab.bank_account_id = ba.id AND bab.branch_id = ?
         )
       )
     ORDER BY ba.name ASC`,
    [branchId, branchId]
  );
}

async function parseOrderExcelPreview({ buffer, branchId, tableType, requestedSheetName = null }) {
  if (!VALID_TABLE_TYPES.has(tableType)) {
    const err = new Error('Tipe tabel import tidak valid.');
    err.statusCode = 400;
    throw err;
  }

  const spec = TABLE_SPECS[tableType];
  const workbook = xlsx.read(buffer, { type: 'buffer', cellDates: false });
  const sheetNames = workbook.SheetNames || [];
  if (sheetNames.length === 0) {
    const err = new Error('File Excel kosong atau tidak memiliki sheet.');
    err.statusCode = 400;
    throw err;
  }

  let selectedSheet = sheetNames[0];
  let bestDetection = null;

  if (requestedSheetName && sheetNames.includes(requestedSheetName)) {
    selectedSheet = requestedSheetName;
    const mat = xlsx.utils.sheet_to_json(workbook.Sheets[selectedSheet], { header: 1, defval: '' });
    bestDetection = detectBestHeaderInMatrix(mat, spec);
  } else {
    let bestScore = -1;
    for (const name of sheetNames) {
      const mat = xlsx.utils.sheet_to_json(workbook.Sheets[name], { header: 1, defval: '' });
      const det = detectBestHeaderInMatrix(mat, spec);
      if (det && det.score > bestScore) {
        bestScore = det.score;
        selectedSheet = name;
        bestDetection = det;
      }
    }
  }

  if (!bestDetection) {
    return {
      sheetNames,
      selectedSheet,
      tableType,
      tableLabel: spec.label,
      detectedHeaders: [],
      rows: [],
      skippedRows: 0,
      sheetError: `Header kolom untuk "${spec.label}" belum terdeteksi di sheet "${selectedSheet}". Pastikan nama kolom sesuai format atau pilih sheet lain.`
    };
  }

  const matrix = xlsx.utils.sheet_to_json(workbook.Sheets[selectedSheet], { header: 1, defval: '' });
  const bankAccounts = await getBranchActiveBankAccounts(branchId);
  const { rows, skippedRows } = parseRowsFromMatrix(matrix, bestDetection, spec, bankAccounts);

  const detectedHeaders = spec.fields
    .filter((f) => bestDetection.colMap[f.key] !== undefined)
    .map((f) => f.label);

  return {
    sheetNames,
    selectedSheet,
    tableType,
    tableLabel: spec.label,
    detectedHeaders,
    rows,
    skippedRows,
    sheetError: rows.length === 0 ? `Header ditemukan di sheet "${selectedSheet}", tetapi belum ada baris data terisi.` : null
  };
}

async function buildOrderExcelTemplate({ tableType, branchName = '' }) {
  if (!VALID_TABLE_TYPES.has(tableType)) {
    const err = new Error('Tipe tabel template tidak valid.');
    err.statusCode = 400;
    throw err;
  }
  const spec = TABLE_SPECS[tableType];
  const workbook = new ExcelJS.Workbook();
  const safeSheetName =
    spec.label
      .replace(/[*?:\\/[\]]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 31) || 'Template';
  const sheet = workbook.addWorksheet(safeSheetName);

  const titleText = branchName
    ? `${spec.label.toUpperCase()} (${branchName.toUpperCase()})`
    : spec.label.toUpperCase();

  sheet.addRow([titleText]);
  sheet.mergeCells(1, 1, 1, spec.templateHeaders.length);
  const titleRow = sheet.getRow(1);
  titleRow.font = { bold: true, size: 12 };
  titleRow.alignment = { horizontal: 'center', vertical: 'middle' };

  const headerRow = sheet.addRow(spec.templateHeaders);
  headerRow.eachCell((cell) => {
    cell.font = { bold: true, size: 10 };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFEF08A' } };
    cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
    cell.border = {
      top: { style: 'thin' },
      left: { style: 'thin' },
      bottom: { style: 'thin' },
      right: { style: 'thin' }
    };
  });

  // Add 5 blank numbered rows for convenience
  for (let i = 1; i <= 5; i++) {
    const r = sheet.addRow([i]);
    r.getCell(1).alignment = { horizontal: 'center' };
  }

  spec.templateHeaders.forEach((h, idx) => {
    sheet.getColumn(idx + 1).width = idx === 0 ? 6 : Math.max(16, h.length + 4);
  });

  return {
    buffer: await workbook.xlsx.writeBuffer(),
    fileName: `Template_${tableType}.xlsx`
  };
}

module.exports = {
  parseOrderExcelPreview,
  buildOrderExcelTemplate
};
