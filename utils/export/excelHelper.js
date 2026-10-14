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

module.exports = {
    exportToExcel,
    exportCategoryToExcel
};
