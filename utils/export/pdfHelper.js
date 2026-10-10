const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');
const { EXPORTS_DIR, formatCurrency, getMonthName } = require('./commonHelper');

// Export to PDF (Professional Format)
async function exportToPDF(data, filename, title) {
    const filepath = path.join(EXPORTS_DIR, filename);
    const doc = new PDFDocument({
        margin: 50,
        size: 'A4',
        info: {
            Title: title || 'Laporan Keuangan',
            Author: 'VERKAS',
            Subject: 'Laporan Keuangan',
            Creator: 'VERKAS Financial App'
        }
    });

    doc.pipe(fs.createWriteStream(filepath));

    const pageWidth = doc.page.width;
    const margin = 50;
    const contentWidth = pageWidth - 2 * margin;
    let y = margin;

    // Helper to check if new page needed
    const checkNewPage = (requiredHeight) => {
        if (y + requiredHeight > doc.page.height - 50) {
            doc.addPage();
            y = margin;
            return true;
        }
        return false;
    };

    // Header Section - Professional Design
    doc.fillColor('#1e3a8a').fontSize(24).font('Helvetica-Bold');
    doc.text(title || 'Laporan Keuangan', margin, y, { align: 'left', width: contentWidth });
    y += 35;

    // Date range info (if available from data)
    const firstDate = data.length > 0 ? data[data.length - 1].transaction_date : '';
    const lastDate = data.length > 0 ? data[0].transaction_date : '';
    if (firstDate && lastDate) {
        doc.fillColor('#666666').fontSize(10).font('Helvetica');
        doc.text(`Periode: ${firstDate} - ${lastDate}`, margin, y, { align: 'left', width: contentWidth });
        y += 20;
    }

    // Summary Section
    const totalIncome = data.filter(t => t.type === 'income').reduce((sum, t) => sum + parseFloat(t.amount || 0), 0);
    const totalExpense = data.filter(t => t.type === 'expense').reduce((sum, t) => sum + parseFloat(t.amount || 0), 0);
    const netAmount = totalIncome - totalExpense;

    checkNewPage(60);

    // Summary Box
    doc.roundedRect(margin, y, contentWidth, 50, 5)
        .fillColor('#f8f9fa')
        .fill()
        .fillColor('#000000');

    y += 10;
    doc.fontSize(9).font('Helvetica-Bold').fillColor('#666666');
    doc.text('RINGKASAN', margin + 10, y);
    y += 15;

    doc.fontSize(10).font('Helvetica');
    doc.fillColor('#10b981');
    doc.text(`Total Pemasukan: ${formatCurrency(totalIncome)}`, margin + 10, y, { width: contentWidth / 2 - 10 });
    doc.fillColor('#ef4444');
    doc.text(`Total Pengeluaran: ${formatCurrency(totalExpense)}`, margin + contentWidth / 2, y, { width: contentWidth / 2 - 10 });
    y += 15;

    doc.fillColor(netAmount >= 0 ? '#10b981' : '#ef4444').font('Helvetica-Bold');
    doc.text(`Saldo Bersih: ${formatCurrency(netAmount)}`, margin + 10, y);
    y += 30;

    // Table Header - Professional Styling
    checkNewPage(30);

    const tableTop = y;
    const itemHeight = 25;
    const headerHeight = 30;

    const colWidths = {
        date: contentWidth * 0.15,
        category: contentWidth * 0.25,
        type: contentWidth * 0.12,
        amount: contentWidth * 0.23,
        note: contentWidth * 0.25
    };

    // Header Background
    doc.roundedRect(margin, tableTop, contentWidth, headerHeight, 3)
        .fillColor('#1e3a8a')
        .fill();

    // Header Text
    doc.fillColor('#ffffff').fontSize(10).font('Helvetica-Bold');
    doc.text('Tanggal', margin + 5, tableTop + 8, { width: colWidths.date - 10 });
    doc.text('Kategori', margin + colWidths.date + 5, tableTop + 8, { width: colWidths.category - 10 });
    doc.text('Tipe', margin + colWidths.date + colWidths.category + 5, tableTop + 8, { width: colWidths.type - 10 });
    doc.text('Jumlah', margin + colWidths.date + colWidths.category + colWidths.type + 5, tableTop + 8, { width: colWidths.amount - 10 });
    doc.text('Keterangan', margin + colWidths.date + colWidths.category + colWidths.type + colWidths.amount + 5, tableTop + 8, { width: colWidths.note - 10 });

    y = tableTop + headerHeight;

    // Data Rows - Alternating Colors
    doc.font('Helvetica').fontSize(9).fillColor('#000000');

    data.forEach((item, index) => {
        checkNewPage(itemHeight + 5);

        // Alternating row background
        if (index % 2 === 0) {
            doc.rect(margin, y, contentWidth, itemHeight)
                .fillColor('#f8f9fa')
                .fill();
        }

        // Row border
        doc.strokeColor('#e5e7eb')
            .lineWidth(0.5)
            .moveTo(margin, y)
            .lineTo(margin + contentWidth, y)
            .stroke();

        // Data cells
        const rowY = y + 7;
        doc.fillColor('#000000');
        doc.text(item.transaction_date || '', margin + 5, rowY, { width: colWidths.date - 10 });
        doc.text(item.category_name || '', margin + colWidths.date + 5, rowY, { width: colWidths.category - 10 });

        // Type with color
        const typeText = item.type === 'income' ? 'Pemasukan' : 'Pengeluaran';
        doc.fillColor(item.type === 'income' ? '#10b981' : '#ef4444');
        doc.text(typeText, margin + colWidths.date + colWidths.category + 5, rowY, { width: colWidths.type - 10 });

        // Amount with color and formatting
        doc.fillColor(item.type === 'income' ? '#10b981' : '#ef4444');
        doc.text(formatCurrency(parseFloat(item.amount || 0)), margin + colWidths.date + colWidths.category + colWidths.type + 5, rowY, { width: colWidths.amount - 10 });

        doc.fillColor('#000000');
        doc.text(item.note || '-', margin + colWidths.date + colWidths.category + colWidths.type + colWidths.amount + 5, rowY, { width: colWidths.note - 10 });

        y += itemHeight;
    });

    // Footer
    const footerY = doc.page.height - 40;
    doc.fillColor('#999999').fontSize(8).font('Helvetica');
    doc.text(
        `Dibuat pada: ${new Date().toLocaleString('id-ID', {
            day: '2-digit',
            month: 'long',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        })} | Total Transaksi: ${data.length}`,
        margin,
        footerY,
        { align: 'center', width: contentWidth }
    );

    doc.end();

    return new Promise((resolve, reject) => {
        doc.on('end', () => resolve(filepath));
        doc.on('error', reject);
    });
}

// Export BukuKas to PDF
async function exportBukuKasToPDF(reportData, filename, branchName, selectedMonth, options = {}) {
    const filepath = path.join(EXPORTS_DIR, filename);
    const doc = new PDFDocument({
        margin: 40,
        size: 'A4',
        info: {
            Title: options.title || 'Kesimpulan Kas',
            Author: 'VERKAS',
            Subject: 'Laporan Keuangan',
            Creator: 'VERKAS Financial App'
        }
    });

    doc.pipe(fs.createWriteStream(filepath));

    const pageWidth = doc.page.width;
    const margin = 40;
    const contentWidth = pageWidth - 2 * margin;
    let y = margin;

    // Helper function to check if need new page
    const checkNewPage = (requiredHeight) => {
        if (y + requiredHeight > doc.page.height - 40) {
            doc.addPage();
            y = margin;
            return true;
        }
        return false;
    };

    const calculateFormatDateRange = () => {
        if (options.fromDate && options.toDate) {
            const from = new Date(options.fromDate);
            const to = new Date(options.toDate);
            const fromStr = `${String(from.getDate()).padStart(2, '0')} ${getMonthName(from.getMonth())} ${from.getFullYear()}`;
            const toStr = `${String(to.getDate()).padStart(2, '0')} ${getMonthName(to.getMonth())} ${to.getFullYear()}`;
            return `${fromStr} - ${toStr}`;
        }
        const month = selectedMonth.getMonth();
        const year = selectedMonth.getFullYear();
        const daysInMonth = new Date(year, month + 1, 0).getDate();
        return `01 - ${String(daysInMonth).padStart(2, '0')} ${getMonthName(month)} ${year}`;
    };

    const getDaysInMonth = () => {
        if (options.fromDate && options.toDate) {
            return Math.ceil((new Date(options.toDate) - new Date(options.fromDate)) / (1000 * 60 * 60 * 24)) + 1;
        }
        const month = selectedMonth.getMonth();
        const year = selectedMonth.getFullYear();
        return new Date(year, month + 1, 0).getDate();
    };

    const formatPercentage = (value) => `${value.toFixed(2)}%`;

    // Try to register Poppins font
    let fontRegular = 'Helvetica';
    let fontBold = 'Helvetica-Bold';
    let fontMedium = 'Helvetica-Bold';

    const fontsDir = path.join(__dirname, '../fonts');
    const poppinsRegular = path.join(fontsDir, 'Poppins-Regular.ttf');
    const poppinsBold = path.join(fontsDir, 'Poppins-Bold.ttf');
    const poppinsMedium = path.join(fontsDir, 'Poppins-Medium.ttf');

    if (fs.existsSync(poppinsRegular)) {
        doc.registerFont('Poppins', poppinsRegular);
        fontRegular = 'Poppins';
    }
    if (fs.existsSync(poppinsBold)) {
        doc.registerFont('Poppins-Bold', poppinsBold);
        fontBold = 'Poppins-Bold';
    }
    if (fs.existsSync(poppinsMedium)) {
        doc.registerFont('Poppins-Medium', poppinsMedium);
        fontMedium = 'Poppins-Medium';
    }

    // ===== HEADER SECTION =====
    doc.fillColor('#000000').fontSize(20).font(fontBold);
    doc.text('LAPORAN KEUANGAN', margin, y, { align: 'center', width: contentWidth });
    y += 24;

    doc.fontSize(13).font(fontRegular).fillColor('#000000');
    doc.text(branchName.toUpperCase(), margin, y, { align: 'center', width: contentWidth });
    y += 18;

    doc.fontSize(9).font(fontRegular).fillColor('#666666');
    doc.text(calculateFormatDateRange(), margin, y, { align: 'center', width: contentWidth });
    y += 12;
    doc.text(`${getDaysInMonth()} Hari Kerja`, margin, y, { align: 'center', width: contentWidth });
    y += 28;

    // ===== OMZET SECTION =====
    checkNewPage(150);
    doc.fillColor('#000000').fontSize(12).font(fontBold);
    doc.text('OMZET', margin, y);
    y += 18;

    const omzetBoxY = y;
    doc.rect(margin, omzetBoxY, contentWidth, 36).fillColor('#f8f9fa').fill();
    doc.strokeColor('#e5e7eb').lineWidth(1).rect(margin, omzetBoxY, contentWidth, 36).stroke();
    doc.fontSize(11).font(fontMedium).fillColor('#666666').text('Total Omzet', margin + 12, omzetBoxY + 10);
    doc.font(fontBold).fontSize(16).fillColor('#000000').text(formatCurrency(reportData.omzet.total), margin + 12, omzetBoxY + 10, { align: 'right', width: contentWidth - 24 });
    y = omzetBoxY + 44;

    if (reportData.omzet.salesChannel.length > 0) {
        doc.fontSize(10).font(fontMedium).fillColor('#000000').text('Sales Channel', margin, y);
        y += 16;
        const col1Width = contentWidth * 0.60;
        const col2Width = contentWidth * 0.25;
        const col3Width = contentWidth * 0.15;

        reportData.omzet.salesChannel.forEach((channel, index) => {
            checkNewPage(22);
            const rowY = y;
            if (index > 0) {
                doc.strokeColor('#f0f0f0').lineWidth(0.5).moveTo(margin + 8, rowY - 2).lineTo(pageWidth - margin - 8, rowY - 2).stroke();
            }
            doc.fontSize(10).font(fontRegular).fillColor('#000000').text(channel.name, margin + 8, rowY, { width: col1Width - 8 });
            doc.font(fontMedium).fontSize(10).text(formatCurrency(channel.amount), margin + col1Width, rowY, { width: col2Width, align: 'right' });
            doc.fontSize(9).font(fontRegular).fillColor('#666666').text(formatPercentage(channel.percentage), margin + col1Width + col2Width, rowY, { width: col3Width, align: 'right' });
            y += 20;
        });
        y += 12;
    }
    y += 24;

    // ===== PENGELUARAN SECTION =====
    checkNewPage(150);
    doc.fillColor('#000000').fontSize(12).font(fontBold).text('PENGELUARAN', margin, y);
    y += 18;

    const pengeluaranBoxY = y;
    doc.rect(margin, pengeluaranBoxY, contentWidth, 36).fillColor('#fef2f2').fill();
    doc.strokeColor('#fee2e2').lineWidth(1).rect(margin, pengeluaranBoxY, contentWidth, 36).stroke();
    doc.fontSize(11).font(fontMedium).fillColor('#666666').text('Total Pengeluaran', margin + 12, pengeluaranBoxY + 10);
    doc.font(fontBold).fontSize(16).fillColor('#000000').text(formatCurrency(reportData.pengeluaran.total), margin + 12, pengeluaranBoxY + 10, { align: 'right', width: contentWidth - 24 });
    y = pengeluaranBoxY + 44;

    if (reportData.pengeluaran.breakdown.length > 0) {
        const col1Width = contentWidth * 0.60;
        const col2Width = contentWidth * 0.25;
        const col3Width = contentWidth * 0.15;

        reportData.pengeluaran.breakdown.forEach((item, index) => {
            checkNewPage(22);
            const rowY = y;
            if (index > 0) {
                doc.strokeColor('#f0f0f0').lineWidth(0.5).moveTo(margin + 8, rowY - 2).lineTo(pageWidth - margin - 8, rowY - 2).stroke();
            }
            doc.fontSize(10).font(fontRegular).fillColor('#000000').text(item.name, margin + 8, rowY, { width: col1Width - 8 });
            doc.font(fontMedium).fontSize(10).text(formatCurrency(item.amount), margin + col1Width, rowY, { width: col2Width, align: 'right' });
            doc.fontSize(9).font(fontRegular).fillColor('#666666').text(formatPercentage(item.percentage), margin + col1Width + col2Width, rowY, { width: col3Width, align: 'right' });
            y += 20;
        });
        y += 12;
    }
    y += 24;

    // ===== PROFIT SECTION =====
    checkNewPage(80);
    const profitBoxY = y;
    const profitBgColor = reportData.profit < 0 ? '#fef2f2' : '#f0fdf4';
    const profitBorderColor = reportData.profit < 0 ? '#fee2e2' : '#dcfce7';
    const profitTextColor = reportData.profit < 0 ? '#dc2626' : '#16a34a';

    doc.rect(margin, profitBoxY, contentWidth, 36).fillColor(profitBgColor).fill();
    doc.strokeColor(profitBorderColor).lineWidth(1.5).rect(margin, profitBoxY, contentWidth, 36).stroke();
    doc.fontSize(11).font(fontMedium).fillColor('#666666').text('PROFIT', margin + 12, profitBoxY + 10);
    doc.font(fontBold).fontSize(16).fillColor(profitTextColor).text(formatCurrency(reportData.profit), margin + 12, profitBoxY + 10, { align: 'right', width: contentWidth - 24 });
    y = profitBoxY + 44;

    // ===== BAGI HASIL SECTION =====
    checkNewPage(120);
    doc.fillColor('#000000').fontSize(12).font(fontBold).text('PEMBAGIAN HASIL', margin, y);
    y += 22;

    const rowH = 32;
    const drawBagiHasil = (label, amount) => {
        checkNewPage(rowH + 5);
        const boxY = y;
        doc.rect(margin, boxY, contentWidth, rowH).fillColor('#f8f9fa').fill();
        doc.strokeColor('#e5e7eb').lineWidth(1).rect(margin, boxY, contentWidth, rowH).stroke();
        doc.fontSize(10).font(fontRegular).fillColor('#666666').text(label, margin + 12, boxY + 8);
        doc.font(fontBold).fontSize(15).fillColor('#000000').text(formatCurrency(amount), margin + 12, boxY + 8, { align: 'right', width: contentWidth - 24 });
        y += rowH + 8;
    };

    drawBagiHasil('Pusat (30%)', reportData.bagiHasil.pusat);
    drawBagiHasil('Mitra (70%)', reportData.bagiHasil.mitra);

    // ===== FOOTER =====
    const footerY = doc.page.height - 30;
    doc.fillColor('#999999').fontSize(8).font(fontRegular).text(`Dibuat pada: ${new Date().toLocaleString('id-ID')}`, margin, footerY, { align: 'center', width: contentWidth });

    doc.end();
    return new Promise((resolve, reject) => {
        doc.on('end', () => resolve(filepath));
        doc.on('error', reject);
    });
}

// Export Category to PDF (Visual Report matching reference template with thin printable margin)
function sanitizePDFText(text) {
    if (!text) return '-';
    const clean = String(text)
        .replace(/\r\n/g, '\n')
        .replace(/\r/g, '\n')
        .replace(/\t/g, '   ') // Replace tab with spaces so it does not render as corrupted glyphs
        .replace(/[\u2018\u2019]/g, "'") // Smart single quotes
        .replace(/[\u201C\u201D]/g, '"') // Smart double quotes
        .replace(/\u00A0/g, ' ') // Non-breaking space
        .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, ''); // Control characters except \n
    return clean.trim();
}

async function exportCategoryToPDF(data, filename, branchName, options = {}) {
    const filepath = path.join(EXPORTS_DIR, filename);
    const margin = 18; // Thin printable margin (approx 6.35mm / 0.25 in)
    const doc = new PDFDocument({
        margin: margin,
        size: 'A4',
        info: {
            Title: options.title || `Laporan ${options.categoryName || 'Kategori'}`,
            Author: 'VERKAS',
            Subject: 'Laporan Kategori',
            Creator: 'VERKAS Financial App'
        }
    });

    const writeStream = fs.createWriteStream(filepath);
    doc.pipe(writeStream);

    // Filter out zero amount transactions
    const validData = (data || []).filter(item => {
        const val = Math.abs(parseFloat(item.net_amount !== undefined ? item.net_amount : item.amount || 0));
        return val > 0.001;
    });

    const pageWidth = doc.page.width;
    const pageHeight = doc.page.height;
    const contentWidth = pageWidth - 2 * margin;
    let y = margin;

    const fontBold = 'Helvetica-Bold';
    const fontRegular = 'Helvetica';

    const INDONESIAN_MONTHS = [
        'JANUARI', 'FEBRUARI', 'MARET', 'APRIL', 'MEI', 'JUNI',
        'JULI', 'AGUSTUS', 'SEPTEMBER', 'OKTOBER', 'NOVEMBER', 'DESEMBER'
    ];

    const formatPeriodText = (fromDate, toDate, items) => {
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
    };

    const formatIndoNominal = (num) => {
        const val = Math.abs(Number(num) || 0);
        return new Intl.NumberFormat('id-ID', {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2
        }).format(val);
    };

    const formatIndoHeaderTotal = (num) => {
        const val = Math.abs(Number(num) || 0);
        return Number.isInteger(val)
            ? new Intl.NumberFormat('id-ID', { minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(val)
            : new Intl.NumberFormat('id-ID', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(val);
    };

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
    const workingDays = options.workingDays || 26;

    // Calculate total amount
    const totalAmount = validData.reduce((sum, t) => sum + Math.abs(parseFloat(t.net_amount !== undefined ? t.net_amount : t.amount || 0)), 0);

    // Column Widths
    const colWidths = {
        tgl: 52,
        nominal: 145,
        note: contentWidth - 52 - 145
    };

    // Header dimensions
    const headerHeight = 98;
    const headerBg = '#001b54'; // Deep navy blue
    const headerTextColor = '#FFEE00'; // Bright gold yellow

    // 1. Draw Navy Header Container
    doc.rect(margin, y, contentWidth, headerHeight).fillColor(headerBg).fill();

    // Top subtle accent bar based on lampiran type
    const accentBarColor = lampiranType === 'PENGELUARAN' ? '#991b1b' : (lampiranType === 'PEMASUKAN' ? '#004b23' : '#1e3a8a');
    doc.rect(margin, y, contentWidth, 2.5).fillColor(accentBarColor).fill();

    // 2. Left side Header Texts (Exact vertical line spacing)
    doc.fillColor(headerTextColor).font(fontBold).fontSize(11);
    const leftPadding = margin + 12;
    doc.text(`NAMA LAMPIRAN : ${lampiranType}`, leftPadding, y + 12);
    doc.text(`NAMA KATEGORI : ${categoryTitle}`, leftPadding, y + 33);
    doc.text(`TANGGAL : ${periodText}`, leftPadding, y + 54);
    doc.text(`BUKA : ${workingDays} HARI`, leftPadding, y + 75);

    // 3. Right side Total Box (Seamlessly aligned with Nominal column)
    const totalBoxX = margin + contentWidth - colWidths.nominal;
    const totalBoxY = y + 66;
    const totalBoxWidth = colWidths.nominal;
    const totalBoxHeight = headerHeight - 66;

    // Draw total box border with yellow
    doc.rect(totalBoxX, totalBoxY, totalBoxWidth, totalBoxHeight)
        .strokeColor(headerTextColor)
        .lineWidth(1.2)
        .stroke();

    doc.font(fontBold).fontSize(12).fillColor(headerTextColor).text('Rp', totalBoxX + 8, totalBoxY + 9);
    doc.font(fontBold).fontSize(13).fillColor(headerTextColor).text(
        formatIndoHeaderTotal(totalAmount),
        totalBoxX + 32,
        totalBoxY + 8,
        { width: totalBoxWidth - 40, align: 'right' }
    );

    y += headerHeight;

    const tableHeaderHeight = 25;

    // Function to draw Table Header
    const drawTableHeader = (curY) => {
        // Background
        doc.rect(margin, curY, contentWidth, tableHeaderHeight).fillColor('#FFFFFF').fill();

        // Border around header
        doc.strokeColor('#000000').lineWidth(0.8).rect(margin, curY, contentWidth, tableHeaderHeight).stroke();

        // Column Dividers
        doc.moveTo(margin + colWidths.tgl, curY).lineTo(margin + colWidths.tgl, curY + tableHeaderHeight).stroke();
        doc.moveTo(margin + colWidths.tgl + colWidths.note, curY).lineTo(margin + colWidths.tgl + colWidths.note, curY + tableHeaderHeight).stroke();

        // Header Texts
        doc.fillColor('#000000').font(fontBold).fontSize(10);
        doc.text('TGL', margin, curY + 7.5, { width: colWidths.tgl, align: 'center' });
        doc.text('Keterangan', margin + colWidths.tgl, curY + 7.5, { width: colWidths.note, align: 'center' });
        doc.text('Nominal', margin + colWidths.tgl + colWidths.note, curY + 7.5, { width: colWidths.nominal, align: 'center' });

        return curY + tableHeaderHeight;
    };

    y = drawTableHeader(y);

    // Function to check page overflow
    const checkNewPage = (requiredHeight) => {
        if (y + requiredHeight > pageHeight - margin - 15) {
            doc.addPage({ margin: margin, size: 'A4' });
            y = margin;
            y = drawTableHeader(y);
            return true;
        }
        return false;
    };

    // Draw Data Rows
    validData.forEach((item, index) => {
        // Parse date for Day display
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
        const noteText = sanitizePDFText(rawNote);
        const itemAmt = Math.abs(parseFloat(item.net_amount !== undefined ? item.net_amount : item.amount || 0));
        const formattedAmount = formatIndoNominal(itemAmt);

        // Measure note height
        doc.font(fontRegular).fontSize(9.5);
        const noteTextHeight = doc.heightOfString(noteText, { width: colWidths.note - 16 });
        const rowHeight = Math.max(23, noteTextHeight + 9);

        checkNewPage(rowHeight);

        // Determine item type: expense vs income
        const isExpense = item.type === 'expense' || (lampiranType === 'PENGELUARAN' && !item.type);

        // Dynamic alternating row colors:
        // Expense: Soft Red (#FDECEB) & White (#FFFFFF)
        // Income: Soft Green (#EEF4E8) & White (#FFFFFF)
        const softBg = isExpense ? '#FDECEB' : '#EEF4E8';
        const rowBg = index % 2 === 0 ? softBg : '#FFFFFF';

        doc.rect(margin, y, contentWidth, rowHeight).fillColor(rowBg).fill();

        // Cell borders (full grid lines)
        doc.strokeColor('#000000').lineWidth(0.5);
        doc.rect(margin, y, contentWidth, rowHeight).stroke();
        doc.moveTo(margin + colWidths.tgl, y).lineTo(margin + colWidths.tgl, y + rowHeight).stroke();
        doc.moveTo(margin + colWidths.tgl + colWidths.note, y).lineTo(margin + colWidths.tgl + colWidths.note, y + rowHeight).stroke();

        // Row Text
        const textPaddingY = y + (rowHeight - 9.5) / 2;

        // TGL
        doc.fillColor('#000000').font(fontRegular).fontSize(9.5).text(
            dayStr,
            margin,
            textPaddingY,
            { width: colWidths.tgl, align: 'center' }
        );

        // Keterangan
        doc.fillColor('#000000').font(fontRegular).fontSize(9.5).text(
            noteText,
            margin + colWidths.tgl + 8,
            y + 4.5,
            { width: colWidths.note - 16, align: 'left' }
        );

        // Nominal (Split Rp on left, Amount on right)
        doc.fillColor('#000000').font(fontRegular).fontSize(9.5).text(
            'Rp',
            margin + colWidths.tgl + colWidths.note + 8,
            textPaddingY
        );
        doc.fillColor('#000000').font(fontRegular).fontSize(9.5).text(
            formattedAmount,
            margin + colWidths.tgl + colWidths.note + 26,
            textPaddingY,
            { width: colWidths.nominal - 34, align: 'right' }
        );

        y += rowHeight;
    });

    doc.end();

    return new Promise((resolve, reject) => {
        writeStream.on('finish', () => resolve(filepath));
        writeStream.on('error', reject);
        doc.on('error', reject);
    });
}

// Export Detailed Branch Financial Report to PDF
async function exportFinancialReportToPDF(data, filename, branchName, selectedMonth, workingDays, options = {}) {
    const filepath = path.join(EXPORTS_DIR, filename);
    const doc = new PDFDocument({
        margin: 30,
        size: 'A4',
        info: {
            Title: `Laporan Keuangan ${branchName}`,
            Author: 'VERKAS'
        }
    });

    const writeStream = fs.createWriteStream(filepath);
    doc.pipe(writeStream);
    const pageWidth = doc.page.width; // 595.28
    const margin = 30;
    const contentWidth = pageWidth - 2 * margin; // 535.28
    let y = margin;

    const fontBold = 'Helvetica-Bold';
    const fontRegular = 'Helvetica';

    const checkNewPage = (h) => {
        if (y + h > doc.page.height - 35) {
            doc.addPage();
            y = margin;
            return true;
        }
        return false;
    };

    const formatCurrencyForPDF = (amount) => {
        if (amount === null || amount === undefined || isNaN(amount)) return '-';
        return new Intl.NumberFormat('id-ID', { minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(amount);
    };

    const formatPercent = (val, base) => {
        if (!base || base === 0 || !val) return '0,00%';
        const p = (val / base * 100).toFixed(2);
        return p.replace('.', ',') + '%';
    };

    // Column dimensions for table layout
    const wNo = 34;
    const wName = 286.28;
    const wAmount = 140;
    const wPerc = 75;

    const drawCell = (x, currentY, width, height, cellOpts = {}) => {
        const {
            bg = null,
            border = '#000000',
            borderWidth = 0.5,
            text = '',
            font = fontRegular,
            fontSize = 8.5,
            textColor = '#000000',
            align = 'left',
            paddingLeft = 5,
            paddingRight = 5,
            rpPrefix = false,
            rpAmount = ''
        } = cellOpts;

        if (bg) {
            doc.rect(x, currentY, width, height).fillColor(bg).fill();
        }
        if (border) {
            doc.rect(x, currentY, width, height).lineWidth(borderWidth).strokeColor(border).stroke();
        }

        const textY = currentY + (height - fontSize) / 2 - 0.5;

        if (rpPrefix) {
            doc.font(font).fontSize(fontSize).fillColor(textColor);
            doc.text('Rp', x + paddingLeft, textY, { width: 22, align: 'left', lineBreak: false });
            doc.text(String(rpAmount), x + 22, textY, { width: width - 22 - paddingRight, align: 'right', lineBreak: false });
        } else if (text !== undefined && text !== null && text !== '') {
            doc.font(font).fontSize(fontSize).fillColor(textColor);
            const textWidth = width - paddingLeft - paddingRight;
            doc.text(String(text), x + paddingLeft, textY, { width: textWidth, align: align, lineBreak: false });
        }
    };

    // 1. TOP HEADER BANNER (Dark Navy Blue with Gold/Yellow Text)
    const headerHeight = 52;
    doc.rect(margin, y, contentWidth, headerHeight).fillColor('#0a1c58').fill();
    doc.rect(margin, y, contentWidth, headerHeight).lineWidth(0.5).strokeColor('#000000').stroke();

    // Center Title: LAP. KEU and BRANCH NAME
    doc.font(fontBold).fontSize(14).fillColor('#ffff00');
    doc.text('LAP. KEU', margin, y + 10, { width: contentWidth, align: 'center' });
    doc.text(branchName.toUpperCase(), margin, y + 28, { width: contentWidth, align: 'center' });

    // Right Info: Month and Working Days
    const monthShortNames = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
    const mShort = monthShortNames[selectedMonth.getMonth()] || 'Bln';
    const yShort = String(selectedMonth.getFullYear()).slice(-2);
    const dateLabel = `${mShort} ${yShort}`;
    const openDaysLabel = `Buka : ${workingDays || 30} Hari`;

    doc.font(fontBold).fontSize(11).fillColor('#ffff00');
    doc.text(dateLabel, margin + contentWidth - 170, y + 12, { width: 155, align: 'right' });
    doc.text(openDaysLabel, margin + contentWidth - 170, y + 29, { width: 155, align: 'right' });

    y += headerHeight;

    // 2. PEMASUKAN SECTION
    const totalPemasukanFinal = Number(data.omzet_total) || 0;

    // Header bar (Forest Green)
    const pemHeaderH = 22;
    drawCell(margin, y, wNo + wName, pemHeaderH, {
        bg: '#257942',
        text: 'PEMASUKAN',
        font: fontBold,
        fontSize: 9.5,
        textColor: '#ffffff',
        paddingLeft: 8
    });
    drawCell(margin + wNo + wName, y, wAmount, pemHeaderH, {
        bg: '#257942',
        rpPrefix: true,
        rpAmount: formatCurrencyForPDF(totalPemasukanFinal),
        font: fontBold,
        fontSize: 9.5,
        textColor: '#ffffff'
    });
    drawCell(margin + wNo + wName + wAmount, y, wPerc, pemHeaderH, {
        bg: '#257942',
        text: '100%',
        font: fontBold,
        fontSize: 9.5,
        textColor: '#ffffff',
        align: 'center'
    });
    y += pemHeaderH;

    // Subheader
    const subHeaderH = 18;
    drawCell(margin, y, wNo, subHeaderH, { bg: '#ffffff', text: 'No', font: fontBold, fontSize: 8.5, align: 'center' });
    drawCell(margin + wNo, y, wName, subHeaderH, { bg: '#ffffff', text: 'Sales Channel', font: fontBold, fontSize: 8.5, align: 'center' });
    drawCell(margin + wNo + wName, y, wAmount, subHeaderH, { bg: '#ffffff', text: 'Jumlah', font: fontBold, fontSize: 8.5, align: 'center' });
    drawCell(margin + wNo + wName + wAmount, y, wPerc, subHeaderH, { bg: '#ffffff', text: 'Persentase', font: fontBold, fontSize: 8.5, align: 'center' });
    y += subHeaderH;

    // Pemasukan Items
    const rowH = 18;
    let pemIdx = 1;

    // A) Sales channels
    (data.sales_channels || []).forEach((sc) => {
        checkNewPage(rowH);
        let scName = sc.name;
        if (!scName.toLowerCase().startsWith('omzet') && !scName.toLowerCase().startsWith('omset') && !scName.toLowerCase().startsWith('pendapatan')) {
            scName = `Omzet ${sc.name}`;
        }
        const amt = Number(sc.amount) || 0;
        const percStr = formatPercent(amt, totalPemasukanFinal);

        drawCell(margin, y, wNo, rowH, { bg: '#ffffff', text: `${pemIdx++}`, font: fontBold, fontSize: 8.5, align: 'center' });
        drawCell(margin + wNo, y, wName, rowH, { bg: '#ffffff', text: scName, font: fontBold, fontSize: 8.5, paddingLeft: 8 });
        drawCell(margin + wNo + wName, y, wAmount, rowH, { bg: '#ffffff', rpPrefix: true, rpAmount: formatCurrencyForPDF(amt), font: fontBold, fontSize: 8.5 });
        drawCell(margin + wNo + wName + wAmount, y, wPerc, rowH, { bg: '#ffffff', text: percStr, font: fontBold, fontSize: 8.5, align: 'center' });
        y += rowH;
    });

    // B) Other Income Categories (Lain-lain or other categories that are not the main Omzet)
    const otherIncomes = (data.income_breakdown || []).filter(it => {
        const n = (it.category_name || '').toLowerCase();
        return n.includes('lain') || (!n.includes('omzet') && !n.includes('omset'));
    });
    otherIncomes.forEach(it => {
        checkNewPage(rowH);
        const amt = Number(it.total) || 0;
        const percStr = formatPercent(amt, totalPemasukanFinal);

        drawCell(margin, y, wNo, rowH, { bg: '#ffffff', text: `${pemIdx++}`, font: fontBold, fontSize: 8.5, align: 'center' });
        drawCell(margin + wNo, y, wName, rowH, { bg: '#ffffff', text: it.category_name, font: fontBold, fontSize: 8.5, paddingLeft: 8 });
        drawCell(margin + wNo + wName, y, wAmount, rowH, { bg: '#ffffff', rpPrefix: true, rpAmount: formatCurrencyForPDF(amt), font: fontBold, fontSize: 8.5 });
        drawCell(margin + wNo + wName + wAmount, y, wPerc, rowH, { bg: '#ffffff', text: percStr, font: fontBold, fontSize: 8.5, align: 'center' });
        y += rowH;
    });

    // C) Pelunasan Piutang Bulan Lalu (if any)
    if (data.pelunasan_piutang_bulan_lalu && Number(data.pelunasan_piutang_bulan_lalu) > 0) {
        checkNewPage(rowH);
        const amt = Number(data.pelunasan_piutang_bulan_lalu);
        const percStr = formatPercent(amt, totalPemasukanFinal);
        const label = `Pelunasan Piutang ${data.prev_month_label || 'Bulan Lalu'}`;

        drawCell(margin, y, wNo, rowH, { bg: '#ffffff', text: `${pemIdx++}`, font: fontBold, fontSize: 8.5, align: 'center' });
        drawCell(margin + wNo, y, wName, rowH, { bg: '#ffffff', text: label, font: fontBold, fontSize: 8.5, paddingLeft: 8 });
        drawCell(margin + wNo + wName, y, wAmount, rowH, { bg: '#ffffff', rpPrefix: true, rpAmount: formatCurrencyForPDF(amt), font: fontBold, fontSize: 8.5 });
        drawCell(margin + wNo + wName + wAmount, y, wPerc, rowH, { bg: '#ffffff', text: percStr, font: fontBold, fontSize: 8.5, align: 'center' });
        y += rowH;
    }

    // 3. PENGELUARAN SECTION
    const totalPengeluaran = Number(data.pengeluaran_total) || 0;
    const totalExpPerc = formatPercent(totalPengeluaran, totalPemasukanFinal);

    // Header bar (Red)
    const pengHeaderH = 22;
    drawCell(margin, y, wNo + wName, pengHeaderH, {
        bg: '#e60000',
        text: 'PENGELUARAN',
        font: fontBold,
        fontSize: 9.5,
        textColor: '#ffffff',
        paddingLeft: 8
    });
    drawCell(margin + wNo + wName, y, wAmount, pengHeaderH, {
        bg: '#e60000',
        rpPrefix: true,
        rpAmount: formatCurrencyForPDF(totalPengeluaran),
        font: fontBold,
        fontSize: 9.5,
        textColor: '#ffffff'
    });
    drawCell(margin + wNo + wName + wAmount, y, wPerc, pengHeaderH, {
        bg: '#e60000',
        text: totalExpPerc,
        font: fontBold,
        fontSize: 9.5,
        textColor: '#ffffff',
        align: 'center'
    });
    y += pengHeaderH;

    // Subheader
    drawCell(margin, y, wNo, subHeaderH, { bg: '#ffffff', text: 'No', font: fontBold, fontSize: 8.5, align: 'center' });
    drawCell(margin + wNo, y, wName, subHeaderH, { bg: '#ffffff', text: 'Uraian', font: fontBold, fontSize: 8.5, align: 'center' });
    drawCell(margin + wNo + wName, y, wAmount, subHeaderH, { bg: '#ffffff', text: 'Jumlah', font: fontBold, fontSize: 8.5, align: 'center' });
    drawCell(margin + wNo + wName + wAmount, y, wPerc, subHeaderH, { bg: '#ffffff', text: 'Persentase', font: fontBold, fontSize: 8.5, align: 'center' });
    y += subHeaderH;

    // Separate regular expense items from simpanan items
    const isSimpananItem = (name) => {
        const ln = (name || '').toLowerCase();
        return ln.startsWith('kas ') || ln.startsWith('k.s.o.') || ln.includes('simpanan');
    };

    const regularExpenses = [];
    const simpananExpenses = [];

    (data.expense_breakdown || []).forEach(ex => {
        if (isSimpananItem(ex.category_name)) {
            simpananExpenses.push(ex);
        } else {
            regularExpenses.push(ex);
        }
    });

    // Render regular expenses with A, B, C, D...
    const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    let expLetterIdx = 0;

    regularExpenses.forEach(ex => {
        checkNewPage(rowH);
        const letter = letters[expLetterIdx++] || String(expLetterIdx);
        const amt = Number(ex.total) || 0;
        const percStr = formatPercent(amt, totalPemasukanFinal);
        const isAdj = ex.is_adjustment;

        drawCell(margin, y, wNo, rowH, { bg: '#ffffff', text: isAdj ? '' : letter, font: fontBold, fontSize: 8.5, align: 'center' });
        drawCell(margin + wNo, y, wName, rowH, { bg: '#ffffff', text: isAdj ? `  — ${ex.category_name}` : ex.category_name, font: isAdj ? fontRegular : fontBold, fontSize: 8.5, paddingLeft: 8 });
        drawCell(margin + wNo + wName, y, wAmount, rowH, { bg: '#ffffff', rpPrefix: amt > 0, rpAmount: amt > 0 ? formatCurrencyForPDF(amt) : '-', font: isAdj ? fontRegular : fontBold, fontSize: 8.5 });
        drawCell(margin + wNo + wName + wAmount, y, wPerc, rowH, { bg: '#ffffff', text: percStr, font: isAdj ? fontRegular : fontBold, fontSize: 8.5, align: 'center' });
        y += rowH;
    });

    // Render Simpanan (if any)
    if (simpananExpenses.length > 0) {
        const totalSimpananAmt = simpananExpenses.reduce((sum, s) => sum + (Number(s.total) || 0), 0);
        const totalSimpananPerc = formatPercent(totalSimpananAmt, totalPemasukanFinal);
        const simpananLetter = letters[expLetterIdx++] || 'H';

        // Parent Row for Simpanan (Bold, white background)
        checkNewPage(rowH);
        drawCell(margin, y, wNo, rowH, { bg: '#ffffff', text: simpananLetter, font: fontBold, fontSize: 8.5, align: 'center' });
        drawCell(margin + wNo, y, wName, rowH, { bg: '#ffffff', text: 'Total Simpanan', font: fontBold, fontSize: 8.5, paddingLeft: 8 });
        drawCell(margin + wNo + wName, y, wAmount, rowH, { bg: '#ffffff', rpPrefix: true, rpAmount: formatCurrencyForPDF(totalSimpananAmt), font: fontBold, fontSize: 8.5 });
        drawCell(margin + wNo + wName + wAmount, y, wPerc, rowH, { bg: '#ffffff', text: totalSimpananPerc, font: fontBold, fontSize: 8.5, align: 'center' });
        y += rowH;

        // Sub-items for Simpanan (Soft Peach background #faebe5)
        simpananExpenses.forEach((sx, sIdx) => {
            checkNewPage(rowH);
            const subCode = `${simpananLetter.toLowerCase()}${sIdx + 1}`;
            const sAmt = Number(sx.total) || 0;
            const sPerc = formatPercent(sAmt, totalPemasukanFinal);

            let sTitle = sx.category_name;
            const wDays = workingDays || 30;
            if (wDays > 0 && sAmt > 0 && !sTitle.includes('@')) {
                const dailyRate = Math.round(sAmt / wDays);
                if (dailyRate * wDays === sAmt || Math.abs(dailyRate * wDays - sAmt) < wDays) {
                    sTitle = `${sx.category_name} ( ${formatCurrencyForPDF(dailyRate)} @ ${wDays} Hari )`;
                }
            }

            drawCell(margin, y, wNo, rowH, { bg: '#faebe5', text: subCode, font: fontBold, fontSize: 8, align: 'center' });
            drawCell(margin + wNo, y, wName, rowH, { bg: '#faebe5', text: sTitle, font: fontRegular, fontSize: 8, paddingLeft: 8 });
            drawCell(margin + wNo + wName, y, wAmount, rowH, { bg: '#faebe5', rpPrefix: true, rpAmount: formatCurrencyForPDF(sAmt), font: fontRegular, fontSize: 8 });
            drawCell(margin + wNo + wName + wAmount, y, wPerc, rowH, { bg: '#faebe5', text: sPerc, font: fontRegular, fontSize: 8, align: 'center' });
            y += rowH;
        });
    }

    // 4. RINGKASAN SECTION
    const ringkasanH = 20;
    checkNewPage(ringkasanH + rowH * 3 + 10);

    drawCell(margin, y, contentWidth, ringkasanH, {
        bg: '#356296',
        text: 'RINGKASAN',
        font: fontBold,
        fontSize: 9.5,
        textColor: '#ffffff',
        paddingLeft: 8
    });
    y += ringkasanH;

    // Row 1: PEMASUKAN (#c7f7c4)
    drawCell(margin, y, wNo + wName, rowH, { bg: '#c7f7c4', text: 'PEMASUKAN', font: fontBold, fontSize: 8.5, paddingLeft: 8 });
    drawCell(margin + wNo + wName, y, wAmount, rowH, { bg: '#c7f7c4', rpPrefix: true, rpAmount: formatCurrencyForPDF(totalPemasukanFinal), font: fontBold, fontSize: 8.5 });
    drawCell(margin + wNo + wName + wAmount, y, wPerc, rowH, { bg: '#c7f7c4', text: '100%', font: fontBold, fontSize: 8.5, align: 'center' });
    y += rowH;

    // Row 2: PENGELUARAN (#fcdad7)
    drawCell(margin, y, wNo + wName, rowH, { bg: '#fcdad7', text: 'PENGELUARAN', font: fontBold, fontSize: 8.5, paddingLeft: 8 });
    drawCell(margin + wNo + wName, y, wAmount, rowH, { bg: '#fcdad7', rpPrefix: true, rpAmount: formatCurrencyForPDF(totalPengeluaran), font: fontBold, fontSize: 8.5 });
    drawCell(margin + wNo + wName + wAmount, y, wPerc, rowH, { bg: '#fcdad7', text: totalExpPerc, font: fontBold, fontSize: 8.5, align: 'center' });
    y += rowH;

    // Row 3: PROFIT/SELISIH (#d9e2f3)
    const totalProfitAmount = Number(data.profit) !== undefined && !isNaN(Number(data.profit)) ? Number(data.profit) : (totalPemasukanFinal - totalPengeluaran);
    const profitPerc = formatPercent(totalProfitAmount, totalPemasukanFinal);

    drawCell(margin, y, wNo + wName, rowH, { bg: '#d9e2f3', text: 'PROFIT/SELISIH', font: fontBold, fontSize: 8.5, paddingLeft: 8 });
    drawCell(margin + wNo + wName, y, wAmount, rowH, { bg: '#d9e2f3', rpPrefix: true, rpAmount: formatCurrencyForPDF(totalProfitAmount), font: fontBold, fontSize: 8.5 });
    drawCell(margin + wNo + wName + wAmount, y, wPerc, rowH, { bg: '#d9e2f3', text: profitPerc, font: fontBold, fontSize: 8.5, align: 'center' });
    y += rowH;

    // 5. BAGI HASIL SECTION (if exists)
    if (data.bagi_hasil && data.bagi_hasil.length > 0) {
        checkNewPage(20 + rowH * 2 + 10);

        drawCell(margin, y, contentWidth, 20, {
            bg: '#356296',
            text: 'BAGI HASIL',
            font: fontBold,
            fontSize: 9.5,
            textColor: '#ffffff',
            paddingLeft: 8
        });
        y += 20;

        data.bagi_hasil.forEach(bh => {
            checkNewPage(rowH);
            const bhTitle = bh.title || bh.name || 'Partner';
            const bhAmt = Number(bh.amount) || 0;
            const bhPerc = bh.percentage !== undefined ? `${bh.percentage}%` : '';

            drawCell(margin, y, wNo + wName, rowH, { bg: '#ffffff', text: bhTitle, font: fontBold, fontSize: 8.5, paddingLeft: 8 });
            drawCell(margin + wNo + wName, y, wAmount, rowH, { bg: '#ffffff', rpPrefix: true, rpAmount: formatCurrencyForPDF(bhAmt), font: fontBold, fontSize: 8.5 });
            drawCell(margin + wNo + wName + wAmount, y, wPerc, rowH, { bg: '#ffffff', text: bhPerc, font: fontBold, fontSize: 8.5, align: 'center' });
            y += rowH;

            if (bh.subItems && bh.subItems.length > 0) {
                const activeSubs = bh.subItems.filter(sh => sh.is_active === undefined || sh.is_active === true || sh.is_active === 'true' || sh.is_active === 1);
                activeSubs.forEach(sh => {
                    checkNewPage(rowH);
                    const sAmt = Number(sh.amount) || 0;
                    const sPerc = sh.percentage !== undefined && sh.percentage !== '' ? `${sh.percentage}%` : '';

                    drawCell(margin, y, wNo + wName, rowH, { bg: '#faebe5', text: `    — ${sh.title}`, font: fontRegular, fontSize: 8, paddingLeft: 8 });
                    drawCell(margin + wNo + wName, y, wAmount, rowH, { bg: '#faebe5', rpPrefix: true, rpAmount: formatCurrencyForPDF(sAmt), font: fontRegular, fontSize: 8 });
                    drawCell(margin + wNo + wName + wAmount, y, wPerc, rowH, { bg: '#faebe5', text: sPerc, font: fontRegular, fontSize: 8, align: 'center' });
                    y += rowH;
                });
            }
        });
    }

    // 6. NILAI STOK SECTION
    const stokH = 20;
    checkNewPage(stokH + rowH * 2 + 10);

    drawCell(margin, y, contentWidth, stokH, {
        bg: '#5c4777',
        text: 'NILAI STOK',
        font: fontBold,
        fontSize: 9.5,
        textColor: '#ffffff',
        paddingLeft: 8
    });
    y += stokH;

    // Nilai Stok Awal
    drawCell(margin, y, wNo + wName, rowH, { bg: '#ffffff', text: 'Nilai Stok Awal', font: fontRegular, fontSize: 8.5, paddingLeft: 8 });
    drawCell(margin + wNo + wName, y, wAmount + wPerc, rowH, { bg: '#ffffff', rpPrefix: data.stok_awal ? true : false, rpAmount: data.stok_awal ? formatCurrencyForPDF(data.stok_awal) : '-', font: fontRegular, fontSize: 8.5 });
    y += rowH;

    // Nilai Stok Akhir
    drawCell(margin, y, wNo + wName, rowH, { bg: '#ffffff', text: 'Nilai Stok Akhir', font: fontRegular, fontSize: 8.5, paddingLeft: 8 });
    drawCell(margin + wNo + wName, y, wAmount + wPerc, rowH, { bg: '#ffffff', rpPrefix: data.stok_akhir ? true : false, rpAmount: data.stok_akhir ? formatCurrencyForPDF(data.stok_akhir) : '-', font: fontRegular, fontSize: 8.5 });
    y += rowH;

    // Attachment stats info & Footer
    if (data.attachment_stats && data.attachment_stats.total > 0) {
        checkNewPage(30);
        y += 6;
        const stats = data.attachment_stats;
        doc.fontSize(7.5).font(fontRegular).fillColor('#6b7280');
        const statsText = `Total Transaksi: ${stats.total} | Lengkap: ${stats.hijau || 0} | Kurang: ${stats.kuning || 0} | Kosong: ${stats.merah || 0} | Opsional: ${stats.abu || 0}`;
        doc.text(statsText, margin, y, { align: 'center', width: contentWidth });
        y += 12;
    } else {
        y += 10;
    }

    checkNewPage(20);
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
    const footerText = `Laporan ini dicetak pada ${formattedDate} pukul ${formattedTime}${printedByText}`;

    doc.fontSize(7.5).font(fontRegular).fillColor('#9ca3af').text(footerText, margin, y, { align: 'center', width: contentWidth });

    doc.end();

    return new Promise((resolve, reject) => {
        writeStream.on('finish', () => resolve(filepath));
        writeStream.on('error', reject);
        doc.on('error', reject);
    });
}

async function exportBagiHasilToPDF(report, filename, branchName, selectedMonthDate) {
    const filepath = path.join(EXPORTS_DIR, filename);
    const doc = new PDFDocument({ margin: 50, size: 'A4' });
    const writeStream = fs.createWriteStream(filepath);
    doc.pipe(writeStream);

    const pageWidth = doc.page.width;
    const margin = 50;
    const contentWidth = pageWidth - 2 * margin;
    let y = margin;

    const fontBold = 'Helvetica-Bold';
    const fontRegular = 'Helvetica';

    const monthLabel = getMonthName(selectedMonthDate.getMonth());
    const yearLabel = selectedMonthDate.getFullYear();

    // 1. Header
    doc.fillColor('#1e3a8a').fontSize(20).font(fontBold).text(`BAGI HASIL ${branchName.toUpperCase()}`, margin, y, { align: 'center' });
    y += 25;
    doc.fontSize(10).text(`Periode ${monthLabel} ${yearLabel}`, margin, y, { align: 'center' });
    y += 30;

    doc.strokeColor('#e5e7eb').lineWidth(1).moveTo(margin, y).lineTo(pageWidth - margin, y).stroke();
    y += 20;

    // 2. Summary (Simple)
    const bagiHasilData = report.bagi_hasil || [];
    const totalBagiHasil = Math.floor(bagiHasilData.reduce((sum, bh) => sum + (Number(bh.amount) || 0), 0));

    doc.fillColor('#111827').fontSize(10).font(fontBold).text('TOTAL PROFIT', margin, y);
    y += 15;
    doc.fontSize(18).fillColor('#1e3a8a').text(`Rp ${formatCurrency(totalBagiHasil).replace('Rp', '').trim()}`, margin, y);
    y += 40;

    // 3. Detail Table
    doc.fontSize(11).font(fontBold).fillColor('#111827').text('RINCIAN BAGI HASIL', margin, y);
    y += 20;

    // Table Header
    doc.fillColor('#374151').fontSize(9).font(fontBold);
    doc.text('PENERIMA', margin + 10, y);
    doc.text('PORSI', margin + 300, y, { width: 50, align: 'right' });
    doc.text('NOMINAL', margin + 380, y, { width: 100, align: 'right' });
    y += 15;
    doc.strokeColor('#000000').lineWidth(1).moveTo(margin, y).lineTo(pageWidth - margin, y).stroke();
    y += 10;

    bagiHasilData.forEach(bh => {
        // Check if item will fit on page
        if (y > doc.page.height - 120) { doc.addPage(); y = 50; }

        // Parent row
        doc.fillColor('#111827').fontSize(10).font(fontBold).text(bh.title || bh.name || 'Partner', margin + 10, y);
        if (bh.percentage) doc.fillColor('#111827').fontSize(10).font(fontBold).text(`${bh.percentage}%`, margin + 300, y, { width: 50, align: 'right' });
        doc.fillColor('#111827').fontSize(10).font(fontBold).text(`Rp ${formatCurrency(bh.amount).replace('Rp', '').trim()}`, margin + 380, y, { width: 100, align: 'right' });
        y += 18;

        // Sub items
        if (bh.subItems && bh.subItems.length > 0) {
            const activeSubItems = bh.subItems.filter(sh => sh.is_active === undefined || sh.is_active === true || sh.is_active === 'true' || sh.is_active === 1 || sh.is_active === '1');
            if (activeSubItems.length > 0) {
                activeSubItems.forEach(sh => {
                    if (y > doc.page.height - 40) { doc.addPage(); y = 50; }
                    doc.fillColor('#111827').fontSize(10).font(fontRegular).text(`— ${sh.title}`, margin + 25, y);
                    if (sh.percentage) doc.fillColor('#111827').fontSize(10).font(fontRegular).text(`${sh.percentage}%`, margin + 300, y, { width: 50, align: 'right' });
                    doc.fillColor('#111827').fontSize(10).font(fontRegular).text(`Rp ${formatCurrency(sh.amount).replace('Rp', '').trim()}`, margin + 380, y, { width: 100, align: 'right' });
                    y += 15;

                    const subSubsidiVal = Number(sh.subsidi) || 0;
                    if (subSubsidiVal > 0) {
                        if (y > doc.page.height - 40) { doc.addPage(); y = 50; }
                        doc.fillColor('#111827').fontSize(10).font(fontRegular).text(`    — Sub`, margin + 25, y);
                        doc.fillColor('#111827').fontSize(10).font(fontRegular).text(`Rp ${formatCurrency(subSubsidiVal).replace('Rp', '').trim()}`, margin + 380, y, { width: 100, align: 'right' });
                        y += 15;

                        if (y > doc.page.height - 40) { doc.addPage(); y = 50; }
                        doc.fillColor('#111827').fontSize(10).font(fontBold).text(`    — Total`, margin + 25, y);
                        doc.fillColor('#111827').fontSize(10).font(fontBold).text(`Rp ${formatCurrency(Number(sh.amount) + subSubsidiVal).replace('Rp', '').trim()}`, margin + 380, y, { width: 100, align: 'right' });
                        y += 15;
                    }
                });
                y += 5;
            }
        }

        doc.strokeColor('#f3f4f6').lineWidth(0.5).moveTo(margin + 10, y).lineTo(pageWidth - margin, y).stroke();
        y += 10;
    });

    y += 30;

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

    doc.fontSize(8).font(fontRegular).fillColor('#9ca3af').text(`Dokumen ini dicetak otomatis melalui Aplikasi Keuangan VERKAS pada ${formattedDate} Pukul ${formattedTime}`, margin, y, { align: 'center' });

    doc.end();

    return new Promise((resolve, reject) => {
        writeStream.on('finish', () => resolve(filepath));
        writeStream.on('error', reject);
        doc.on('error', reject);
    });
}

// Export Savings Report (Laporan Simpanan) to PDF
async function exportSavingsReportToPDF(reportData, filename, branchName, selectedMonthDate, workingDays) {
    const filepath = path.join(EXPORTS_DIR, filename);
    const doc = new PDFDocument({
        margin: 40,
        size: 'A4',
        info: {
            Title: `Laporan Simpanan ${branchName}`,
            Author: 'VERKAS'
        }
    });

    const writeStream = fs.createWriteStream(filepath);
    doc.pipe(writeStream);

    const pageWidth = doc.page.width;
    const margin = 40;
    const contentWidth = pageWidth - 2 * margin;
    let y = margin;

    const checkNewPage = (h) => {
        if (y + h > doc.page.height - 40) {
            doc.addPage();
            y = margin;
            return true;
        }
        return false;
    };

    const formatCurrencyForPDF = (amount) => {
        if (amount === undefined || amount === null || isNaN(amount)) return '0';
        return new Intl.NumberFormat('id-ID', { minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(amount);
    };

    const fontBold = 'Helvetica-Bold';
    const fontRegular = 'Helvetica';

    const monthIndex = selectedMonthDate.getMonth();
    const year = selectedMonthDate.getFullYear();
    const lastDay = new Date(year, monthIndex + 1, 0).getDate();
    const monthName = getMonthName(monthIndex).toUpperCase();
    const periodText = `01 - ${String(lastDay).padStart(2, '0')} ${monthName} ${year}`;

    // Header Title
    doc.font(fontBold).fontSize(14).fillColor('#000000').text('LAPORAN SIMPANAN', margin, y, { align: 'center', width: contentWidth });
    y += 18;
    doc.font(fontBold).fontSize(13).text(branchName.toUpperCase(), margin, y, { align: 'center', width: contentWidth });
    y += 24;

    // Period and Working Days
    doc.fontSize(9).font(fontBold).text('PER TANGGAL', margin, y);
    doc.text(':', margin + 180, y);
    doc.font(fontRegular).text(periodText, margin + 200, y);
    y += 14;

    doc.fontSize(9).font(fontBold).text('JUMLAH HARI KERJA', margin, y);
    doc.text(':', margin + 180, y);
    doc.font(fontRegular).text(`${workingDays || 30} HARI`, margin + 200, y);
    y += 18;

    // Double Divider Line at top
    doc.strokeColor('#000000').lineWidth(2).moveTo(margin, y).lineTo(margin + contentWidth, y).stroke();
    y += 3;
    doc.strokeColor('#000000').lineWidth(1).moveTo(margin, y).lineTo(margin + contentWidth, y).stroke();
    y += 14;

    const categories = reportData.categories || [];

    for (let i = 0; i < categories.length; i++) {
        const cat = categories[i];
        
        // Calculate needed minimum height for banner + basic rows
        checkNewPage(110);

        // 1. Green Header Banner
        const bannerHeight = 18;
        doc.rect(margin, y, contentWidth, bannerHeight).fillColor('#cbe8c7').fill();
        doc.fillColor('#000000').font(fontBold).fontSize(9.5).text(cat.name.toUpperCase(), margin + 6, y + 4);
        y += bannerHeight + 8;

        // 2. Saldo Awal
        doc.fillColor('#000000').font(fontBold).fontSize(9).text('Saldo Awal', margin + 6, y);
        doc.text('Rp', margin + contentWidth - 120, y);
        doc.text(formatCurrencyForPDF(cat.saldoAwal), margin + contentWidth - 95, y, { align: 'right', width: 95 });
        y += 16;

        // 3. Penambahan Simpanan
        const penambahan = Number(cat.penambahan) || 0;
        let penambahanLabel = 'Penambahan Simpanan';
        if (workingDays > 0 && penambahan > 0) {
            const daily = Math.round(penambahan / workingDays);
            penambahanLabel = `Penambahan Simpanan ( ${formatCurrencyForPDF(daily)} x ${workingDays} hari )`;
        }
        doc.font(fontBold).fontSize(9).text(penambahanLabel, margin + 6, y);
        doc.text('Rp', margin + contentWidth - 120, y);
        doc.text(penambahan > 0 ? formatCurrencyForPDF(penambahan) : '-', margin + contentWidth - 95, y, { align: 'right', width: 95 });
        y += 16;

        // 4. Bunga Bank (if applicable)
        if (cat.bungaBank !== undefined && cat.bungaBank !== null) {
            doc.font(fontBold).fontSize(9).text('Bunga Bank', margin + 6, y);
            doc.text('Rp', margin + contentWidth - 120, y);
            doc.text(cat.bungaBank > 0 ? formatCurrencyForPDF(cat.bungaBank) : '-', margin + contentWidth - 95, y, { align: 'right', width: 95 });
            y += 16;
        }

        // 5. Rincian Pengeluaran
        doc.font(fontBold).fontSize(9).text('Rincian Pengeluaran', margin + 6, y);
        y += 14;

        const expenses = cat.expenses || [];
        if (expenses.length === 0) {
            doc.font(fontRegular).fontSize(9).text('-', margin + 20, y);
            doc.text('=', margin + contentWidth - 180, y);
            doc.text('Rp', margin + contentWidth - 155, y);
            doc.text('-', margin + contentWidth - 95, y, { align: 'right', width: 95 });
            y += 16;
        } else {
            const noteWidth = contentWidth - 235;

            for (let j = 0; j < expenses.length; j++) {
                const exp = expenses[j];
                const cleanNote = String(exp.note || '-').replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim();
                
                doc.font(fontRegular).fontSize(8.5);
                const noteHeight = doc.heightOfString(cleanNote, { width: noteWidth });
                const rowHeight = Math.max(15, noteHeight + 3);

                checkNewPage(rowHeight + 2);

                // Small green marker / flag
                doc.save();
                doc.fillColor('#16a34a');
                doc.polygon([margin + 8, y + 2.5], [margin + 14, y + 5.5], [margin + 8, y + 8.5]).fill();
                doc.restore();

                // Day
                doc.font(fontRegular).fontSize(8.5).fillColor('#000000').text(exp.day, margin + 20, y);

                // Note with multiline support
                doc.text(cleanNote, margin + 42, y, { width: noteWidth });

                // = Rp Amount (aligned to top of the row)
                doc.text('=', margin + contentWidth - 180, y);
                doc.text('Rp', margin + contentWidth - 155, y);
                doc.text(formatCurrencyForPDF(exp.amount), margin + contentWidth - 95, y, { align: 'right', width: 95 });

                y += rowHeight;
            }
        }

        // Total Biaya Pengeluaran
        checkNewPage(45);
        const totalPengeluaran = Number(cat.totalPengeluaran) || 0;
        doc.font(fontBold).fontSize(9).text('Total Biaya Pengeluaran', margin + contentWidth - 290, y, { align: 'right', width: 140 });
        doc.text('Rp', margin + contentWidth - 120, y);
        doc.text(totalPengeluaran > 0 ? formatCurrencyForPDF(totalPengeluaran) : '-', margin + contentWidth - 95, y, { align: 'right', width: 95 });
        y += 18;

        // 6. Saldo Akhir with Green Highlight Box
        doc.strokeColor('#000000').lineWidth(0.75).moveTo(margin, y).lineTo(margin + contentWidth, y).stroke();
        y += 2;

        const boxHeight = 18;
        const boxWidth = 120;
        doc.rect(margin + contentWidth - boxWidth, y, boxWidth, boxHeight).fillColor('#cbe8c7').fill();

        doc.fillColor('#000000').font(fontBold).fontSize(9.5).text('Saldo Akhir', margin + 6, y + 4);
        doc.text('Rp', margin + contentWidth - boxWidth + 8, y + 4);
        doc.text(formatCurrencyForPDF(cat.saldoAkhir), margin + contentWidth - 95, y + 4, { align: 'right', width: 90 });
        y += boxHeight + 2;

        // Category Box Border / Solid separator line
        doc.strokeColor('#000000').lineWidth(2).moveTo(margin, y).lineTo(margin + contentWidth, y).stroke();
        y += 14;
    }

    doc.end();

    return new Promise((resolve, reject) => {
        writeStream.on('finish', () => resolve(filepath));
        writeStream.on('error', reject);
        doc.on('error', reject);
    });
}

module.exports = {
    exportToPDF,
    exportBukuKasToPDF,
    exportCategoryToPDF,
    exportFinancialReportToPDF,
    exportBagiHasilToPDF,
    exportSavingsReportToPDF
};
