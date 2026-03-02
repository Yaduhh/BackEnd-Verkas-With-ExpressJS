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

// Export Category to PDF (Visual Report)
async function exportCategoryToPDF(data, filename, branchName, options = {}) {
    const filepath = path.join(EXPORTS_DIR, filename);
    const doc = new PDFDocument({
        margin: 40,
        size: 'A4',
        info: {
            Title: options.title || 'Laporan Kategori',
            Author: 'VERKAS',
        }
    });

    doc.pipe(fs.createWriteStream(filepath));
    const margin = 40;
    const contentWidth = doc.page.width - 2 * margin;
    let y = margin;

    const checkNewPage = (h) => { if (y + h > doc.page.height - 40) { doc.addPage(); y = margin; return true; } return false; };

    // Font registration (omitted for brevity, shared with others)
    const fontBold = 'Helvetica-Bold';
    const fontRegular = 'Helvetica';
    const fontMedium = 'Helvetica-Bold';

    const isIncome = options.type ? options.type === 'income' : (data.length > 0 ? data[0].type === 'income' : true);
    const color = isIncome ? '#10b981' : '#ef4444';
    const bgColor = isIncome ? '#ecfdf5' : '#fef2f2';

    doc.fillColor('#64748b').fontSize(10).font(fontMedium).text('LAPORAN KATEGORI', margin, y);
    y += 15;
    doc.fillColor(color).fontSize(24).font(fontBold).text(options.categoryName || 'Kategori', margin, y);
    y += 30;
    doc.fillColor('#0f172a').fontSize(12).font(fontRegular).text(branchName || 'Branch', margin, y);
    doc.fillColor('#64748b').fontSize(10).text(new Date().toLocaleDateString('id-ID'), margin, y + 2, { align: 'right', width: contentWidth });
    y += 25;
    doc.strokeColor('#e2e8f0').lineWidth(1).moveTo(margin, y).lineTo(margin + contentWidth, y).stroke();
    y += 20;

    const totalAmount = data.reduce((sum, t) => sum + parseFloat(t.amount || 0), 0);
    doc.roundedRect(margin, y, contentWidth, 70, 12).fillColor(bgColor).fill();
    doc.roundedRect(margin, y, contentWidth, 70, 12).strokeColor(color).lineWidth(1).stroke();
    doc.fillColor('#475569').fontSize(10).font(fontMedium).text('Total Nominal', margin + 24, y + 15);
    doc.fillColor(color).fontSize(20).font(fontBold).text(formatCurrency(totalAmount), margin + 24, y + 31);
    y += 90;

    doc.roundedRect(margin, y, contentWidth, 32, 6).fillColor('#1e293b').fill();
    doc.fillColor('#ffffff').fontSize(10).font(fontBold).text('Tanggal', margin + 10, y + 10);
    doc.text('Nominal', margin + contentWidth * 0.18 + 10, y + 10);
    doc.text('Keterangan', margin + contentWidth * 0.40 + 10, y + 10);
    y += 37;

    doc.font(fontRegular).fontSize(9).fillColor('#0f172a');
    data.forEach((item, idx) => {
        const rowH = 30;
        checkNewPage(rowH);
        if (idx % 2 === 0) doc.roundedRect(margin, y, contentWidth, rowH, 4).fillColor('#f8fafc').fill();
        doc.fillColor('#0f172a').text(item.transaction_date || '-', margin + 10, y + 10, { width: contentWidth * 0.18 });
        doc.fillColor(color).font(fontMedium).text(formatCurrency(parseFloat(item.amount || 0)), margin + contentWidth * 0.18 + 10, y + 10, { width: contentWidth * 0.22 });
        doc.fillColor('#334155').font(fontRegular).text(item.note || '-', margin + contentWidth * 0.40 + 10, y + 10, { width: contentWidth * 0.45 });
        y += rowH + 2;
    });

    doc.end();
    return new Promise((resolve, reject) => { doc.on('end', () => resolve(filepath)); doc.on('error', reject); });
}

// Export Detailed Branch Financial Report to PDF
async function exportFinancialReportToPDF(data, filename, branchName, selectedMonth, workingDays, options = {}) {
    const filepath = path.join(EXPORTS_DIR, filename);
    const doc = new PDFDocument({
        margin: 40,
        size: 'A4',
        info: {
            Title: `Laporan Keuangan ${branchName}`,
            Author: 'VERKAS'
        }
    });

    const writeStream = fs.createWriteStream(filepath);
    doc.pipe(writeStream);
    const pageWidth = doc.page.width;
    const margin = 40;
    const contentWidth = pageWidth - 2 * margin;
    let y = margin;

    const checkNewPage = (h) => { if (y + h > doc.page.height - 40) { doc.addPage(); y = margin; return true; } return false; };
    const formatCurrencyForPDF = (amount) => new Intl.NumberFormat('id-ID', { minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(amount || 0);

    const fontBold = 'Helvetica-Bold';
    const fontRegular = 'Helvetica';

    doc.font(fontBold).fontSize(14).fillColor('#000000').text('LAPORAN KEUANGAN', margin, y, { align: 'center', width: contentWidth });
    y += 20;
    doc.text(branchName.toUpperCase(), margin, y, { align: 'center', width: contentWidth });
    y += 30;

    const lDay = new Date(selectedMonth.getFullYear(), selectedMonth.getMonth() + 1, 0).getDate();
    const period = `01 - ${String(lDay).padStart(2, '0')} ${getMonthName(selectedMonth.getMonth())} ${selectedMonth.getFullYear()}`;

    doc.fontSize(9).text('PER TANGGAL', margin, y);
    doc.text(':', margin + 180, y);
    doc.text(period, margin + 200, y);
    y += 15;
    doc.text('JUMLAH HARI KERJA', margin, y);
    doc.text(':', margin + 180, y);
    doc.text(`${workingDays} HARI`, margin + 200, y);
    y += 30;

    doc.strokeColor('#000000').lineWidth(1.5).moveTo(margin, y).lineTo(margin + contentWidth, y).stroke();
    y += 10;

    // Calculate total base income for percentages (Total real cash incoming)
    const totalPemasukanFinal = (Number(data.omzet_total) || 0) + (Number(data.pelunasan_piutang_bulan_lalu) || 0);

    doc.font(fontBold).fontSize(10).text('Omzet Penjualan', margin, y);
    y += 18;
    // List income folders from income_breakdown (excluding Lain-lain)
    (data.income_breakdown || []).filter(ch => ch.category_name !== 'Lain-lain').forEach(ch => {
        doc.font(fontBold).fontSize(10).text(ch.category_name, margin + 40, y);
        doc.text('Rp', margin + 360, y);
        doc.text(formatCurrencyForPDF(ch.total), margin + 380, y, { align: 'right', width: 85 });
        const folderPerc = totalPemasukanFinal > 0 ? (ch.total / totalPemasukanFinal * 100).toFixed(2) : '0.00';
        doc.text(`${folderPerc} %`, margin + 470, y, { align: 'right', width: 45 });
        y += 18;
    });

    doc.font(fontBold).fontSize(10).text('Sales Channel', margin, y);
    y += 14;

    (data.sales_channels || []).forEach(ch => {
        doc.font(fontRegular).fontSize(9).text(ch.name, margin + 40, y);
        doc.text('Rp', margin + 330, y);
        doc.text(formatCurrencyForPDF(ch.amount), margin + 350, y, { align: 'right', width: 85 });
        y += 14;
    });

    y += 10;
    const lainLain = (data.income_breakdown || []).find(item => item.category_name === 'Lain-lain');
    doc.font(fontBold).fontSize(10).text('Pendapatan Lainnya', margin, y);
    doc.text('Rp', margin + 360, y);
    doc.text(formatCurrencyForPDF(lainLain?.total || 0), margin + 380, y, { align: 'right', width: 85 });
    const pLainPerc = totalPemasukanFinal > 0 ? ((lainLain?.total || 0) / totalPemasukanFinal * 100).toFixed(2) : '0.00';
    doc.text(`${pLainPerc} %`, margin + 470, y, { align: 'right', width: 45 });
    y += 18;
    doc.text(`Pelunasan Piutang ${data.prev_month_label || 'Bulan Lalu'}`, margin, y);
    doc.text('Rp', margin + 360, y);
    doc.text(formatCurrencyForPDF(data.pelunasan_piutang_bulan_lalu), margin + 380, y, { align: 'right', width: 85 });
    const pPiutangPerc = totalPemasukanFinal > 0 ? ((data.pelunasan_piutang_bulan_lalu || 0) / totalPemasukanFinal * 100).toFixed(2) : '0.00';
    doc.text(`${pPiutangPerc} %`, margin + 470, y, { align: 'right', width: 45 });
    y += 30;

    doc.text('Pengeluaran', margin, y);
    y += 18;
    (data.expense_breakdown || []).forEach((ex, idx) => {
        checkNewPage(20);
        doc.font(fontRegular).fontSize(9);
        doc.text(`${idx + 1}`, margin, y, { width: 20, align: 'right' });
        doc.text(ex.category_name, margin + 30, y, { width: 200 });
        doc.text('Rp', margin + 330, y).text(formatCurrencyForPDF(ex.total), margin + 350, y, { align: 'right', width: 85 });
        // Individual expenses are also calculated against total income
        const perc = totalPemasukanFinal > 0 ? (ex.total / totalPemasukanFinal * 100).toFixed(2) : '0.00';
        doc.text(`${perc} %`, margin + 440, y, { align: 'right', width: 45 });
        y += 16;
    });

    y += 10;
    doc.font(fontBold).fontSize(10).text('Total Biaya Pengeluaran', margin + 150, y, { width: 200 });
    doc.text('Rp', margin + 360, y).text(formatCurrencyForPDF(data.pengeluaran_total), margin + 380, y, { align: 'right', width: 85 });
    const totalExpPerc = totalPemasukanFinal > 0 ? (data.pengeluaran_total / totalPemasukanFinal * 100).toFixed(2) : '0.00';
    doc.text(`${totalExpPerc} %`, margin + 470, y, { align: 'right', width: 45 });
    doc.strokeColor('#000000').lineWidth(2).moveTo(margin + 360, y + 12).lineTo(pageWidth - margin, y + 12).stroke();
    y += 30;

    doc.rect(margin, y, contentWidth, 24).fillColor('#8B0000').fill();
    doc.fillColor('#FFFFFF').text('Profit', margin + 20, y + 6);
    // Profit in IDR: Total Income - Total Expense
    const totalProfitAmount = totalPemasukanFinal - (Number(data.pengeluaran_total) || 0);
    doc.text('Rp', margin + 360, y + 6).text(formatCurrencyForPDF(totalProfitAmount), margin + 380, y + 6, { align: 'right', width: 85 });
    // Profit in percentage: (Total Income % [100%] - Total Expense %)
    const pMar = totalPemasukanFinal > 0 ? (totalProfitAmount / totalPemasukanFinal * 100).toFixed(3) : '0.000';
    doc.text(`${pMar} %`, margin + 470, y + 6, { align: 'right', width: 45 });
    y += 40;

    // Section: Bagi Hasil
    if (data.bagi_hasil && data.bagi_hasil.length > 0) {
        doc.font(fontBold).fontSize(10).fillColor('#000000').text('Bagi Hasil', margin, y);
        y += 18;
        data.bagi_hasil.forEach(bh => {
            checkNewPage(20);
            const nameToDisplay = bh.name || bh.title || 'Partner';
            doc.font(fontRegular).fontSize(9).text(nameToDisplay, margin + 40, y);

            // Display percentage if exists - Aligned with main percentage column
            if (bh.percentage !== undefined) {
                doc.text(`${bh.percentage}%`, margin + 470, y, { align: 'right', width: 45 });
            }

            // Aligned with main Rp and Amount columns
            doc.text('Rp', margin + 360, y);
            doc.text(formatCurrencyForPDF(bh.amount), margin + 380, y, { align: 'right', width: 85 });
            y += 16;
        });
        doc.strokeColor('#000000').lineWidth(1).moveTo(margin + 360, y).lineTo(pageWidth - margin, y).stroke();
        y += 25;
    }

    doc.font(fontBold).fontSize(10).fillColor('#000000').text('Nilai Stok Persediaan', margin, y);
    y += 20;
    doc.font(fontRegular).fontSize(9);

    // Awal
    doc.text('Awal', margin + 40, y);
    doc.text('Rp', margin + 360, y);
    doc.text(formatCurrencyForPDF(data.stok_awal), margin + 380, y, { align: 'right', width: 85 });
    y += 15;

    // Akhir
    doc.text('Akhir', margin + 40, y);
    doc.text('Rp', margin + 360, y);
    doc.text(formatCurrencyForPDF(data.stok_akhir), margin + 380, y, { align: 'right', width: 85 });

    doc.end();
    return new Promise((resolve) => { writeStream.on('finish', () => resolve(filepath)); });
}

module.exports = {
    exportToPDF,
    exportBukuKasToPDF,
    exportCategoryToPDF,
    exportFinancialReportToPDF
};
