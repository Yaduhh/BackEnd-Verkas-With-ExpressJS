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

    // Determine Type / Lampiran Name
    let lampiranType = 'PEMASUKAN';
    if (options.type === 'expense') {
        lampiranType = 'PENGELUARAN';
    } else if (options.type === 'income') {
        lampiranType = 'PEMASUKAN';
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

    const categoryTitle = (options.categoryName || 'SEMUA KATEGORI').toUpperCase();
    const periodText = formatPeriodText(options.fromDate, options.toDate, validData);
    const workingDays = options.workingDays || 25;

    // Calculate total amount
    const totalAmount = validData.reduce((sum, t) => sum + Math.abs(parseFloat(t.net_amount !== undefined ? t.net_amount : t.amount || 0)), 0);

    // Setup Columns
    worksheet.columns = [
        { key: 'tgl', width: 10 },
        { key: 'note', width: 62 },
        { key: 'nominal', width: 26 }
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

    const goldFont = {
        name: 'Calibri',
        size: 11,
        bold: true,
        color: { argb: 'FFFFEE00' }
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

        // Merge A & B for text
        worksheet.mergeCells(`A${r}:B${r}`);
        const textCell = worksheet.getCell(`A${r}`);
        textCell.value = headerRows[r - 1];
        textCell.font = goldFont;
        textCell.alignment = { horizontal: 'left', vertical: 'middle', indent: 1 };

        // Fill Navy for all header cells
        for (let col = 1; col <= 3; col++) {
            worksheet.getRow(r).getCell(col).fill = navyFill;
        }
    }

    // Right Total Box on C4
    const totalCell = worksheet.getCell('C4');
    totalCell.value = totalAmount;
    totalCell.font = { name: 'Calibri', size: 12, bold: true, color: { argb: 'FFFFEE00' } };
    totalCell.alignment = { horizontal: 'right', vertical: 'middle' };
    totalCell.numFmt = '"Rp "#,##0.00';
    totalCell.border = {
        top: { style: 'medium', color: { argb: 'FFFFEE00' } },
        left: { style: 'medium', color: { argb: 'FFFFEE00' } },
        bottom: { style: 'medium', color: { argb: 'FFFFEE00' } },
        right: { style: 'medium', color: { argb: 'FFFFEE00' } }
    };

    // Row 5: Table Header
    const tableHeaderRow = worksheet.getRow(5);
    tableHeaderRow.height = 24;
    tableHeaderRow.values = ['TGL', 'Keterangan', 'Nominal'];

    ['A5', 'B5', 'C5'].forEach((cellRef) => {
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

    // Rows 6+: Data Rows
    let currentRow = 6;
    validData.forEach((item, index) => {
        let dayStr = '-';
        if (item.transaction_date) {
            const dateObj = new Date(item.transaction_date);
            if (!isNaN(dateObj.getTime())) {
                dayStr = String(dateObj.getDate()).padStart(2, '0');
            } else {
                dayStr = String(item.transaction_date).slice(8, 10) || '-';
            }
        }

        const rawNote = item.note || item.category_name || '-';
        const noteText = sanitizeText(rawNote);
        const itemAmt = Math.abs(parseFloat(item.net_amount !== undefined ? item.net_amount : item.amount || 0));

        const isExpense = item.type === 'expense' || (lampiranType === 'PENGELUARAN' && !item.type);
        const softBg = isExpense ? 'FFFDECEB' : 'FFEEF4E8';
        const rowBgColor = index % 2 === 0 ? softBg : 'FFFFFFFF';

        const row = worksheet.getRow(currentRow);
        row.height = 22;

        const cellA = row.getCell(1);
        cellA.value = dayStr;
        cellA.alignment = { horizontal: 'center', vertical: 'middle' };
        cellA.font = { name: 'Calibri', size: 10, color: { argb: 'FF000000' } };

        const cellB = row.getCell(2);
        cellB.value = noteText;
        cellB.alignment = { horizontal: 'left', vertical: 'middle', wrapText: true };
        cellB.font = { name: 'Calibri', size: 10, color: { argb: 'FF000000' } };

        const cellC = row.getCell(3);
        cellC.value = itemAmt;
        cellC.alignment = { horizontal: 'right', vertical: 'middle' };
        cellC.font = { name: 'Calibri', size: 10, color: { argb: 'FF000000' } };
        cellC.numFmt = '"Rp "#,##0.00';

        // Apply row background and borders to all 3 cells
        for (let col = 1; col <= 3; col++) {
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

    // Ensure output filepath
    const filepath = path.join(EXPORTS_DIR, filename);
    await workbook.xlsx.writeFile(filepath);

    return filepath;
}

module.exports = {
    exportToExcel,
    exportCategoryToExcel
};
