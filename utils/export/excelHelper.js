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

// Export generic transactions to Excel
async function exportToExcel(data, filename, title) {
    const workbook = XLSX.utils.book_new();

    const worksheetData = [
        ['Tanggal', 'Kategori', 'Tipe', 'Jumlah', 'Keterangan'],
        ...data.map(item => [
            item.transaction_date,
            item.category_name,
            item.type === 'income' ? 'Pemasukan' : 'Pengeluaran',
            item.amount,
            item.note || ''
        ])
    ];

    const worksheet = XLSX.utils.aoa_to_sheet(worksheetData);
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Transaksi');

    const filepath = path.join(EXPORTS_DIR, filename);
    XLSX.writeFile(workbook, filepath);

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
    worksheet.columns = [
        { key: 'no', width: 8 },
        { key: 'name', width: 46 },
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
    const salesChannelsList = data.sales_channels || [];
    const totalSalesChannels = salesChannelsList.reduce((sum, sc) => sum + (Number(sc.amount) || 0), 0);

    const renderDataRow = (noVal, nameVal, amtVal, isBold = true, bgArgb = 'FFFFFFFF', indent = 1) => {
        worksheet.getRow(currentRow).height = 18;

        const cellA = worksheet.getCell(`A${currentRow}`);
        cellA.value = noVal !== undefined && noVal !== null ? String(noVal) : '';
        cellA.font = { name: fontName, size: 9, bold: isBold, color: { argb: 'FF000000' } };
        cellA.alignment = { horizontal: 'center', vertical: 'middle' };

        const cellB = worksheet.getCell(`B${currentRow}`);
        cellB.value = nameVal;
        cellB.font = { name: fontName, size: 9, bold: isBold, color: { argb: 'FF000000' } };
        cellB.alignment = { horizontal: 'left', vertical: 'middle', indent };

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
        if (typeof amtVal === 'number' && totalPemasukanFinal > 0) {
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

    if (salesChannelsList.length === 0) {
        if (totalOmzetNet > 0) {
            renderDataRow(pemIdx++, 'Omzet Penjualan', totalOmzetNet, true);
        }
    } else {
        salesChannelsList.forEach(sc => {
            let scName = (sc.name || sc.channel_name || '').trim().replace(/^(omzet|omset)\s+/i, '');
            const amt = Number(sc.amount) || 0;
            renderDataRow(pemIdx++, scName, amt, true);
        });

        const unallocatedOmzet = totalOmzetNet - totalSalesChannels;
        if (unallocatedOmzet >= 1) {
            renderDataRow(pemIdx++, 'Omzet Belum Teralokasi Channel', unallocatedOmzet, true);
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
        renderDataRow(pemIdx++, displayName, amt, true);
    });

    // Pelunasan Piutang Bulan Lalu
    if (data.pelunasan_piutang_bulan_lalu && Number(data.pelunasan_piutang_bulan_lalu) > 0) {
        const amt = Number(data.pelunasan_piutang_bulan_lalu);
        const label = `Pelunasan Piutang ${data.prev_month_label || 'Bulan Lalu'}`;
        renderDataRow(pemIdx++, label, amt, true);
    }

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
        if (isSimpananItem(ex.category_name)) {
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
        : (regularExpenses.reduce((s, x) => s + (Number(x.total) || 0), 0) + simpananExpenses.reduce((s, x) => s + (Number(x.total) || 0), 0));
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

    const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    let expLetterIdx = 0;

    regularExpenses.forEach(ex => {
        const letter = letters[expLetterIdx++] || String(expLetterIdx);
        const amt = Number(ex.total) || 0;
        const isAdj = ex.is_adjustment;
        renderDataRow(
            isAdj ? '' : letter,
            isAdj ? `  — ${ex.category_name}` : ex.category_name,
            amt,
            !isAdj,
            'FFFFFFFF',
            isAdj ? 2 : 1
        );
    });

    // Simpanan Expenses (if any)
    if (simpananExpenses.length > 0) {
        const totalSimpananAmt = simpananExpenses.reduce((sum, s) => sum + (Number(s.total) || 0), 0);
        const simpananLetter = letters[expLetterIdx++] || 'H';

        // Parent Row for Simpanan
        renderDataRow(simpananLetter, 'Total Simpanan', totalSimpananAmt, true, 'FFFFFFFF');

        // Sub-items for Simpanan (Soft Peach background #FAEBE5)
        simpananExpenses.forEach((sx, sIdx) => {
            const subCode = `${simpananLetter.toLowerCase()}${sIdx + 1}`;
            const sAmt = Number(sx.total) || 0;
            let sTitle = sx.category_name;
            const wDays = workingDays || 30;
            if (wDays > 0 && sAmt > 0 && !sTitle.includes('@')) {
                const dailyRate = Math.round(sAmt / wDays);
                if (dailyRate * wDays === sAmt || Math.abs(dailyRate * wDays - sAmt) < wDays) {
                    const formattedRate = new Intl.NumberFormat('id-ID', { minimumFractionDigits: 0 }).format(dailyRate);
                    sTitle = `${sx.category_name} ( ${formattedRate} @ ${wDays} Hari )`;
                }
            }
            renderDataRow(subCode, sTitle, sAmt, false, 'FFFAEBE5', 2);
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
                    const sAmt = Number(sh.amount) || 0;
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
    const selisihStok = stokAwalNum - stokAkhirNum;
    renderStokRow('Selisih Nilai Stok', selisihStok, hasStokData);

    // 7. FOOTER / ATTACHMENT STATS
    currentRow++; // Spacer row
    if (data.attachment_stats && data.attachment_stats.total > 0) {
        const stats = data.attachment_stats;
        worksheet.mergeCells(`A${currentRow}:D${currentRow}`);
        const statsCell = worksheet.getCell(`A${currentRow}`);
        statsCell.value = `Total Transaksi: ${stats.total} | Lengkap: ${stats.hijau || 0} | Kurang: ${stats.kuning || 0} | Kosong: ${stats.merah || 0} | Opsional: ${stats.abu || 0}`;
        statsCell.font = { name: fontName, size: 8.5, italic: true, color: { argb: 'FF6B7280' } };
        statsCell.alignment = { horizontal: 'center', vertical: 'middle' };
        currentRow++;
    }

    const now = new Date();
    const formattedDate = now.toLocaleDateString('id-ID', {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        year: 'numeric'
    });
    const formattedTime = now.toLocaleTimeString('id-ID', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
    }).replace('.', ':');

    const printedByText = options.printedBy ? ` oleh ${options.printedBy}` : '';
    worksheet.mergeCells(`A${currentRow}:D${currentRow}`);
    const footerCell = worksheet.getCell(`A${currentRow}`);
    footerCell.value = `Laporan ini dicetak pada ${formattedDate} pukul ${formattedTime}${printedByText}`;
    footerCell.font = { name: fontName, size: 8, italic: true, color: { argb: 'FF9CA3AF' } };
    footerCell.alignment = { horizontal: 'center', vertical: 'middle' };

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
