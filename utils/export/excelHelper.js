const ExcelJS = require('exceljs');
const XLSX = require('xlsx');
const path = require('path');
const { EXPORTS_DIR } = require('./commonHelper');

const INDONESIAN_MONTHS = [
    'JANUARI', 'FEBRUARI', 'MARET', 'APRIL', 'MEI', 'JUNI',
    'JULI', 'AGUSTUS', 'SEPTEMBER', 'OKTOBER', 'NOVEMBER', 'DESEMBER'
];

function formatPeriodText(fromDate, toDate, items) {
    if (fromDate && toDate) {
        const d1 = new Date(fromDate);
        const d2 = new Date(toDate);
        if (!isNaN(d1.getTime()) && !isNaN(d2.getTime())) {
            const day1 = String(d1.getDate()).padStart(2, '0');
            const day2 = String(d2.getDate()).padStart(2, '0');
            const m1 = INDONESIAN_MONTHS[d1.getMonth()];
            const m2 = INDONESIAN_MONTHS[d2.getMonth()];
            const y1 = d1.getFullYear();
            const y2 = d2.getFullYear();

            if (y1 === y2 && m1 === m2) {
                if (day1 === day2) return `${day1} ${m1} ${y1}`;
                return `${day1} - ${day2} ${m1} ${y1}`;
            } else if (y1 === y2) {
                return `${day1} ${m1} - ${day2} ${m2} ${y1}`;
            } else {
                return `${day1} ${m1} ${y1} - ${day2} ${m2} ${y2}`;
            }
        }
    }
    if (items && items.length > 0) {
        const dates = items.map(d => new Date(d.transaction_date)).filter(d => !isNaN(d.getTime())).sort((a, b) => a - b);
        if (dates.length > 0) {
            const first = dates[0];
            const last = dates[dates.length - 1];
            const day1 = String(first.getDate()).padStart(2, '0');
            const day2 = String(last.getDate()).padStart(2, '0');
            const m1 = INDONESIAN_MONTHS[first.getMonth()];
            const m2 = INDONESIAN_MONTHS[last.getMonth()];
            const y1 = first.getFullYear();
            const y2 = last.getFullYear();
            if (y1 === y2 && m1 === m2) {
                if (day1 === day2) return `${day1} ${m1} ${y1}`;
                return `${day1} - ${day2} ${m1} ${y1}`;
            }
            return `${day1} ${m1} ${y1} - ${day2} ${m2} ${y2}`;
        }
    }
    const now = new Date();
    const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    return `01 - ${String(lastDay).padStart(2, '0')} ${INDONESIAN_MONTHS[now.getMonth()]} ${now.getFullYear()}`;
}

function sanitizeText(text) {
    if (!text) return '-';
    return String(text)
        .replace(/\r\n/g, '\n')
        .replace(/\r/g, '\n')
        .replace(/\t/g, '   ')
        .replace(/[\u2018\u2019]/g, "'")
        .replace(/[\u201C\u201D]/g, '"')
        .replace(/\u00A0/g, ' ')
        .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
        .trim();
}

// Resolve short category code (Kode) for Kertas Kerja Kas Berjalan
function resolveCategoryKode(categoryName, categoryCode, note = '', type = '') {
    const name = String(categoryName || '').toLowerCase().trim();
    const noteLower = String(note || '').toLowerCase().trim();

    if (name.includes('omzet') || name.includes('omset')) return 'OZ';
    if (name.includes('operasional') || name === 'ops') return 'OPS';
    if (name.includes('simpanan')) return 'SP';
    if (name.includes('komisi') || noteLower.startsWith('komisi ')) return 'KMS';
    if (name.includes('biaya lain') || (type === 'expense' && name.includes('lain'))) return 'BL';
    if (name.includes('pendapatan lain') || name.includes('pemasukan lain') || (type === 'income' && name.includes('lain'))) return 'PL';
    if (name.includes('bahan baku') || name === 'bb') return 'BB';
    if (name.includes('packaging') || name.includes('kemasan') || name === 'pkg') return 'PKG';
    if (name.includes('gaji') || name.includes('upah')) return 'GJ';
    if (name.includes('sewa')) return 'SW';
    if (name.includes('pajak') || name.includes('pb1')) return 'PJ';
    if (name.includes('piutang')) return 'PTG';
    if (name.includes('listrik') || name.includes('air') || name.includes('internet') || name.includes('utilitas') || name.includes('wifi') || name.includes('pln') || name.includes('pdam')) return 'UTL';
    if (name.includes('maintenance') || name.includes('perbaikan') || name.includes('service')) return 'MTC';
    if (name.includes('marketing') || name.includes('promosi') || name.includes('iklan')) return 'MKT';
    if (name.includes('atk') || name.includes('alat tulis')) return 'ATK';
    if (name.includes('refund')) return 'RFD';

    if (categoryCode && /[A-Za-z]/.test(String(categoryCode))) {
        return String(categoryCode).trim().toUpperCase();
    }

    const cleanWords = String(categoryName || '')
        .replace(/\(.*?\)/g, '')
        .replace(/[^A-Za-z0-9\s]/g, ' ')
        .trim()
        .split(/\s+/)
        .filter(w => w && !['DAN', 'ATAU', 'DI', 'KE', 'DARI', 'UNTUK', 'YANG', 'DLL'].includes(w.toUpperCase()));

    if (cleanWords.length === 1) {
        return cleanWords[0].substring(0, 3).toUpperCase();
    }
    if (cleanWords.length > 1) {
        return cleanWords.slice(0, 3).map(w => w[0].toUpperCase()).join('');
    }
    return type === 'income' ? 'IN' : 'OUT';
}

// Export Kas Berjalan / Kertas Kerja transactions to Excel
async function exportToExcel(data, filename, title = 'KERTAS KERJA', branchName = 'OUTLET', options = {}) {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'VERKAS';
    workbook.created = new Date();

    const worksheet = workbook.addWorksheet('KAS BERJALAN', {
        views: [{ showGridLines: true }]
    });

    // Setup Columns (Col A is left margin, B..H are the 7 table columns)
    worksheet.columns = [
        { key: 'margin', width: 3 },
        { key: 'tgl', width: 8 },
        { key: 'kode', width: 12 },
        { key: 'keterangan', width: 44 },
        { key: 'dr', width: 22 },
        { key: 'cr', width: 22 },
        { key: 'refund', width: 18 },
        { key: 'saldo', width: 24 }
    ];

    const fontName = 'Times New Roman';
    const thinBorder = {
        top: { style: 'thin', color: { argb: 'FF000000' } },
        left: { style: 'thin', color: { argb: 'FF000000' } },
        bottom: { style: 'thin', color: { argb: 'FF000000' } },
        right: { style: 'thin', color: { argb: 'FF000000' } }
    };
    const roseFill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFDFA7A6' }
    };
    const accountingFmt = '_("Rp"* #,##0.00_);_("Rp"* (#,##0.00);_("Rp"* "-"??_);_(@_)';

    // Filter & sort transactions chronologically (oldest date first: 01 -> 31)
    const rawItems = Array.isArray(data) ? [...data] : [];
    const sortedItems = rawItems
        .filter(item => {
            // Skip duplicate repayment notification rows from the same period if parent exists
            if (item.parent_transaction_id && options.fromDate && item.parent_transaction_date) {
                const parentDateStr = String(item.parent_transaction_date).split('T')[0];
                const fromDateStr = String(options.fromDate).split('T')[0];
                if (parentDateStr >= fromDateStr) return false;
            }
            return true;
        })
        .sort((a, b) => {
            const dateStrA = String(a.transaction_date || '').split('T')[0];
            const dateStrB = String(b.transaction_date || '').split('T')[0];
            if (dateStrA !== dateStrB) {
                return dateStrA.localeCompare(dateStrB);
            }
            // Within the same day: put Income (especially OZ / Omzet) first so daily running balance starts from income
            const isIncA = a.type === 'income' ? 0 : 1;
            const isIncB = b.type === 'income' ? 0 : 1;
            if (isIncA !== isIncB) return isIncA - isIncB;

            const isOzA = /omzet|omset/i.test(a.category_name || '') ? 0 : 1;
            const isOzB = /omzet|omset/i.test(b.category_name || '') ? 0 : 1;
            if (isOzA !== isOzB) return isOzA - isOzB;

            return (a.id || 0) - (b.id || 0);
        });

    const periodText = formatPeriodText(options.fromDate, options.toDate, sortedItems);
    const outletLabel = String(branchName || options.branchName || 'OUTLET').toUpperCase();
    const kasLabel = (options.category && options.category !== 'Semua Kategori')
        ? String(options.category).toUpperCase()
        : 'KAS BERJALAN';

    // Top Metadata Block (Rows 1 - 4)
    const metaRows = [
        { label: 'NAMA OUTLET', value: `: ${outletLabel}`, boldValue: false, highlight: false },
        { label: 'NAMA LAMPIRAN', value: ': KERTAS KERJA', boldValue: false, highlight: false },
        { label: 'TANGGAL', value: `: ${periodText}`, boldValue: false, highlight: false },
        { label: 'NAMA KAS', value: `: ${kasLabel}`, boldValue: true, highlight: true }
    ];

    metaRows.forEach((meta, idx) => {
        const r = idx + 1;
        const row = worksheet.getRow(r);
        row.height = meta.highlight ? 20 : 18;

        const labelCell = worksheet.getCell(`B${r}`);
        labelCell.value = meta.label;
        labelCell.font = { name: fontName, size: 10, bold: true, color: { argb: 'FF000000' } };
        labelCell.alignment = { horizontal: 'left', vertical: 'middle' };

        const valCell = worksheet.getCell(`D${r}`);
        valCell.value = meta.value;
        valCell.font = { name: fontName, size: 10, bold: meta.boldValue, color: { argb: 'FF000000' } };
        valCell.alignment = { horizontal: 'left', vertical: 'middle' };

        if (meta.highlight) {
            worksheet.getCell(`B${r}`).fill = roseFill;
            worksheet.getCell(`C${r}`).fill = roseFill;
            worksheet.getCell(`D${r}`).fill = roseFill;
        }
    });

    // Table Header Row (Row 5)
    const headerRowIndex = 5;
    const headerRow = worksheet.getRow(headerRowIndex);
    headerRow.height = 24;

    const headers = [
        { col: 2, text: 'TGL', isRefund: false },
        { col: 3, text: 'Kode', isRefund: false },
        { col: 4, text: 'Keterangan', isRefund: false },
        { col: 5, text: 'Dr', isRefund: false },
        { col: 6, text: 'Cr', isRefund: false },
        { col: 7, text: 'REFUND', isRefund: true },
        { col: 8, text: 'Saldo', isRefund: false }
    ];

    headers.forEach(h => {
        const cell = headerRow.getCell(h.col);
        cell.value = h.text;
        cell.font = {
            name: fontName,
            size: 10,
            bold: true,
            color: { argb: h.isRefund ? 'FFFF0000' : 'FF000000' }
        };
        cell.alignment = { horizontal: 'center', vertical: 'middle' };
        cell.border = thinBorder;
        if (h.isRefund) {
            cell.fill = roseFill;
        }
    });

    // Data Rows (Row 6+)
    let currentRow = 6;
    let runningSaldo = 0;
    const firstDataRow = currentRow;

    sortedItems.forEach((item, index) => {
        const row = worksheet.getRow(currentRow);
        row.height = 19;

        // Parse 2-digit day (TGL)
        let dayStr = '01';
        if (item.transaction_date) {
            const s = String(item.transaction_date).split('T')[0];
            const parts = s.split('-');
            if (parts.length === 3) {
                dayStr = String(parseInt(parts[2], 10)).padStart(2, '0');
            } else {
                const d = new Date(item.transaction_date);
                if (!isNaN(d.getTime())) {
                    dayStr = String(d.getDate()).padStart(2, '0');
                }
            }
        }

        const kode = resolveCategoryKode(item.category_name, item.category_code, item.note, item.type);
        let keterangan = sanitizeText(item.note || '');
        if (!keterangan || keterangan === '-') {
            if (kode === 'OZ') keterangan = 'Omzet';
            else if (kode === 'SP') keterangan = 'Simpanan Wajib';
            else keterangan = sanitizeText(item.category_name || '-');
        }

        const isIncome = item.type === 'income';
        const refundAmt = Math.abs(parseFloat(item.total_refund || 0));
        const futureRef = Math.abs(parseFloat(item.future_refund || 0));

        let drVal = null;
        let crVal = null;
        let refVal = refundAmt > 0 ? refundAmt : null;

        if (isIncome) {
            const isMainDebt = (item.is_debt_payment === true || item.is_debt_payment === 1 || item.is_debt_payment === '1') && !item.parent_transaction_id;
            const rawIncome = isMainDebt && item.paid_amount !== undefined && item.paid_amount !== null
                ? parseFloat(item.paid_amount || 0)
                : (Math.abs(parseFloat(item.amount || 0)) + futureRef);
            const pb1Val = parseFloat(item.pb1 || 0);
            drVal = Math.max(0, rawIncome - pb1Val);
        } else {
            const netExpense = Math.abs(parseFloat(item.amount || 0)) + futureRef;
            // If there is a refund on this expense, Cr shows original gross expense and REFUND column shows the refund amount
            crVal = refundAmt > 0 ? (netExpense + refundAmt) : netExpense;
        }

        const drNum = drVal !== null ? drVal : 0;
        const crNum = crVal !== null ? crVal : 0;
        const refNum = refVal !== null ? refVal : 0;
        runningSaldo += (drNum - crNum + refNum);

        // Col B: TGL
        const cTgl = row.getCell(2);
        cTgl.value = dayStr;
        cTgl.numFmt = '@';
        cTgl.font = { name: fontName, size: 10, color: { argb: 'FF000000' } };
        cTgl.alignment = { horizontal: 'center', vertical: 'middle' };
        cTgl.border = thinBorder;

        // Col C: Kode
        const cKode = row.getCell(3);
        cKode.value = kode;
        cKode.font = { name: fontName, size: 10, color: { argb: 'FF000000' } };
        cKode.alignment = { horizontal: 'center', vertical: 'middle' };
        cKode.border = thinBorder;

        // Col D: Keterangan
        const cKet = row.getCell(4);
        cKet.value = keterangan;
        cKet.font = { name: fontName, size: 10, color: { argb: 'FF000000' } };
        cKet.alignment = { horizontal: 'left', vertical: 'middle' };
        cKet.border = thinBorder;

        // Col E: Dr
        const cDr = row.getCell(5);
        if (drVal !== null) {
            cDr.value = drVal;
            cDr.numFmt = accountingFmt;
        }
        cDr.font = { name: fontName, size: 10, color: { argb: 'FF000000' } };
        cDr.alignment = { horizontal: 'right', vertical: 'middle' };
        cDr.border = thinBorder;

        // Col F: Cr
        const cCr = row.getCell(6);
        if (crVal !== null) {
            cCr.value = crVal;
            cCr.numFmt = accountingFmt;
        }
        cCr.font = { name: fontName, size: 10, color: { argb: 'FF000000' } };
        cCr.alignment = { horizontal: 'right', vertical: 'middle' };
        cCr.border = thinBorder;

        // Col G: REFUND
        const cRef = row.getCell(7);
        if (refVal !== null) {
            cRef.value = refVal;
            cRef.numFmt = accountingFmt;
        }
        cRef.font = { name: fontName, size: 10, color: { argb: 'FF000000' } };
        cRef.alignment = { horizontal: 'right', vertical: 'middle' };
        cRef.border = thinBorder;

        // Col H: Saldo (Running Balance with live Excel formula)
        const cSaldo = row.getCell(8);
        const formulaStr = index === 0
            ? `E${currentRow}-F${currentRow}+G${currentRow}`
            : `H${currentRow - 1}+E${currentRow}-F${currentRow}+G${currentRow}`;
        cSaldo.value = { formula: formulaStr, result: runningSaldo };
        cSaldo.numFmt = accountingFmt;
        cSaldo.font = { name: fontName, size: 10, color: { argb: 'FF000000' } };
        cSaldo.alignment = { horizontal: 'right', vertical: 'middle' };
        cSaldo.border = thinBorder;

        currentRow++;
    });

    // Total Summary Row at the bottom
    if (sortedItems.length > 0) {
        const lastDataRow = currentRow - 1;
        const totalRow = worksheet.getRow(currentRow);
        totalRow.height = 21;

        worksheet.mergeCells(`B${currentRow}:D${currentRow}`);
        const cTotalLabel = totalRow.getCell(2);
        cTotalLabel.value = 'TOTAL';
        cTotalLabel.font = { name: fontName, size: 10, bold: true, color: { argb: 'FF000000' } };
        cTotalLabel.alignment = { horizontal: 'center', vertical: 'middle' };

        const totalDr = sortedItems.reduce((s, it) => {
            if (it.type !== 'income') return s;
            const isMainDebt = (it.is_debt_payment === true || it.is_debt_payment === 1 || it.is_debt_payment === '1') && !it.parent_transaction_id;
            const rawInc = isMainDebt && it.paid_amount !== undefined && it.paid_amount !== null
                ? parseFloat(it.paid_amount || 0)
                : (Math.abs(parseFloat(it.amount || 0)) + Math.abs(parseFloat(it.future_refund || 0)));
            return s + Math.max(0, rawInc - parseFloat(it.pb1 || 0));
        }, 0);

        const totalCr = sortedItems.reduce((s, it) => {
            if (it.type === 'income') return s;
            const netExp = Math.abs(parseFloat(it.amount || 0)) + Math.abs(parseFloat(it.future_refund || 0));
            const ref = Math.abs(parseFloat(it.total_refund || 0));
            return s + (ref > 0 ? netExp + ref : netExp);
        }, 0);

        const totalRef = sortedItems.reduce((s, it) => s + Math.abs(parseFloat(it.total_refund || 0)), 0);

        const cTotDr = totalRow.getCell(5);
        cTotDr.value = { formula: `SUM(E${firstDataRow}:E${lastDataRow})`, result: totalDr };
        cTotDr.numFmt = accountingFmt;
        cTotDr.font = { name: fontName, size: 10, bold: true, color: { argb: 'FF000000' } };
        cTotDr.alignment = { horizontal: 'right', vertical: 'middle' };

        const cTotCr = totalRow.getCell(6);
        cTotCr.value = { formula: `SUM(F${firstDataRow}:F${lastDataRow})`, result: totalCr };
        cTotCr.numFmt = accountingFmt;
        cTotCr.font = { name: fontName, size: 10, bold: true, color: { argb: 'FF000000' } };
        cTotCr.alignment = { horizontal: 'right', vertical: 'middle' };

        const cTotRef = totalRow.getCell(7);
        cTotRef.value = { formula: `SUM(G${firstDataRow}:G${lastDataRow})`, result: totalRef };
        cTotRef.numFmt = accountingFmt;
        cTotRef.font = { name: fontName, size: 10, bold: true, color: { argb: 'FF000000' } };
        cTotRef.alignment = { horizontal: 'right', vertical: 'middle' };

        const cTotSaldo = totalRow.getCell(8);
        cTotSaldo.value = { formula: `E${currentRow}-F${currentRow}+G${currentRow}`, result: runningSaldo };
        cTotSaldo.numFmt = accountingFmt;
        cTotSaldo.font = { name: fontName, size: 10, bold: true, color: { argb: 'FF000000' } };
        cTotSaldo.alignment = { horizontal: 'right', vertical: 'middle' };

        for (let col = 2; col <= 8; col++) {
            totalRow.getCell(col).border = thinBorder;
        }
    }

    const filepath = path.join(EXPORTS_DIR, filename);
    await workbook.xlsx.writeFile(filepath);

    return filepath;
}

// Export Category Visual Report to Excel (Matching PDF styling exactly)
async function exportCategoryToExcel(data, filename, branchName, options = {}) {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'VERKAS';
    workbook.created = new Date();

    const worksheet = workbook.addWorksheet('Laporan Kategori', {
        views: [{ showGridLines: true }]
    });

    // Filter out zero amount transactions
    const validData = (data || []).filter(item => {
        const val = Math.abs(parseFloat(item.net_amount !== undefined ? item.net_amount : item.amount || 0));
        return val > 0.001;
    });

    // Sort transactions chronologically (oldest first: 1 -> 31)
    validData.sort((a, b) => {
        const d1 = new Date(a.transaction_date).getTime();
        const d2 = new Date(b.transaction_date).getTime();
        if (d1 !== d2) return d1 - d2;
        return (a.id || 0) - (b.id || 0);
    });

    const INDONESIAN_DAYS = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];

    // Determine Type / Lampiran Name
    // Determine if sales channels are present
    const hasSalesChannels = !!(options.hasSalesChannels && options.salesChannels && options.salesChannels.length > 0);

    // Determine Type / Lampiran Name
    let lampiranType = 'PENGELUARAN';
    if (hasSalesChannels || options.type === 'income') {
        lampiranType = 'PEMASUKAN';
    } else if (options.type === 'expense') {
        lampiranType = 'PENGELUARAN';
    } else {
        const incomeCount = validData.filter(t => t.type === 'income').length;
        const expenseCount = validData.filter(t => t.type === 'expense').length;
        if (expenseCount > 0 && incomeCount === 0) {
            lampiranType = 'PENGELUARAN';
        } else if (incomeCount > 0 && expenseCount === 0) {
            lampiranType = 'PEMASUKAN';
        } else if (incomeCount > 0 && expenseCount > 0) {
            lampiranType = 'PEMASUKAN & PENGELUARAN';
        }
    }

    const isExpense = lampiranType === 'PENGELUARAN';
    const softBgArgb = isExpense ? 'FFFDECEB' : 'FFEEF4E8';

    const rawCategoryName = (options.categoryName || 'SEMUA KATEGORI').toUpperCase();
    let categoryTitle = (options.categoryTitle || (options.categoryCode ? `${options.categoryCode}. ${rawCategoryName}` : rawCategoryName)).toUpperCase();

    if (hasSalesChannels) {
        const channelCount = options.salesChannels.length;
        const nums = [];
        for (let i = 1; i <= channelCount; i++) {
            nums.push(i + '.');
        }
        let prefix = '';
        if (nums.length === 1) {
            prefix = nums[0];
        } else {
            prefix = nums.slice(0, -1).join(' ') + ' & ' + nums[nums.length - 1];
        }
        const cleanCat = rawCategoryName.replace(/^(\d+[\.\s\-]+|&|\s)+/i, '').trim();
        categoryTitle = `${prefix} ${cleanCat}`.toUpperCase();
    }

    const periodText = formatPeriodText(options.fromDate, options.toDate, validData);
    const workingDays = options.workingDays || 26;

    // Resolve Total column header (e.g. "Total BB" for Bahan Baku, "Total Oz" for Omzet)
    function resolveTotalColHeader(title, name) {
        const full = `${title || ''} ${name || ''}`.toUpperCase();
        if (hasSalesChannels || full.includes('OMZET') || full.includes('OMSET')) {
            return 'Total Oz';
        }
        if (full.includes('BAHAN BAKU') || full.includes('BB')) {
            return 'Total BB';
        }
        if (full.includes('OPERASIONAL') || full.includes('OPS')) {
            return 'Total Ops';
        }
        if (full.includes('GAJI')) {
            return 'Total Gaji';
        }
        if (full.includes('PACKAGING') || full.includes('PKG')) {
            return 'Total PKG';
        }
        if (full.includes('MARKETPLACE')) {
            return 'Total Market';
        }
        const clean = (name || '').trim();
        if (clean && clean.length <= 10 && clean !== 'Semua Kategori' && clean !== 'SEMUA KATEGORI') {
            return `Total ${clean}`;
        }
        return 'Total Harian';
    }

    const totalColHeader = resolveTotalColHeader(categoryTitle, options.categoryName);

    // Group transactions by Date
    const parseDateComponents = (dateVal) => {
        if (!dateVal) return { key: 'unknown', dayNumber: 1, dayName: 'Senin' };
        const s = String(dateVal).split('T')[0];
        const parts = s.split('-');
        let year = 2026, month = 0, day = 1;
        if (parts.length === 3) {
            year = parseInt(parts[0], 10);
            month = parseInt(parts[1], 10) - 1;
            day = parseInt(parts[2], 10);
        }
        const d = new Date(year, month, day);
        return {
            key: `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
            dayNumber: day,
            dayName: INDONESIAN_DAYS[d.getDay()] || 'Senin'
        };
    };

    const groups = [];
    const groupMap = new Map();

    for (const item of validData) {
        const dateInfo = parseDateComponents(item.transaction_date);
        let group = groupMap.get(dateInfo.key);
        if (!group) {
            group = {
                key: dateInfo.key,
                dayNumber: dateInfo.dayNumber,
                dayName: dateInfo.dayName,
                rawItems: [],
                items: [],
                dayTotal: 0
            };
            groupMap.set(dateInfo.key, group);
            groups.push(group);
        }
        const itemAmt = Math.abs(parseFloat(item.net_amount !== undefined ? item.net_amount : item.amount || 0));
        group.rawItems.push(item);
        group.dayTotal += itemAmt;
    }

    if (hasSalesChannels) {
        const catPrefix = (options.categoryCode || '1').trim();
        for (const group of groups) {
            const channelSums = new Map();
            let totalFromDetails = 0;

            for (const t of group.rawItems) {
                if (t.sales_channel_details && Array.isArray(t.sales_channel_details)) {
                    for (const scd of t.sales_channel_details) {
                        const scId = scd.sales_channel_id;
                        const amt = Math.abs(parseFloat(scd.amount || 0));
                        channelSums.set(scId, (channelSums.get(scId) || 0) + amt);
                        totalFromDetails += amt;
                    }
                }
            }

            const fallbackToFirst = (totalFromDetails === 0 && group.dayTotal > 0);

            group.items = options.salesChannels.map((channel, idx) => {
                let amt = channelSums.get(channel.id) || 0;
                if (fallbackToFirst && idx === 0) {
                    amt = group.dayTotal;
                }
                const cleanName = (channel.name || '').replace(/^[\d\.\s\-]+/, '').trim();
                const note = `${catPrefix}.${idx + 1} ${cleanName}`;
                return {
                    id: channel.id,
                    note: note,
                    amount: amt,
                    channel_name: channel.name,
                    is_sales_channel: true
                };
            });

            const recalculatedDayTotal = group.items.reduce((s, it) => s + it.amount, 0);
            if (recalculatedDayTotal > 0 || group.dayTotal === 0) {
                group.dayTotal = recalculatedDayTotal;
            }
        }
    } else {
        for (const group of groups) {
            group.items = group.rawItems;
        }
    }

    // Calculate grand total across the whole report
    const grandTotal = groups.reduce((sum, g) => sum + g.dayTotal, 0);

    // Setup Columns
    worksheet.columns = [
        { key: 'tgl', width: 9 },
        { key: 'note', width: 48 },
        { key: 'nominal_rp', width: 19 },
        { key: 'nominal_perc', width: 10 },
        { key: 'total_day', width: 20 },
        { key: 'day_perc', width: 10 }
    ];

    const thinBorder = {
        top: { style: 'thin', color: { argb: 'FF000000' } },
        left: { style: 'thin', color: { argb: 'FF000000' } },
        bottom: { style: 'thin', color: { argb: 'FF000000' } },
        right: { style: 'thin', color: { argb: 'FF000000' } }
    };

    const navyFill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FF001B54' }
    };

    const whiteFont = {
        name: 'Calibri',
        size: 11,
        bold: true,
        color: { argb: 'FFFFFFFF' }
    };

    // Row 1 - 4: Header Container (Deep Navy #001B54)
    const headerRows = [
        `NAMA LAMPIRAN : ${lampiranType}`,
        `NAMA KATEGORI : ${categoryTitle}`,
        `TANGGAL : ${periodText}`,
        `BUKA : ${workingDays} HARI`
    ];

    for (let r = 1; r <= 4; r++) {
        const row = worksheet.getRow(r);
        row.height = 20;

        // Merge A-D for title text
        worksheet.mergeCells(`A${r}:D${r}`);
        const textCell = worksheet.getCell(`A${r}`);
        textCell.value = headerRows[r - 1];
        textCell.font = whiteFont;
        textCell.alignment = { horizontal: 'left', vertical: 'middle', indent: 1 };

        // Fill Navy for all columns (A-F)
        for (let col = 1; col <= 6; col++) {
            worksheet.getRow(r).getCell(col).fill = navyFill;
        }
    }

    // Right Total Box on E4 / F4
    const accountingIntFmt = '_("Rp"* #,##0_);_("Rp"* (#,##0);_("Rp"* 0_);_(@_)';
    const accountingDecFmt = '_("Rp"* #,##0.00_);_("Rp"* (#,##0.00);_("Rp"* 0.00_);_(@_)';

    if (hasSalesChannels) {
        const totalCell = worksheet.getCell('E4');
        totalCell.value = grandTotal;
        totalCell.font = { name: 'Calibri', size: 11, bold: true, color: { argb: 'FFFFFFFF' } };
        totalCell.alignment = { horizontal: 'right', vertical: 'middle' };
        totalCell.numFmt = accountingIntFmt;
        totalCell.fill = navyFill;
        totalCell.border = {
            top: { style: 'medium', color: { argb: 'FFFFFFFF' } },
            left: { style: 'medium', color: { argb: 'FFFFFFFF' } },
            bottom: { style: 'medium', color: { argb: 'FFFFFFFF' } },
            right: { style: 'medium', color: { argb: 'FFFFFFFF' } }
        };

        const percCell = worksheet.getCell('F4');
        percCell.value = 1;
        percCell.font = { name: 'Calibri', size: 11, bold: true, color: { argb: 'FFFFFFFF' } };
        percCell.alignment = { horizontal: 'center', vertical: 'middle' };
        percCell.numFmt = '0%';
        percCell.fill = navyFill;
        percCell.border = {
            top: { style: 'medium', color: { argb: 'FFFFFFFF' } },
            left: { style: 'medium', color: { argb: 'FFFFFFFF' } },
            bottom: { style: 'medium', color: { argb: 'FFFFFFFF' } },
            right: { style: 'medium', color: { argb: 'FFFFFFFF' } }
        };
    } else {
        worksheet.mergeCells('E4:F4');
        const totalCell = worksheet.getCell('E4');
        totalCell.value = grandTotal;
        totalCell.font = { name: 'Calibri', size: 12, bold: true, color: { argb: 'FFFFFFFF' } };
        totalCell.alignment = { horizontal: 'right', vertical: 'middle' };
        totalCell.numFmt = accountingIntFmt;
        totalCell.border = {
            top: { style: 'medium', color: { argb: 'FFFFFFFF' } },
            left: { style: 'medium', color: { argb: 'FFFFFFFF' } },
            bottom: { style: 'medium', color: { argb: 'FFFFFFFF' } },
            right: { style: 'medium', color: { argb: 'FFFFFFFF' } }
        };
        worksheet.getCell('F4').border = totalCell.border;
    }

    // Row 5: Table Header
    const tableHeaderRow = worksheet.getRow(5);
    tableHeaderRow.height = 24;

    worksheet.getCell('A5').value = 'TGL';
    worksheet.getCell('B5').value = 'Keterangan';
    worksheet.mergeCells('C5:D5');
    worksheet.getCell('C5').value = 'Nominal';
    worksheet.getCell('E5').value = totalColHeader;
    worksheet.getCell('F5').value = '%';

    ['A5', 'B5', 'C5', 'D5', 'E5', 'F5'].forEach((cellRef) => {
        const cell = worksheet.getCell(cellRef);
        cell.font = { name: 'Calibri', size: 10, bold: true, color: { argb: 'FF000000' } };
        cell.alignment = { horizontal: 'center', vertical: 'middle' };
        cell.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FFFFFFFF' }
        };
        cell.border = thinBorder;
    });

    // Rows 6+: Data Rows grouped by date
    let currentRow = 6;

    for (const group of groups) {
        const startRow = currentRow;
        const isSingleItemInGroup = group.items.length === 1;

        group.items.forEach((item, idx) => {
            const row = worksheet.getRow(currentRow);
            row.height = isSingleItemInGroup ? 28 : 20;

            const itemAmt = Math.abs(parseFloat(item.amount !== undefined ? item.amount : (item.net_amount !== undefined ? item.net_amount : 0)));
            const isEven = idx % 2 === 0;
            const rowBgColor = isEven ? 'FFFFFFFF' : softBgArgb;

            // Cell B: Keterangan
            const cellB = row.getCell(2);
            cellB.value = sanitizeText(item.note || item.category_name || '-');
            cellB.alignment = { horizontal: 'left', vertical: 'middle', wrapText: true };
            cellB.font = { name: 'Calibri', size: 10, color: { argb: 'FF000000' } };

            // Cell C: Nominal Rp
            const cellC = row.getCell(3);
            cellC.value = itemAmt;
            cellC.alignment = { horizontal: 'right', vertical: 'middle' };
            cellC.font = { name: 'Calibri', size: 10, color: { argb: 'FF000000' } };
            cellC.numFmt = accountingDecFmt;

            // Cell D: Item %
            const cellD = row.getCell(4);
            cellD.value = group.dayTotal > 0 ? (itemAmt / group.dayTotal) : 0;
            cellD.alignment = { horizontal: 'right', vertical: 'middle' };
            cellD.font = { name: 'Calibri', size: 10, bold: true, color: { argb: 'FF000000' } };
            cellD.numFmt = hasSalesChannels ? '0%' : '0.00%';

            // Apply row background and borders to middle cells (cols 2, 3, 4)
            for (let col = 2; col <= 4; col++) {
                const c = row.getCell(col);
                c.fill = {
                    type: 'pattern',
                    pattern: 'solid',
                    fgColor: { argb: rowBgColor }
                };
                c.border = thinBorder;
            }

            currentRow++;
        });

        const endRow = currentRow - 1;

        // Merge A: TGL
        worksheet.mergeCells(`A${startRow}:A${endRow}`);
        const cellA = worksheet.getCell(`A${startRow}`);
        cellA.value = `${group.dayNumber}\n${group.dayName}`;
        cellA.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
        cellA.font = { name: 'Calibri', size: 10, bold: true, color: { argb: 'FF000000' } };
        cellA.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: softBgArgb }
        };

        // Merge E: Total BB/Oz
        worksheet.mergeCells(`E${startRow}:E${endRow}`);
        const cellE = worksheet.getCell(`E${startRow}`);
        cellE.value = group.dayTotal;
        cellE.alignment = { horizontal: 'right', vertical: 'middle' };
        cellE.font = { name: 'Calibri', size: 10, bold: true, color: { argb: 'FF000000' } };
        cellE.numFmt = accountingDecFmt;
        cellE.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FFFFFFFF' }
        };

        // Merge F: %
        worksheet.mergeCells(`F${startRow}:F${endRow}`);
        const cellF = worksheet.getCell(`F${startRow}`);
        cellF.value = grandTotal > 0 ? (group.dayTotal / grandTotal) : 0;
        cellF.alignment = { horizontal: 'right', vertical: 'middle' };
        cellF.font = { name: 'Calibri', size: 10, bold: true, color: { argb: 'FF000000' } };
        cellF.numFmt = hasSalesChannels ? '0%' : '0.00%';
        cellF.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: softBgArgb }
        };

        // Ensure border on all merged cells
        for (let r = startRow; r <= endRow; r++) {
            worksheet.getCell(`A${r}`).border = thinBorder;
            worksheet.getCell(`E${r}`).border = thinBorder;
            worksheet.getCell(`F${r}`).border = thinBorder;
        }
    }

    // Ensure output filepath
    const filepath = path.join(EXPORTS_DIR, filename);
    await workbook.xlsx.writeFile(filepath);

    return filepath;
}

/**
 * Export Financial Report to Excel (Matching PDF layout and styling exactly)
 */
async function exportFinancialReportToExcel(data, filename, branchName, selectedMonth, workingDays, options = {}) {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'VERKAS';
    workbook.created = new Date();

    const monthShortNames = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
    const mShort = monthShortNames[selectedMonth.getMonth()] || 'Bln';
    const yShort = String(selectedMonth.getFullYear()).slice(-2);

    const sheetName = `Lap Keu - ${mShort} ${yShort}`.substring(0, 31);
    const worksheet = workbook.addWorksheet(sheetName, {
        views: [{ showGridLines: true }]
    });

    // Column Setup (Matching the 4 columns of the PDF table)
    let maxNameColWidth = 52;
    worksheet.columns = [
        { key: 'no', width: 7 },
        { key: 'name', width: maxNameColWidth },
        { key: 'amount', width: 24 },
        { key: 'percent', width: 15 }
    ];

    const fontName = 'Segoe UI';
    const thinBorder = {
        top: { style: 'thin', color: { argb: 'FF000000' } },
        left: { style: 'thin', color: { argb: 'FF000000' } },
        bottom: { style: 'thin', color: { argb: 'FF000000' } },
        right: { style: 'thin', color: { argb: 'FF000000' } }
    };
    const currencyFmt = '_("Rp"* #,##0_);[Red]_("Rp"* -#,##0_);_("Rp"* "-"_);_(@_)';
    const percentFmt = '0.00%';

    let currentRow = 1;

    // Helper: Style all cells in a row or range
    const applyBorders = (startR, endR = startR, startC = 1, endC = 4, border = thinBorder) => {
        for (let r = startR; r <= endR; r++) {
            for (let c = startC; c <= endC; c++) {
                worksheet.getCell(r, c).border = border;
            }
        }
    };

    // 1. TOP HEADER BANNER (Navy Blue #0A1C58 with Gold/Yellow #FFFF00 text)
    const branchLabel = (options.branchCode && options.branchCode.trim())
        ? options.branchCode.trim()
        : (options.branchName || branchName);

    // Row 1: LAP. KEU & Date Label
    worksheet.mergeCells(`A${currentRow}:B${currentRow}`);
    worksheet.mergeCells(`C${currentRow}:D${currentRow}`);
    
    const r1Left = worksheet.getCell(`A${currentRow}`);
    r1Left.value = 'LAP. KEU';
    r1Left.font = { name: fontName, size: 12, bold: true, color: { argb: 'FFFFFF00' } };
    r1Left.alignment = { horizontal: 'center', vertical: 'middle' };

    const r1Right = worksheet.getCell(`C${currentRow}`);
    r1Right.value = `${mShort} ${yShort}`;
    r1Right.font = { name: fontName, size: 11, bold: true, color: { argb: 'FFFFFF00' } };
    r1Right.alignment = { horizontal: 'right', vertical: 'middle' };

    worksheet.getRow(currentRow).height = 24;
    for (let c = 1; c <= 4; c++) {
        worksheet.getCell(currentRow, c).fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FF0A1C58' }
        };
    }
    applyBorders(currentRow, currentRow);
    currentRow++;

    // Row 2: BRANCH NAME & Working Days
    worksheet.mergeCells(`A${currentRow}:B${currentRow}`);
    worksheet.mergeCells(`C${currentRow}:D${currentRow}`);

    const r2Left = worksheet.getCell(`A${currentRow}`);
    r2Left.value = branchLabel.toUpperCase();
    r2Left.font = { name: fontName, size: 12, bold: true, color: { argb: 'FFFFFF00' } };
    r2Left.alignment = { horizontal: 'center', vertical: 'middle' };

    const r2Right = worksheet.getCell(`C${currentRow}`);
    r2Right.value = `Buka : ${workingDays || 30} Hari`;
    r2Right.font = { name: fontName, size: 11, bold: true, color: { argb: 'FFFFFF00' } };
    r2Right.alignment = { horizontal: 'right', vertical: 'middle' };

    worksheet.getRow(currentRow).height = 24;
    for (let c = 1; c <= 4; c++) {
        worksheet.getCell(currentRow, c).fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FF0A1C58' }
        };
    }
    applyBorders(currentRow, currentRow);
    currentRow++;

    // 2. PEMASUKAN SECTION
    const omzetItemsInitial = (data.income_breakdown || []).filter(it => {
        const n = (it.category_name || '').toLowerCase();
        return (n.includes('omzet') || n.includes('omset')) && !n.includes('lain');
    });
    const totalOmzetNetInitial = omzetItemsInitial.reduce((sum, it) => sum + (Number(it.total) || 0), 0);
    const totalOtherIncomeInitial = (data.income_breakdown || []).filter(it => !(it.category_name || '').toLowerCase().includes('omzet') && !(it.category_name || '').toLowerCase().includes('omset')).reduce((sum, it) => sum + (Number(it.total) || 0), 0);
    const totalPemasukanFinal = Number(data.omzet_total) || (totalOmzetNetInitial + totalOtherIncomeInitial + Number(data.pelunasan_piutang_bulan_lalu || 0));

    // Header bar (Forest Green #257942)
    worksheet.mergeCells(`A${currentRow}:B${currentRow}`);
    const pemTitle = worksheet.getCell(`A${currentRow}`);
    pemTitle.value = 'PEMASUKAN';
    pemTitle.font = { name: fontName, size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
    pemTitle.alignment = { horizontal: 'left', vertical: 'middle', indent: 1 };

    const pemAmt = worksheet.getCell(`C${currentRow}`);
    pemAmt.value = totalPemasukanFinal;
    pemAmt.numFmt = currencyFmt;
    pemAmt.font = { name: fontName, size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
    pemAmt.alignment = { horizontal: 'right', vertical: 'middle' };

    const pemPerc = worksheet.getCell(`D${currentRow}`);
    pemPerc.value = 1;
    pemPerc.numFmt = '0%';
    pemPerc.font = { name: fontName, size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
    pemPerc.alignment = { horizontal: 'center', vertical: 'middle' };

    worksheet.getRow(currentRow).height = 22;
    for (let c = 1; c <= 4; c++) {
        worksheet.getCell(currentRow, c).fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FF257942' }
        };
    }
    applyBorders(currentRow, currentRow);
    currentRow++;

    // Subheader
    const renderSubHeader = (col2Title) => {
        worksheet.getRow(currentRow).height = 18;
        const subHeaders = [
            { col: 'A', text: 'No', align: 'center' },
            { col: 'B', text: col2Title, align: 'center' },
            { col: 'C', text: 'Jumlah', align: 'center' },
            { col: 'D', text: 'Persentase', align: 'center' }
        ];
        subHeaders.forEach(sh => {
            const cell = worksheet.getCell(`${sh.col}${currentRow}`);
            cell.value = sh.text;
            cell.font = { name: fontName, size: 9, bold: true, color: { argb: 'FF000000' } };
            cell.alignment = { horizontal: sh.align, vertical: 'middle' };
            cell.fill = {
                type: 'pattern',
                pattern: 'solid',
                fgColor: { argb: 'FFFFFFFF' }
            };
        });
        applyBorders(currentRow, currentRow);
        currentRow++;
    };

    renderSubHeader('Sales Channel');

    // Pemasukan Items
    let pemIdx = 1;
    const omzetItems = (data.income_breakdown || []).filter(it => {
        const n = (it.category_name || '').toLowerCase();
        return (n.includes('omzet') || n.includes('omset')) && !n.includes('lain');
    });
    const totalOmzetNet = omzetItems.reduce((sum, it) => sum + (Number(it.total) || 0), 0);
    const salesChannelsList = [...(data.sales_channels || [])].sort((a, b) => {
        const diff = (Number(b.amount) || 0) - (Number(a.amount) || 0);
        if (diff !== 0) return diff;
        return String(a.name || a.channel_name || '').localeCompare(String(b.name || b.channel_name || ''));
    });
    const totalSalesChannels = salesChannelsList.reduce((sum, sc) => sum + (Number(sc.amount) || 0), 0);

    const reconcilePercentages = (amounts, base) => {
        if (!base || base <= 0 || !Array.isArray(amounts) || amounts.length === 0) {
            return (amounts || []).map(() => 0);
        }
        const rawBps = amounts.map(a => ((Math.max(0, Number(a) || 0) / base) * 10000));
        const roundedBps = rawBps.map(bp => Math.round(bp));
        const sumAmounts = amounts.reduce((s, a) => s + Math.max(0, Number(a) || 0), 0);

        if (Math.abs(sumAmounts - base) <= Math.max(2, base * 0.0001)) {
            let diff = 10000 - roundedBps.reduce((s, bp) => s + bp, 0);
            if (diff !== 0) {
                const step = diff > 0 ? 1 : -1;
                const indices = amounts.map((_, idx) => idx).sort((a, b) => {
                    const aSubstantial = roundedBps[a] >= 10 ? 1 : 0;
                    const bSubstantial = roundedBps[b] >= 10 ? 1 : 0;
                    if (aSubstantial !== bSubstantial) return bSubstantial - aSubstantial;
                    const remA = (rawBps[a] - roundedBps[a]) * step;
                    const remB = (rawBps[b] - roundedBps[b]) * step;
                    if (Math.abs(remB - remA) > 1e-9) return remB - remA;
                    return (Number(amounts[b]) || 0) - (Number(amounts[a]) || 0);
                });
                let i = 0;
                while (diff !== 0 && indices.length > 0 && i < indices.length * 4) {
                    const targetIdx = indices[i % indices.length];
                    if (roundedBps[targetIdx] + step >= 0) {
                        roundedBps[targetIdx] += step;
                        diff -= step;
                    }
                    i++;
                }
            }
        }
        return roundedBps.map(bp => bp / 100);
    };

    const renderDataRow = (noVal, nameVal, amtVal, isBold = true, bgArgb = 'FFFFFFFF', indent = 1, noAlign = 'center', overridePctRatio = null) => {
        const nameStr = String(nameVal || '');
        const neededWidth = Math.min(78, nameStr.length + indent * 2 + 4);
        if (neededWidth > maxNameColWidth) {
            maxNameColWidth = neededWidth;
            worksheet.getColumn(2).width = maxNameColWidth;
        }
        const estimatedLines = Math.max(1, Math.ceil((nameStr.length + indent * 2) / (maxNameColWidth - 2)));
        worksheet.getRow(currentRow).height = estimatedLines > 1 ? Math.max(18, estimatedLines * 14 + 4) : 18;

        const cellA = worksheet.getCell(`A${currentRow}`);
        cellA.value = noVal !== undefined && noVal !== null ? String(noVal) : '';
        cellA.font = { name: fontName, size: 9, bold: isBold, color: { argb: 'FF000000' } };
        cellA.alignment = {
            horizontal: noAlign,
            vertical: 'middle',
            ...(noAlign === 'left' ? { indent: 1 } : {})
        };

        const cellB = worksheet.getCell(`B${currentRow}`);
        cellB.value = nameVal;
        cellB.font = { name: fontName, size: 9, bold: isBold, color: { argb: 'FF000000' } };
        cellB.alignment = { horizontal: 'left', vertical: 'middle', indent, wrapText: true };

        const cellC = worksheet.getCell(`C${currentRow}`);
        if (typeof amtVal === 'number') {
            cellC.value = amtVal;
            cellC.numFmt = currencyFmt;
        } else {
            cellC.value = amtVal || '-';
        }
        cellC.font = { name: fontName, size: 9, bold: isBold, color: { argb: 'FF000000' } };
        cellC.alignment = { horizontal: 'right', vertical: 'middle' };

        const cellD = worksheet.getCell(`D${currentRow}`);
        if (overridePctRatio !== null && overridePctRatio !== undefined) {
            cellD.value = overridePctRatio;
            cellD.numFmt = percentFmt;
        } else if (typeof amtVal === 'number' && totalPemasukanFinal > 0) {
            cellD.value = amtVal / totalPemasukanFinal;
            cellD.numFmt = percentFmt;
        } else {
            cellD.value = '0,00%';
        }
        cellD.font = { name: fontName, size: 9, bold: isBold, color: { argb: 'FF000000' } };
        cellD.alignment = { horizontal: 'center', vertical: 'middle' };

        if (bgArgb && bgArgb !== 'FFFFFFFF') {
            for (let c = 1; c <= 4; c++) {
                worksheet.getCell(currentRow, c).fill = {
                    type: 'pattern',
                    pattern: 'solid',
                    fgColor: { argb: bgArgb }
                };
            }
        }
        applyBorders(currentRow, currentRow);
        currentRow++;
    };

    const pemasukanRows = [];
    if (salesChannelsList.length === 0) {
        if (totalOmzetNet > 0) {
            pemasukanRows.push({ name: 'Omzet Penjualan', amount: totalOmzetNet });
        }
    } else {
        salesChannelsList.forEach(sc => {
            let scName = (sc.name || sc.channel_name || '').trim().replace(/^(omzet|omset)\s+/i, '');
            const amt = Number(sc.amount) || 0;
            pemasukanRows.push({ name: scName, amount: amt });
        });

        const unallocatedOmzet = totalOmzetNet - totalSalesChannels;
        if (unallocatedOmzet >= 1) {
            pemasukanRows.push({ name: 'Omzet Belum Teralokasi Channel', amount: unallocatedOmzet });
        }
    }

    // Other income categories
    const otherIncomes = (data.income_breakdown || []).filter(it => {
        const n = (it.category_name || '').toLowerCase();
        return n.includes('lain') || (!n.includes('omzet') && !n.includes('omset'));
    });
    otherIncomes.forEach(it => {
        const amt = Number(it.total) || 0;
        const displayName = (it.category_name || '').toLowerCase().includes('lain')
            ? 'Pendapatan Lain-lain'
            : it.category_name;
        pemasukanRows.push({ name: displayName, amount: amt });
    });

    // Pelunasan Piutang Bulan Lalu
    if (data.pelunasan_piutang_bulan_lalu && Number(data.pelunasan_piutang_bulan_lalu) > 0) {
        const amt = Number(data.pelunasan_piutang_bulan_lalu);
        const label = `Pelunasan Piutang ${data.prev_month_label || 'Bulan Lalu'}`;
        pemasukanRows.push({ name: label, amount: amt });
    }

    const pemasukanPcts = reconcilePercentages(pemasukanRows.map(r => r.amount), totalPemasukanFinal);
    pemasukanRows.forEach((row, idx) => {
        const pemRowBg = idx % 2 === 0 ? 'FFEBF1DE' : 'FFFFFFFF';
        renderDataRow(pemIdx++, row.name, row.amount, true, pemRowBg, 1, 'center', pemasukanPcts[idx] / 100);
    });

    // 3. PENGELUARAN SECTION
    const isSimpananItem = (name) => {
        const ln = (name || '').toLowerCase();
        return ln.startsWith('kas ') || ln.startsWith('k.s.o.') || ln.includes('simpanan');
    };

    const isPiutangItem = (name) => {
        const ln = (name || '').toLowerCase();
        return ln.startsWith('piutang') || ln.includes('mitra piutang');
    };

    const regularExpenses = [];
    const simpananExpenses = [];
    let detectedPiutangFromBreakdown = null;

    (data.expense_breakdown || []).forEach(ex => {
        if (ex.is_sub_item || ex.is_adjustment) {
            regularExpenses.push(ex);
        } else if (isSimpananItem(ex.category_name)) {
            simpananExpenses.push(ex);
        } else if (isPiutangItem(ex.category_name)) {
            detectedPiutangFromBreakdown = ex;
        } else {
            regularExpenses.push(ex);
        }
    });

    const piutangAmount = (data.piutang_mitra !== undefined && data.piutang_mitra !== null && !isNaN(Number(data.piutang_mitra)))
        ? Number(data.piutang_mitra)
        : (data.total_piutang_mitra !== undefined && data.total_piutang_mitra !== null && !isNaN(Number(data.total_piutang_mitra)))
            ? Number(data.total_piutang_mitra)
            : (detectedPiutangFromBreakdown ? Number(detectedPiutangFromBreakdown.total) : 0);

    const piutangLabel = data.piutang_label || (detectedPiutangFromBreakdown ? detectedPiutangFromBreakdown.category_name : 'PIUTANG');

    const totalPengeluaran = (data.pure_pengeluaran !== undefined && data.pure_pengeluaran !== null)
        ? Number(data.pure_pengeluaran)
        : (regularExpenses.filter(x => !x.is_sub_item).reduce((s, x) => s + (Number(x.total) || 0), 0) + simpananExpenses.reduce((s, x) => s + (Number(x.total) || 0), 0));
    const totalExpPerc = totalPemasukanFinal > 0 ? (totalPengeluaran / totalPemasukanFinal) : 0;

    // Header bar (Red #E60000)
    worksheet.mergeCells(`A${currentRow}:B${currentRow}`);
    const pengTitle = worksheet.getCell(`A${currentRow}`);
    pengTitle.value = 'PENGELUARAN';
    pengTitle.font = { name: fontName, size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
    pengTitle.alignment = { horizontal: 'left', vertical: 'middle', indent: 1 };

    const pengAmt = worksheet.getCell(`C${currentRow}`);
    pengAmt.value = totalPengeluaran;
    pengAmt.numFmt = currencyFmt;
    pengAmt.font = { name: fontName, size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
    pengAmt.alignment = { horizontal: 'right', vertical: 'middle' };

    const pengPerc = worksheet.getCell(`D${currentRow}`);
    pengPerc.value = totalExpPerc;
    pengPerc.numFmt = percentFmt;
    pengPerc.font = { name: fontName, size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
    pengPerc.alignment = { horizontal: 'center', vertical: 'middle' };

    worksheet.getRow(currentRow).height = 22;
    for (let c = 1; c <= 4; c++) {
        worksheet.getCell(currentRow, c).fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FFE60000' }
        };
    }
    applyBorders(currentRow, currentRow);
    currentRow++;

    renderSubHeader('Uraian');

    let expNumberIdx = 0;
    let expSubIdx = 0;
    let expVisualRowIdx = 0;

    regularExpenses.forEach(ex => {
        const isChild = Boolean(ex.is_adjustment || ex.is_sub_item);
        if (!isChild) {
            expNumberIdx++;
            expSubIdx = 0;
        } else {
            expSubIdx++;
        }
        const rowNo = isChild ? '' : String(expNumberIdx);
        const subCode = isChild ? `${expNumberIdx}.${expSubIdx}` : '';
        const amt = Number(ex.total) || 0;
        const expRowBg = (expVisualRowIdx++ % 2 === 0) ? 'FFF2DCDB' : 'FFFFFFFF';
        renderDataRow(
            rowNo,
            isChild ? `  ${subCode}   ${ex.category_name}` : ex.category_name,
            amt,
            !isChild,
            expRowBg,
            isChild ? 2 : 1,
            'center'
        );
    });

    // Simpanan Expenses (if any)
    if (simpananExpenses.length > 0) {
        const totalSimpananAmt = simpananExpenses.reduce((sum, s) => sum + (Number(s.total) || 0), 0);
        const simpananNo = String(++expNumberIdx);
        const simpananParentBg = (expVisualRowIdx++ % 2 === 0) ? 'FFF2DCDB' : 'FFFFFFFF';

        // Parent Row for Simpanan
        renderDataRow(simpananNo, 'Total Simpanan', totalSimpananAmt, true, simpananParentBg, 1, 'center');

        // Sub-items for Simpanan (same style as sub-kategori, with 7.1, 7.2...)
        simpananExpenses.forEach((sx, sIdx) => {
            const subCode = `${simpananNo}.${sIdx + 1}`;
            const sAmt = Number(sx.total) || 0;
            let sTitle = sx.category_name;
            const customNote = typeof sx.savings_note === 'string' ? sx.savings_note.trim() : '';
            const allocAmt = Number(sx.allocation_amount) || 0;
            const allocDays = Number(sx.allocation_days) || 0;
            if (customNote) {
                const cleanNote = customNote.replace(/^\(\s*|\s*\)$/g, '');
                sTitle = `${sx.category_name} ( ${cleanNote} )`;
            } else if (!sTitle.includes('@')) {
                if (allocAmt > 0 && allocDays > 0) {
                    const formattedRate = new Intl.NumberFormat('id-ID', { minimumFractionDigits: 0 }).format(allocAmt);
                    sTitle = `${sx.category_name} ( ${formattedRate} @ ${allocDays} Hari )`;
                } else if (allocAmt > 0) {
                    const formattedRate = new Intl.NumberFormat('id-ID', { minimumFractionDigits: 0 }).format(allocAmt);
                    sTitle = `${sx.category_name} ( ${formattedRate} )`;
                } else if (allocDays > 0) {
                    sTitle = `${sx.category_name} ( ${allocDays} Hari )`;
                }
            }
            const subRowBg = (expVisualRowIdx++ % 2 === 0) ? 'FFF2DCDB' : 'FFFFFFFF';
            renderDataRow('', `  ${subCode}   ${sTitle}`, sAmt, false, subRowBg, 2, 'center');
        });
    }

    // 4. RINGKASAN SECTION
    worksheet.mergeCells(`A${currentRow}:D${currentRow}`);
    const ringkasanTitle = worksheet.getCell(`A${currentRow}`);
    ringkasanTitle.value = 'RINGKASAN';
    ringkasanTitle.font = { name: fontName, size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
    ringkasanTitle.alignment = { horizontal: 'left', vertical: 'middle', indent: 1 };
    worksheet.getRow(currentRow).height = 20;
    for (let c = 1; c <= 4; c++) {
        worksheet.getCell(currentRow, c).fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FF356296' }
        };
    }
    applyBorders(currentRow, currentRow);
    currentRow++;

    // Row 1: PEMASUKAN (#C7F7C4)
    const renderRingkasanRow = (label, amt, perc, bgArgb) => {
        worksheet.mergeCells(`A${currentRow}:B${currentRow}`);
        const cTitle = worksheet.getCell(`A${currentRow}`);
        cTitle.value = label;
        cTitle.font = { name: fontName, size: 9, bold: true, color: { argb: 'FF000000' } };
        cTitle.alignment = { horizontal: 'left', vertical: 'middle', indent: 1 };

        const cAmt = worksheet.getCell(`C${currentRow}`);
        cAmt.value = amt;
        cAmt.numFmt = currencyFmt;
        cAmt.font = { name: fontName, size: 9, bold: true, color: { argb: 'FF000000' } };
        cAmt.alignment = { horizontal: 'right', vertical: 'middle' };

        const cPerc = worksheet.getCell(`D${currentRow}`);
        cPerc.value = perc;
        cPerc.numFmt = percentFmt;
        cPerc.font = { name: fontName, size: 9, bold: true, color: { argb: 'FF000000' } };
        cPerc.alignment = { horizontal: 'center', vertical: 'middle' };

        worksheet.getRow(currentRow).height = 18;
        for (let c = 1; c <= 4; c++) {
            worksheet.getCell(currentRow, c).fill = {
                type: 'pattern',
                pattern: 'solid',
                fgColor: { argb: bgArgb }
            };
        }
        applyBorders(currentRow, currentRow);
        currentRow++;
    };

    renderRingkasanRow('PEMASUKAN', totalPemasukanFinal, 1, 'FFC7F7C4');
    renderRingkasanRow('PENGELUARAN', totalPengeluaran, totalExpPerc, 'FFFCDAD7');

    if (piutangAmount > 0) {
        const piutangPerc = totalPemasukanFinal > 0 ? (piutangAmount / totalPemasukanFinal) : 0;
        renderRingkasanRow(piutangLabel, piutangAmount, piutangPerc, 'FFFFF2CC');
    }

    const totalProfitAmount = Number(data.profit) !== undefined && !isNaN(Number(data.profit))
        ? Number(data.profit)
        : (totalPemasukanFinal - totalPengeluaran - piutangAmount);
    const profitPerc = totalPemasukanFinal > 0 ? (totalProfitAmount / totalPemasukanFinal) : 0;
    renderRingkasanRow('PROFIT/SELISIH', totalProfitAmount, profitPerc, 'FFD9E2F3');

    // 5. BAGI HASIL SECTION (if exists)
    if (data.bagi_hasil && data.bagi_hasil.length > 0) {
        worksheet.mergeCells(`A${currentRow}:D${currentRow}`);
        const bhHeader = worksheet.getCell(`A${currentRow}`);
        bhHeader.value = 'BAGI HASIL';
        bhHeader.font = { name: fontName, size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
        bhHeader.alignment = { horizontal: 'left', vertical: 'middle', indent: 1 };
        worksheet.getRow(currentRow).height = 20;
        for (let c = 1; c <= 4; c++) {
            worksheet.getCell(currentRow, c).fill = {
                type: 'pattern',
                pattern: 'solid',
                fgColor: { argb: 'FF356296' }
            };
        }
        applyBorders(currentRow, currentRow);
        currentRow++;

        data.bagi_hasil.forEach(bh => {
            const bhTitle = bh.title || bh.name || 'Partner';
            const bhAmt = Number(bh.amount) || 0;
            const bhPerc = bh.percentage !== undefined && bh.percentage !== '' ? (Number(bh.percentage) / 100) : 0;

            worksheet.mergeCells(`A${currentRow}:B${currentRow}`);
            const cellTitle = worksheet.getCell(`A${currentRow}`);
            cellTitle.value = bhTitle;
            cellTitle.font = { name: fontName, size: 9, bold: true, color: { argb: 'FF000000' } };
            cellTitle.alignment = { horizontal: 'left', vertical: 'middle', indent: 1 };

            const cellAmt = worksheet.getCell(`C${currentRow}`);
            cellAmt.value = bhAmt;
            cellAmt.numFmt = currencyFmt;
            cellAmt.font = { name: fontName, size: 9, bold: true, color: { argb: 'FF000000' } };
            cellAmt.alignment = { horizontal: 'right', vertical: 'middle' };

            const cellPerc = worksheet.getCell(`D${currentRow}`);
            if (bhPerc > 0) {
                cellPerc.value = bhPerc;
                cellPerc.numFmt = percentFmt;
            } else {
                cellPerc.value = '-';
            }
            cellPerc.font = { name: fontName, size: 9, bold: true, color: { argb: 'FF000000' } };
            cellPerc.alignment = { horizontal: 'center', vertical: 'middle' };

            worksheet.getRow(currentRow).height = 18;
            applyBorders(currentRow, currentRow);
            currentRow++;

            if (bh.subItems && bh.subItems.length > 0) {
                const activeSubs = bh.subItems.filter(sh => sh.is_active === undefined || sh.is_active === true || sh.is_active === 'true' || sh.is_active === 1);
                activeSubs.forEach(sh => {
                    const sAmt = Number(sh.amount) || (Number(sh.percentage) > 0 ? Math.round((bhAmt * Number(sh.percentage)) / 100) : 0);
                    const sSubsidi = Number(sh.subsidi) || 0;
                    const sPerc = sh.percentage !== undefined && sh.percentage !== '' ? (Number(sh.percentage) / 100) : 0;

                    worksheet.mergeCells(`A${currentRow}:B${currentRow}`);
                    const sCellTitle = worksheet.getCell(`A${currentRow}`);
                    sCellTitle.value = `    — ${sh.title}`;
                    sCellTitle.font = { name: fontName, size: 8.5, bold: false, color: { argb: 'FF000000' } };
                    sCellTitle.alignment = { horizontal: 'left', vertical: 'middle', indent: 1 };

                    const sCellAmt = worksheet.getCell(`C${currentRow}`);
                    sCellAmt.value = sAmt;
                    sCellAmt.numFmt = currencyFmt;
                    sCellAmt.font = { name: fontName, size: 8.5, bold: false, color: { argb: 'FF000000' } };
                    sCellAmt.alignment = { horizontal: 'right', vertical: 'middle' };

                    const sCellPerc = worksheet.getCell(`D${currentRow}`);
                    if (sPerc > 0) {
                        sCellPerc.value = sPerc;
                        sCellPerc.numFmt = percentFmt;
                    } else {
                        sCellPerc.value = '-';
                    }
                    sCellPerc.font = { name: fontName, size: 8.5, bold: false, color: { argb: 'FF000000' } };
                    sCellPerc.alignment = { horizontal: 'center', vertical: 'middle' };

                    worksheet.getRow(currentRow).height = 18;
                    for (let c = 1; c <= 4; c++) {
                        worksheet.getCell(currentRow, c).fill = {
                            type: 'pattern',
                            pattern: 'solid',
                            fgColor: { argb: 'FFFAEBE5' }
                        };
                    }
                    applyBorders(currentRow, currentRow);
                    currentRow++;

                    if (sSubsidi > 0) {
                        // SUB. row
                        worksheet.mergeCells(`A${currentRow}:B${currentRow}`);
                        const subCellTitle = worksheet.getCell(`A${currentRow}`);
                        subCellTitle.value = `        SUB.`;
                        subCellTitle.font = { name: fontName, size: 8.5, bold: true, color: { argb: 'FF000000' } };
                        subCellTitle.alignment = { horizontal: 'left', vertical: 'middle', indent: 1 };

                        const subCellAmt = worksheet.getCell(`C${currentRow}`);
                        subCellAmt.value = sSubsidi;
                        subCellAmt.numFmt = currencyFmt;
                        subCellAmt.font = { name: fontName, size: 8.5, bold: true, color: { argb: 'FF000000' } };
                        subCellAmt.alignment = { horizontal: 'right', vertical: 'middle' };

                        const subCellPerc = worksheet.getCell(`D${currentRow}`);
                        subCellPerc.value = '';
                        subCellPerc.font = { name: fontName, size: 8.5, bold: true, color: { argb: 'FF000000' } };

                        worksheet.getRow(currentRow).height = 18;
                        for (let c = 1; c <= 4; c++) {
                            worksheet.getCell(currentRow, c).fill = {
                                type: 'pattern',
                                pattern: 'solid',
                                fgColor: { argb: 'FFFAEBE5' }
                            };
                        }
                        applyBorders(currentRow, currentRow);
                        currentRow++;

                        // TOTAL row (yellow highlight)
                        worksheet.mergeCells(`A${currentRow}:B${currentRow}`);
                        const totCellTitle = worksheet.getCell(`A${currentRow}`);
                        totCellTitle.value = `        TOTAL`;
                        totCellTitle.font = { name: fontName, size: 8.5, bold: true, color: { argb: 'FF000000' } };
                        totCellTitle.alignment = { horizontal: 'left', vertical: 'middle', indent: 1 };

                        const totCellAmt = worksheet.getCell(`C${currentRow}`);
                        totCellAmt.value = sAmt + sSubsidi;
                        totCellAmt.numFmt = currencyFmt;
                        totCellAmt.font = { name: fontName, size: 8.5, bold: true, color: { argb: 'FF000000' } };
                        totCellAmt.alignment = { horizontal: 'right', vertical: 'middle' };

                        const totCellPerc = worksheet.getCell(`D${currentRow}`);
                        totCellPerc.value = '';
                        totCellPerc.font = { name: fontName, size: 8.5, bold: true, color: { argb: 'FF000000' } };

                        worksheet.getRow(currentRow).height = 18;
                        for (let c = 1; c <= 4; c++) {
                            worksheet.getCell(currentRow, c).fill = {
                                type: 'pattern',
                                pattern: 'solid',
                                fgColor: { argb: 'FFFFFF00' }
                            };
                        }
                        applyBorders(currentRow, currentRow);
                        currentRow++;
                    }
                });
            }
        });
    }

    // 6. NILAI STOK SECTION
    worksheet.mergeCells(`A${currentRow}:D${currentRow}`);
    const stokHeader = worksheet.getCell(`A${currentRow}`);
    stokHeader.value = 'NILAI STOK';
    stokHeader.font = { name: fontName, size: 10, bold: true, color: { argb: 'FFFFFFFF' } };
    stokHeader.alignment = { horizontal: 'left', vertical: 'middle', indent: 1 };
    worksheet.getRow(currentRow).height = 20;
    for (let c = 1; c <= 4; c++) {
        worksheet.getCell(currentRow, c).fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FF5C4777' }
        };
    }
    applyBorders(currentRow, currentRow);
    currentRow++;

    const renderStokRow = (label, val, hasVal) => {
        worksheet.mergeCells(`A${currentRow}:B${currentRow}`);
        const cTitle = worksheet.getCell(`A${currentRow}`);
        cTitle.value = label;
        cTitle.font = { name: fontName, size: 9, bold: false, color: { argb: 'FF000000' } };
        cTitle.alignment = { horizontal: 'left', vertical: 'middle', indent: 1 };

        worksheet.mergeCells(`C${currentRow}:D${currentRow}`);
        const cAmt = worksheet.getCell(`C${currentRow}`);
        if (hasVal && typeof val === 'number') {
            cAmt.value = val;
            cAmt.numFmt = currencyFmt;
        } else {
            cAmt.value = '-';
        }
        cAmt.font = { name: fontName, size: 9, bold: false, color: { argb: 'FF000000' } };
        cAmt.alignment = { horizontal: 'right', vertical: 'middle', indent: 1 };

        worksheet.getRow(currentRow).height = 18;
        applyBorders(currentRow, currentRow);
        currentRow++;
    };

    const hasStokAwal = data.stok_awal !== null && data.stok_awal !== undefined && data.stok_awal !== '';
    const stokAwalNum = parseFloat(data.stok_awal) || 0;
    renderStokRow('Nilai Stok Awal', stokAwalNum, hasStokAwal);

    const hasStokAkhir = data.stok_akhir !== null && data.stok_akhir !== undefined && data.stok_akhir !== '';
    const stokAkhirNum = parseFloat(data.stok_akhir) || 0;
    renderStokRow('Nilai Stok Akhir', stokAkhirNum, hasStokAkhir);

    const hasStokData = hasStokAwal || hasStokAkhir;
    const selisihStok = stokAkhirNum - stokAwalNum;
    renderStokRow('Selisih Nilai Stok', selisihStok, hasStokData);

    // Ensure output filepath
    const filepath = path.join(EXPORTS_DIR, filename);
    await workbook.xlsx.writeFile(filepath);

    return filepath;
}

module.exports = {
    exportToExcel,
    exportCategoryToExcel,
    exportFinancialReportToExcel
};
