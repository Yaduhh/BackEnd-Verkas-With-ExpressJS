const BranchStock = require('../models/BranchStock');
const { query } = require('../config/database');
const xlsx = require('xlsx');
const ExcelJS = require('exceljs');

const parseFlexNumber = (val) => {
  if (val === null || val === undefined || val === '') return 0;
  if (typeof val === 'number') return Number.isFinite(val) ? val : 0;
  let str = String(val).trim();
  if (!str) return 0;

  // Remove currency symbols or spaces
  str = str.replace(/[Rp\s]/gi, '');

  const hasDot = str.includes('.');
  const hasComma = str.includes(',');

  if (hasDot && hasComma) {
    const lastDot = str.lastIndexOf('.');
    const lastComma = str.lastIndexOf(',');
    if (lastComma > lastDot) {
      // Indonesian format: 15.598.097,91
      str = str.replace(/\./g, '').replace(',', '.');
    } else {
      // US format: 15,598,097.91
      str = str.replace(/,/g, '');
    }
  } else if (hasComma && !hasDot) {
    // Check if comma is decimal separator (e.g. 4328,45 or -14,00)
    str = str.replace(',', '.');
  }

  const parsed = parseFloat(str);
  return Number.isFinite(parsed) ? parsed : 0;
};

// Build styled 2-row header worksheet matching the exact Bosgil/VerKas format
const buildStockWorksheet = (workbook, sheetName, rows = []) => {
  const sheet = workbook.addWorksheet(sheetName);

  // Set column widths (A to P = 16 columns)
  sheet.columns = [
    { key: 'kode', width: 12 },            // A: Kode
    { key: 'nama_produk', width: 28 },     // B: Nama Produk
    { key: 'satuan', width: 10 },          // C: Satuan
    { key: 'stok_awal', width: 12 },       // D: Stock Awal -> Stok Awal
    { key: 'hpp_awal', width: 15 },        // E: Stock Awal -> HPP
    { key: 'beli', width: 13 },            // F: Barang Masuk -> Beli
    { key: 'retur_jual', width: 13 },      // G: Barang Masuk -> Retur Jual
    { key: 'transfer_masuk', width: 15 },  // H: Barang Masuk -> Transfer Masuk
    { key: 'total_barang', width: 14 },    // I: Total Barang
    { key: 'jual', width: 13 },            // J: Barang Keluar -> Jual
    { key: 'retur_beli', width: 13 },      // K: Barang Keluar -> Retur Beli
    { key: 'transfer_keluar', width: 15 }, // L: Barang Keluar -> Transfer Keluar
    { key: 'penyesuaian_stok', width: 17 },// M: Penyesuaian Stok
    { key: 'qty_akhir', width: 12 },       // N: Stok Akhir -> Qty
    { key: 'hpp_akhir', width: 15 },       // O: Stok Akhir -> HPP
    { key: 'total_hpp', width: 18 }        // P: Stok Akhir -> Total HPP
  ];

  // Row 1: Top Group Headers
  const row1Values = [
    'Kode',
    'Nama Produk',
    'Satuan',
    'Stock Awal',
    '',
    'Barang Masuk',
    '',
    '',
    'Total Barang',
    'Barang Keluar',
    '',
    '',
    'Penyesuaian Stok',
    'Stok Akhir',
    '',
    ''
  ];

  // Row 2: Sub Headers
  const row2Values = [
    'Kode',
    'Nama Produk',
    'Satuan',
    'Stok Awal',
    'HPP',
    'Beli',
    'Retur Jual',
    'Transfer Masuk',
    'Total Barang',
    'Jual',
    'Retur Beli',
    'Transfer Keluar',
    'Penyesuaian Stok',
    'Qty',
    'HPP',
    'Total HPP'
  ];

  const r1 = sheet.getRow(1);
  r1.values = row1Values;
  r1.height = 20;

  const r2 = sheet.getRow(2);
  r2.values = row2Values;
  r2.height = 20;

  // Merge Cells for 2-Row Header
  sheet.mergeCells('A1:A2');
  sheet.mergeCells('B1:B2');
  sheet.mergeCells('C1:C2');
  sheet.mergeCells('D1:E1');
  sheet.mergeCells('F1:H1');
  sheet.mergeCells('I1:I2');
  sheet.mergeCells('J1:L1');
  sheet.mergeCells('M1:M2');
  sheet.mergeCells('N1:P1');

  // Style Header Rows (Yellow #FFFF00 background, bold black text, centered, thin borders)
  [r1, r2].forEach((row) => {
    for (let col = 1; col <= 16; col++) {
      const cell = row.getCell(col);
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFFFFF00' } // Yellow as in user screenshot
      };
      cell.font = {
        name: 'Calibri',
        size: 10,
        bold: true,
        color: { argb: 'FF000000' }
      };
      cell.alignment = {
        vertical: 'middle',
        horizontal: 'center',
        wrapText: true
      };
      cell.border = {
        top: { style: 'thin', color: { argb: 'FF9CA3AF' } },
        bottom: { style: 'thin', color: { argb: 'FF9CA3AF' } },
        left: { style: 'thin', color: { argb: 'FF9CA3AF' } },
        right: { style: 'thin', color: { argb: 'FF9CA3AF' } }
      };
    }
  });

  // Populate Data Rows
  rows.forEach((item) => {
    const dataRow = sheet.addRow([
      item.kode || '',
      item.nama_produk || '',
      item.satuan || 'PCS',
      Number(item.stok_awal) || 0,
      Number(item.hpp_awal) || 0,
      Number(item.beli) || 0,
      Number(item.retur_jual) || 0,
      Number(item.transfer_masuk) || 0,
      Number(item.total_barang) || 0,
      Number(item.jual) || 0,
      Number(item.retur_beli) || 0,
      Number(item.transfer_keluar) || 0,
      Number(item.penyesuaian_stok) || 0,
      Number(item.qty_akhir) || 0,
      Number(item.hpp_akhir) || 0,
      Number(item.total_hpp) || 0
    ]);

    dataRow.height = 19;

    for (let col = 1; col <= 16; col++) {
      const cell = dataRow.getCell(col);
      cell.font = { name: 'Calibri', size: 10 };
      cell.border = {
        top: { style: 'thin', color: { argb: 'FFD1D5DB' } },
        bottom: { style: 'thin', color: { argb: 'FFD1D5DB' } },
        left: { style: 'thin', color: { argb: 'FFD1D5DB' } },
        right: { style: 'thin', color: { argb: 'FFD1D5DB' } }
      };

      if (col <= 3) {
        cell.alignment = { vertical: 'middle', horizontal: 'left' };
      } else {
        cell.alignment = { vertical: 'middle', horizontal: 'right' };
        // Col 4 (Stok Awal) and Col 14 (Qty Akhir) can be integer or decimal, others 2 decimals
        cell.numFmt = '#,##0.00';
      }
    }
  });

  return sheet;
};

// Helper to detect stock header row index in a sheet matrix
const detectStockHeaderRowIdx = (matrix) => {
  if (!matrix || matrix.length === 0) return -1;
  for (let i = 0; i < Math.min(matrix.length, 20); i++) {
    const rowCells = (matrix[i] || []).map((c) => String(c || '').trim().toLowerCase());
    const hasKode = rowCells.some((c) => c === 'kode' || c === 'kode produk' || c === 'kode barang');
    const hasNama = rowCells.some((c) => c.includes('nama produk') || c.includes('nama barang') || c === 'produk');
    if (hasKode || hasNama) {
      return i;
    }
  }
  return -1;
};

// Parse uploaded Excel buffer (supports 2-row merged header or 1-row header, and multi-sheet selection)
const parseStockExcelBuffer = async (buffer, branchId, requestedSheetName = null, isPreview = false) => {
  await BranchStock.ensureTable();

  const workbook = xlsx.read(buffer, { type: 'buffer' });
  const sheetNames = workbook.SheetNames || [];
  if (sheetNames.length === 0) {
    throw new Error('File Excel kosong atau tidak memiliki sheet');
  }

  let targetSheetName = sheetNames[0];
  if (requestedSheetName && sheetNames.includes(requestedSheetName)) {
    targetSheetName = requestedSheetName;
  } else if (sheetNames.length > 1) {
    // Auto-detect first sheet with valid stock headers
    for (const name of sheetNames) {
      const ws = workbook.Sheets[name];
      const mat = xlsx.utils.sheet_to_json(ws, { header: 1, defval: '' });
      if (detectStockHeaderRowIdx(mat) !== -1) {
        targetSheetName = name;
        break;
      }
    }
  }

  const emptyPreviewResult = (errMsg) => ({
    sheetNames,
    selectedSheet: targetSheetName,
    sheetError: errMsg,
    summary: {
      totalRows: 0,
      newItems: 0,
      existingItems: 0,
      totalStokAkhirQty: 0,
      totalNilaiHpp: 0
    },
    items: []
  });

  const worksheet = workbook.Sheets[targetSheetName];
  const rawMatrix = xlsx.utils.sheet_to_json(worksheet, { header: 1, defval: '' });
  if (!rawMatrix || rawMatrix.length === 0) {
    const msg = `Tidak ada data yang ditemukan pada sheet "${targetSheetName}".`;
    if (isPreview) return emptyPreviewResult(msg);
    throw new Error(msg);
  }

  // Detect header row index by looking for "Kode" or "Nama Produk"
  const headerRowIdx = detectStockHeaderRowIdx(rawMatrix);

  if (headerRowIdx === -1) {
    const msg = `Format header pada sheet "${targetSheetName}" tidak dikenali. Pastikan terdapat kolom "Kode" dan "Nama Produk".`;
    if (isPreview) return emptyPreviewResult(msg);
    throw new Error(msg);
  }

  // Check if next row is a sub-header row (e.g., contains "Stok Awal", "HPP", "Beli", "Retur Jual", "Qty")
  let dataStartIdx = headerRowIdx + 1;
  const nextRow = rawMatrix[headerRowIdx + 1] || [];
  const nextRowLower = nextRow.map((c) => String(c || '').trim().toLowerCase());
  const isTwoRowHeader = nextRowLower.some(
    (c) =>
      c === 'stok awal' ||
      c === 'hpp' ||
      c === 'beli' ||
      c === 'retur jual' ||
      c === 'transfer masuk' ||
      c === 'jual' ||
      c === 'qty' ||
      c === 'total hpp'
  );

  if (isTwoRowHeader) {
    dataStartIdx = headerRowIdx + 2;
  }

  // Determine column mapping dynamically (with fallback to standard 0..15 indices)
  const topHeader = (rawMatrix[headerRowIdx] || []).map((c) => String(c || '').trim().toLowerCase());
  const subHeader = isTwoRowHeader
    ? (rawMatrix[headerRowIdx + 1] || []).map((c) => String(c || '').trim().toLowerCase())
    : topHeader;

  const findCol = (predicate, defaultIdx) => {
    for (let c = 0; c < Math.max(topHeader.length, subHeader.length); c++) {
      const t = topHeader[c] || '';
      const s = subHeader[c] || '';
      if (predicate(t, s, c)) return c;
    }
    return defaultIdx;
  };

  const colKode = findCol((t, s) => t === 'kode' || s === 'kode' || t.includes('kode'), 0);
  const colNama = findCol((t, s) => t.includes('nama produk') || s.includes('nama produk') || t === 'nama barang', 1);
  const colSatuan = findCol((t, s) => t === 'satuan' || s === 'satuan' || t === 'unit', 2);

  // Standard 16-column layout from user's Excel
  const existingStocks = await BranchStock.findAll({ branchId });
  const existingByKode = new Map();
  const existingByName = new Map();

  for (const st of existingStocks) {
    if (st.kode) existingByKode.set(st.kode.trim().toLowerCase(), st);
    if (st.nama_produk) existingByName.set(st.nama_produk.trim().toLowerCase(), st);
  }

  const parsedItems = [];
  let newCount = 0;
  let updateCount = 0;

  for (let r = dataStartIdx; r < rawMatrix.length; r++) {
    const row = rawMatrix[r];
    if (!row || row.length === 0) continue;

    const rawKode = String(row[colKode] ?? '').trim();
    const rawNama = String(row[colNama] ?? '').trim();
    const rawSatuan = String(row[colSatuan] ?? '').trim() || 'PCS';

    // Skip empty rows or repeated header rows or total footer rows
    if (!rawNama && !rawKode) continue;
    if (rawNama.toLowerCase() === 'nama produk' || rawKode.toLowerCase() === 'kode') continue;
    if (rawNama.toLowerCase().startsWith('total') && !rawKode) continue;

    const stok_awal = parseFlexNumber(row[3]);
    const hpp_awal = parseFlexNumber(row[4]);
    const beli = parseFlexNumber(row[5]);
    const retur_jual = parseFlexNumber(row[6]);
    const transfer_masuk = parseFlexNumber(row[7]);

    const rawTotalBarang = row[8];
    const calcTotalBarang = stok_awal + beli + retur_jual + transfer_masuk;
    const total_barang =
      rawTotalBarang !== '' && rawTotalBarang !== null && rawTotalBarang !== undefined
        ? parseFlexNumber(rawTotalBarang)
        : calcTotalBarang;

    const jual = parseFlexNumber(row[9]);
    const retur_beli = parseFlexNumber(row[10]);
    const transfer_keluar = parseFlexNumber(row[11]);
    const penyesuaian_stok = parseFlexNumber(row[12]);

    const rawQtyAkhir = row[13];
    const calcQtyAkhir = total_barang - (jual + retur_beli + transfer_keluar) + penyesuaian_stok;
    const qty_akhir =
      rawQtyAkhir !== '' && rawQtyAkhir !== null && rawQtyAkhir !== undefined
        ? parseFlexNumber(rawQtyAkhir)
        : calcQtyAkhir;

    const hpp_akhir = parseFlexNumber(row[14]);

    const rawTotalHpp = row[15];
    const calcTotalHpp = qty_akhir * hpp_akhir;
    const total_hpp =
      rawTotalHpp !== '' && rawTotalHpp !== null && rawTotalHpp !== undefined
        ? parseFlexNumber(rawTotalHpp)
        : calcTotalHpp;

    const normalized = BranchStock.normalizePayload({
      kode: rawKode,
      nama_produk: rawNama || rawKode,
      satuan: rawSatuan,
      stok_awal,
      hpp_awal,
      beli,
      retur_jual,
      transfer_masuk,
      total_barang,
      jual,
      retur_beli,
      transfer_keluar,
      penyesuaian_stok,
      qty_akhir,
      hpp_akhir,
      total_hpp
    });

    const matchExisting =
      (normalized.kode && existingByKode.get(normalized.kode.toLowerCase())) ||
      existingByName.get(normalized.nama_produk.toLowerCase()) ||
      null;

    if (matchExisting) {
      updateCount++;
    } else {
      newCount++;
    }

    parsedItems.push({
      ...normalized,
      existingId: matchExisting ? matchExisting.id : null,
      isExisting: !!matchExisting
    });
  }

  if (parsedItems.length === 0) {
    const msg = `Tidak ditemukan baris data stok yang valid pada sheet "${targetSheetName}".`;
    if (isPreview) return emptyPreviewResult(msg);
    throw new Error(msg);
  }

  const totalStokAkhirQty = parsedItems.reduce((acc, item) => acc + (Number(item.qty_akhir) || 0), 0);
  const totalNilaiHpp = parsedItems.reduce((acc, item) => acc + (Number(item.total_hpp) || 0), 0);

  return {
    sheetNames,
    selectedSheet: targetSheetName,
    sheetError: null,
    summary: {
      totalRows: parsedItems.length,
      newItems: newCount,
      existingItems: updateCount,
      totalStokAkhirQty: BranchStock.round2(totalStokAkhirQty),
      totalNilaiHpp: BranchStock.round2(totalNilaiHpp)
    },
    items: parsedItems
  };
};

// GET /api/stocks
const getStocks = async (req, res, next) => {
  try {
    const branchId = req.branchId || req.headers['x-branch-id'] || req.query.branch_id;
    if (!branchId) {
      return res.status(400).json({
        success: false,
        message: 'Branch ID wajib disertakan'
      });
    }

    const { search, satuan } = req.query;
    const stocks = await BranchStock.findAll({
      branchId: parseInt(branchId),
      search: search || '',
      satuan: satuan || ''
    });

    res.json({
      success: true,
      data: stocks
    });
  } catch (error) {
    next(error);
  }
};

// POST /api/stocks
const createStock = async (req, res, next) => {
  try {
    const branchId = req.branchId || req.headers['x-branch-id'] || req.body.branch_id;
    if (!branchId) {
      return res.status(400).json({
        success: false,
        message: 'Branch ID wajib disertakan'
      });
    }

    if (!req.body.nama_produk || !String(req.body.nama_produk).trim()) {
      return res.status(400).json({
        success: false,
        message: 'Nama produk wajib diisi'
      });
    }

    const created = await BranchStock.create(parseInt(branchId), req.body);
    res.status(201).json({
      success: true,
      message: 'Data stok produk berhasil ditambahkan',
      data: created
    });
  } catch (error) {
    next(error);
  }
};

// PUT /api/stocks/:id
const updateStock = async (req, res, next) => {
  try {
    const { id } = req.params;
    const updated = await BranchStock.update(parseInt(id), req.body);
    res.json({
      success: true,
      message: 'Data stok produk berhasil diperbarui',
      data: updated
    });
  } catch (error) {
    next(error);
  }
};

// DELETE /api/stocks/:id
const deleteStock = async (req, res, next) => {
  try {
    const { id } = req.params;
    const branchId = req.branchId || req.headers['x-branch-id'] || req.query.branch_id;
    await BranchStock.softDelete(parseInt(id), branchId);
    res.json({
      success: true,
      message: 'Data stok produk berhasil dihapus'
    });
  } catch (error) {
    next(error);
  }
};

// POST /api/stocks/bulk-delete
const bulkDeleteStocks = async (req, res, next) => {
  try {
    const branchId = req.branchId || req.headers['x-branch-id'] || req.body.branch_id;
    if (!branchId) {
      return res.status(400).json({ success: false, message: 'Branch ID wajib disertakan' });
    }

    const { ids, deleteAll = false } = req.body;
    let affectedCount = 0;

    if (deleteAll) {
      affectedCount = await BranchStock.deleteAllByBranch(parseInt(branchId));
    } else if (Array.isArray(ids) && ids.length > 0) {
      affectedCount = await BranchStock.bulkDelete(parseInt(branchId), ids);
    } else {
      return res.status(400).json({ success: false, message: 'Pilih item stok yang ingin dihapus' });
    }

    res.json({
      success: true,
      message: `Berhasil menghapus ${affectedCount} data stok`,
      data: { affectedCount }
    });
  } catch (error) {
    next(error);
  }
};

// GET /api/stocks/template-excel
const downloadStockTemplate = async (req, res, next) => {
  try {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'VerKas';
    workbook.created = new Date();

    const sampleRows = [
      {
        kode: 'OB0022',
        nama_produk: 'ALMUNIUM FOIL',
        satuan: 'ROLL',
        stok_awal: 1,
        hpp_awal: 360000.00,
        beli: 13.00,
        retur_jual: 0.00,
        transfer_masuk: 0.00,
        total_barang: 14.00,
        jual: 0.00,
        retur_beli: 0.00,
        transfer_keluar: 0.00,
        penyesuaian_stok: -14.00,
        qty_akhir: 0,
        hpp_akhir: 0.00,
        total_hpp: 0.00
      },
      {
        kode: 'OB0025',
        nama_produk: 'ARANG BATOK',
        satuan: 'KG',
        stok_awal: 0,
        hpp_awal: 0.00,
        beli: 410.00,
        retur_jual: 0.00,
        transfer_masuk: 0.00,
        total_barang: 410.00,
        jual: 0.00,
        retur_beli: 0.00,
        transfer_keluar: 0.00,
        penyesuaian_stok: -400.00,
        qty_akhir: 10,
        hpp_akhir: 19000.00,
        total_hpp: 190000.00
      },
      {
        kode: 'OB0001',
        nama_produk: 'AYAM BOSGIL',
        satuan: 'EKOR',
        stok_awal: 170,
        hpp_awal: 60000.00,
        beli: 7000.00,
        retur_jual: 0.00,
        transfer_masuk: 0.00,
        total_barang: 7170.00,
        jual: 0.00,
        retur_beli: 0.00,
        transfer_keluar: 6930.00,
        penyesuaian_stok: 0.00,
        qty_akhir: 240,
        hpp_akhir: 64992.07,
        total_hpp: 15598097.91
      }
    ];

    buildStockWorksheet(workbook, 'Daftar Stok', sampleRows);

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="Template_Daftar_Stok_Verkas.xlsx"');

    await workbook.xlsx.write(res);
    res.end();
  } catch (error) {
    next(error);
  }
};

// GET /api/stocks/export-excel
const exportStockExcel = async (req, res, next) => {
  try {
    const branchId = req.branchId || req.headers['x-branch-id'] || req.query.branch_id;
    if (!branchId) {
      return res.status(400).json({
        success: false,
        message: 'Branch ID wajib disertakan'
      });
    }

    const { search, satuan } = req.query;
    const stocks = await BranchStock.findAll({
      branchId: parseInt(branchId),
      search: search || '',
      satuan: satuan || ''
    });

    // Get branch name for filename
    let branchName = `Branch_${branchId}`;
    try {
      const bRows = await query(`SELECT name FROM branches WHERE id = ? LIMIT 1`, [parseInt(branchId)]);
      if (bRows[0]?.name) {
        branchName = bRows[0].name.replace(/[^a-zA-Z0-9_-]/g, '_');
      }
    } catch (e) {}

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'VerKas';
    workbook.created = new Date();

    buildStockWorksheet(workbook, 'Daftar Stok', stocks);

    const dateStr = new Date().toISOString().split('T')[0];
    const fileName = `Daftar_Stok_${branchName}_${dateStr}.xlsx`;

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);

    await workbook.xlsx.write(res);
    res.end();
  } catch (error) {
    next(error);
  }
};

// POST /api/stocks/preview-excel
const previewStockExcel = async (req, res) => {
  try {
    const branchId = req.branchId || req.headers['x-branch-id'] || req.body.branch_id;
    if (!branchId) {
      return res.status(400).json({
        success: false,
        message: 'Branch ID wajib disertakan'
      });
    }

    if (!req.file || !req.file.buffer) {
      return res.status(400).json({
        success: false,
        message: 'File Excel wajib diunggah'
      });
    }

    const sheetName = req.body.sheet_name || req.query.sheet_name || null;
    const parsed = await parseStockExcelBuffer(req.file.buffer, parseInt(branchId), sheetName, true);
    res.json({
      success: true,
      message: 'Preview file Excel berhasil dianalisa',
      data: parsed
    });
  } catch (error) {
    res.status(400).json({
      success: false,
      message: error.message || 'Gagal menganalisa file Excel'
    });
  }
};

// POST /api/stocks/import-excel
const importStockExcel = async (req, res, next) => {
  try {
    const branchId = req.branchId || req.headers['x-branch-id'] || req.body.branch_id;
    if (!branchId) {
      return res.status(400).json({
        success: false,
        message: 'Branch ID wajib disertakan'
      });
    }

    if (!req.file || !req.file.buffer) {
      return res.status(400).json({
        success: false,
        message: 'File Excel wajib diunggah'
      });
    }

    const mode = req.body.mode || 'upsert'; // 'upsert' (update existing + insert new) or 'replace' (replace all in branch)
    const sheetName = req.body.sheet_name || req.query.sheet_name || null;
    const parsed = await parseStockExcelBuffer(req.file.buffer, parseInt(branchId), sheetName, false);

    if (mode === 'replace') {
      await BranchStock.deleteAllByBranch(parseInt(branchId));
    }

    let createdCount = 0;
    let updatedCount = 0;

    for (const item of parsed.items) {
      if (mode !== 'replace' && item.existingId) {
        await BranchStock.update(item.existingId, item);
        updatedCount++;
      } else {
        await BranchStock.create(parseInt(branchId), item);
        createdCount++;
      }
    }

    res.json({
      success: true,
      message: `Import berhasil: ${createdCount} item baru ditambahkan, ${updatedCount} item diperbarui.`,
      data: {
        totalProcessed: parsed.items.length,
        createdCount,
        updatedCount
      }
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getStocks,
  createStock,
  updateStock,
  deleteStock,
  bulkDeleteStocks,
  downloadStockTemplate,
  exportStockExcel,
  previewStockExcel,
  importStockExcel
};

