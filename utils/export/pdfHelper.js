const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');
const { EXPORTS_DIR, formatCurrency, getMonthName } = require('./commonHelper');
const sharp = require('sharp');


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

    // Sort transactions chronologically (oldest first: 1 -> 31)
    validData.sort((a, b) => {
        const d1 = new Date(a.transaction_date).getTime();
        const d2 = new Date(b.transaction_date).getTime();
        if (d1 !== d2) return d1 - d2;
        return (a.id || 0) - (b.id || 0);
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
    const INDONESIAN_DAYS = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];

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
        return new Intl.NumberFormat('id-ID', {
            minimumFractionDigits: 0,
            maximumFractionDigits: 0
        }).format(val);
    };

    const formatIndoPercent = (val) => {
        if (val === null || val === undefined || isNaN(val)) return '0,00%';
        return Number(val).toFixed(2).replace('.', ',') + '%';
    };

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
    const softBg = isExpense ? '#FDECEB' : '#EEF4E8';

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

    // Column Widths (A4 Portrait content width: 559.28)
    const colWidths = {
        tgl: 46,
        note: 205,
        nominalAmount: 98,
        itemPerc: 42,
        totalDay: 116,
        dayPerc: 52.28
    };

    // Header dimensions
    const headerHeight = 92;
    const headerBg = '#001b54'; // Deep navy blue
    const headerTextColor = '#FFFFFF'; // Clean white

    // 1. Draw Navy Header Container
    doc.rect(margin, y, contentWidth, headerHeight).fillColor(headerBg).fill();

    // Top accent bar
    const accentBarColor = isExpense ? '#991b1b' : (lampiranType === 'PEMASUKAN' ? '#004b23' : '#1e3a8a');
    doc.rect(margin, y, contentWidth, 2.5).fillColor(accentBarColor).fill();

    // 2. Left side Header Texts
    doc.fillColor(headerTextColor).font(fontBold).fontSize(10.5);
    const leftPadding = margin + 12;
    doc.text(`NAMA LAMPIRAN : ${lampiranType}`, leftPadding, y + 10);
    doc.text(`NAMA KATEGORI : ${categoryTitle}`, leftPadding, y + 29);
    doc.text(`TANGGAL : ${periodText}`, leftPadding, y + 48);
    doc.text(`BUKA : ${workingDays} HARI`, leftPadding, y + 67);

    // 3. Right side Total Box (Seamlessly aligned with Total BB/Oz & % columns)
    const totalBoxX = margin + colWidths.tgl + colWidths.note + colWidths.nominalAmount + colWidths.itemPerc;
    const totalBoxY = y + 58;
    const totalBoxWidth = colWidths.totalDay + colWidths.dayPerc;
    const totalBoxHeight = headerHeight - 58;

    // Draw total box border with white outline
    doc.rect(totalBoxX, totalBoxY, totalBoxWidth, totalBoxHeight)
        .strokeColor('#FFFFFF')
        .lineWidth(1.2)
        .stroke();

    // Vertical divider between Total Oz and %
    const dividerX = totalBoxX + colWidths.totalDay;
    doc.moveTo(dividerX, totalBoxY).lineTo(dividerX, totalBoxY + totalBoxHeight)
        .strokeColor('#FFFFFF')
        .lineWidth(1.2)
        .stroke();

    // Left sub-box: Rp & Grand Total
    doc.font(fontBold).fontSize(11).fillColor('#FFFFFF').text('Rp', totalBoxX + 6, totalBoxY + 11);
    doc.font(fontBold).fontSize(11.5).fillColor('#FFFFFF').text(
        formatIndoHeaderTotal(grandTotal),
        totalBoxX + 22,
        totalBoxY + 10,
        { width: colWidths.totalDay - 28, align: 'right' }
    );

    // Right sub-box: 100%
    doc.font(fontBold).fontSize(12).fillColor('#FFFFFF').text(
        '100%',
        dividerX,
        totalBoxY + 10,
        { width: colWidths.dayPerc, align: 'center' }
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
        const x1 = margin + colWidths.tgl;
        const x2 = x1 + colWidths.note;
        const x3 = x2 + colWidths.nominalAmount + colWidths.itemPerc;
        const x4 = x3 + colWidths.totalDay;

        doc.moveTo(x1, curY).lineTo(x1, curY + tableHeaderHeight).stroke();
        doc.moveTo(x2, curY).lineTo(x2, curY + tableHeaderHeight).stroke();
        doc.moveTo(x3, curY).lineTo(x3, curY + tableHeaderHeight).stroke();
        doc.moveTo(x4, curY).lineTo(x4, curY + tableHeaderHeight).stroke();

        // Header Texts
        doc.fillColor('#000000').font(fontBold).fontSize(10);
        doc.text('TGL', margin, curY + 7.5, { width: colWidths.tgl, align: 'center' });
        doc.text('Keterangan', x1, curY + 7.5, { width: colWidths.note, align: 'center' });
        doc.text('Nominal', x2, curY + 7.5, { width: colWidths.nominalAmount + colWidths.itemPerc, align: 'center' });
        doc.text(totalColHeader, x3, curY + 7.5, { width: colWidths.totalDay, align: 'center' });
        doc.text('%', x4, curY + 7.5, { width: colWidths.dayPerc, align: 'center' });

        return curY + tableHeaderHeight;
    };

    y = drawTableHeader(y);

    // Draw Data Rows grouped by date with smooth pagination
    for (const group of groups) {
        const isSingleItemInGroup = group.items.length === 1;
        const itemHeights = group.items.map(item => {
            const rawNote = item.note || item.category_name || '-';
            const noteText = sanitizePDFText(rawNote);
            doc.font(fontRegular).fontSize(9);
            const textHeight = doc.heightOfString(noteText, { width: colWidths.note - 12 });
            const minH = isSingleItemInGroup ? 29 : 20;
            return Math.max(minH, textHeight + 8);
        });

        let itemIndex = 0;
        const totalItemsInGroup = group.items.length;
        const totalGroupHeight = itemHeights.reduce((a, b) => a + b, 0);

        while (itemIndex < totalItemsInGroup) {
            // Check remaining space on current page
            const remainingPageSpace = (pageHeight - margin - 20) - y;

            // If the entire group can fit on a clean page, and doesn't fit on current page, break page cleanly
            if (itemIndex === 0 && totalGroupHeight <= (pageHeight - 2 * margin - 50) && remainingPageSpace < totalGroupHeight) {
                doc.addPage({ margin: margin, size: 'A4' });
                y = margin;
                y = drawTableHeader(y);
            } else if (remainingPageSpace < 25) {
                doc.addPage({ margin: margin, size: 'A4' });
                y = margin;
                y = drawTableHeader(y);
            }

            // Determine how many items fit in the current page
            const chunkItems = [];
            const chunkHeights = [];
            let chunkHeight = 0;

            while (itemIndex < totalItemsInGroup) {
                const h = itemHeights[itemIndex];
                if (y + chunkHeight + h > pageHeight - margin - 20 && chunkItems.length > 0) {
                    break;
                }
                chunkItems.push(group.items[itemIndex]);
                chunkHeights.push(h);
                chunkHeight += h;
                itemIndex++;
            }

            const groupStartY = y;
            const middleX = margin + colWidths.tgl;
            const middleW = colWidths.note + colWidths.nominalAmount + colWidths.itemPerc;

            // Draw middle columns per item in this chunk
            chunkItems.forEach((item, idx) => {
                const rowH = chunkHeights[idx];
                const isEven = idx % 2 === 0;
                const rowBg = isEven ? '#FFFFFF' : softBg;
                const itemAmt = Math.abs(parseFloat(item.amount !== undefined ? item.amount : (item.net_amount !== undefined ? item.net_amount : 0)));
                const rawNote = item.note || item.category_name || '-';
                const noteText = sanitizePDFText(rawNote);

                // Middle background
                doc.rect(middleX, y, middleW, rowH).fillColor(rowBg).fill();

                // Borders
                doc.strokeColor('#000000').lineWidth(0.5);
                doc.moveTo(middleX, y).lineTo(middleX + middleW, y).stroke();
                doc.moveTo(middleX, y + rowH).lineTo(middleX + middleW, y + rowH).stroke();

                // Divider between Note and Nominal Amount
                doc.moveTo(middleX + colWidths.note, y).lineTo(middleX + colWidths.note, y + rowH).stroke();
                // Divider between Nominal Amount and Item %
                doc.moveTo(middleX + colWidths.note + colWidths.nominalAmount, y).lineTo(middleX + colWidths.note + colWidths.nominalAmount, y + rowH).stroke();

                // Text in Note
                doc.font(fontRegular).fontSize(9).fillColor('#000000');
                const noteTextH = doc.heightOfString(noteText, { width: colWidths.note - 12 });
                const notePaddingY = y + Math.max(4.5, (rowH - noteTextH) / 2);
                doc.text(noteText, middleX + 6, notePaddingY, {
                    width: colWidths.note - 12,
                    align: 'left'
                });

                // Text in Nominal Amount
                const textY = y + (rowH - 9) / 2;
                doc.font(fontRegular).fontSize(8.5).fillColor('#000000');
                doc.text('Rp', middleX + colWidths.note + 4, textY);
                doc.font(fontRegular).fontSize(9).fillColor('#000000');
                doc.text(
                    formatIndoNominal(itemAmt),
                    middleX + colWidths.note + 18,
                    textY,
                    { width: colWidths.nominalAmount - 22, align: 'right' }
                );

                // Text in Item %
                const itemPerc = group.dayTotal > 0 ? (itemAmt / group.dayTotal * 100) : 0;
                const itemPercText = hasSalesChannels ? `${Math.round(itemPerc)}%` : formatIndoPercent(itemPerc);
                doc.font(fontBold).fontSize(9).fillColor('#000000');
                doc.text(
                    itemPercText,
                    middleX + colWidths.note + colWidths.nominalAmount,
                    textY,
                    { width: colWidths.itemPerc - 5, align: 'right' }
                );

                y += rowH;
            });

            // Draw merged TGL column for this chunk
            const tglX = margin;
            const tglW = colWidths.tgl;
            doc.rect(tglX, groupStartY, tglW, chunkHeight).fillColor(softBg).fill();
            doc.strokeColor('#000000').lineWidth(0.5).rect(tglX, groupStartY, tglW, chunkHeight).stroke();

            const dayNumH = 11;
            const dayNameH = 9;
            const lineGap = 1.5;
            const totalTextH = dayNumH + dayNameH + lineGap;
            const tglCenterY = groupStartY + Math.max(3, (chunkHeight - totalTextH) / 2);

            doc.font(fontBold).fontSize(10).fillColor('#000000');
            doc.text(String(group.dayNumber), tglX, tglCenterY, { width: tglW, align: 'center', lineBreak: false });
            doc.font(fontRegular).fontSize(8.5).fillColor('#000000');
            doc.text(group.dayName, tglX, tglCenterY + dayNumH + lineGap, { width: tglW, align: 'center', lineBreak: false });

            // Draw merged Total BB/Oz column for this chunk
            const totX = margin + colWidths.tgl + colWidths.note + colWidths.nominalAmount + colWidths.itemPerc;
            const totW = colWidths.totalDay;
            doc.rect(totX, groupStartY, totW, chunkHeight).fillColor('#FFFFFF').fill();
            doc.strokeColor('#000000').lineWidth(0.5).rect(totX, groupStartY, totW, chunkHeight).stroke();

            const totCenterY = groupStartY + (chunkHeight - 11) / 2;
            doc.font(fontBold).fontSize(9).fillColor('#000000');
            doc.text('Rp', totX + 5, totCenterY);
            doc.font(fontBold).fontSize(9.5).fillColor('#000000');
            doc.text(
                formatIndoNominal(group.dayTotal),
                totX + 22,
                totCenterY,
                { width: totW - 27, align: 'right' }
            );

            // Draw merged % column for this chunk
            const percX = totX + totW;
            const percW = colWidths.dayPerc;
            doc.rect(percX, groupStartY, percW, chunkHeight).fillColor(softBg).fill();
            doc.strokeColor('#000000').lineWidth(0.5).rect(percX, groupStartY, percW, chunkHeight).stroke();

            const dayPerc = grandTotal > 0 ? (group.dayTotal / grandTotal * 100) : 0;
            const dayPercText = hasSalesChannels ? `${Math.round(dayPerc)}%` : formatIndoPercent(dayPerc);
            const percCenterY = groupStartY + (chunkHeight - 11) / 2;
            doc.font(fontBold).fontSize(9.5).fillColor('#000000');
            doc.text(
                dayPercText,
                percX,
                percCenterY,
                { width: percW - 6, align: 'right' }
            );

            // If there are more items in this group, add page for next iteration
            if (itemIndex < totalItemsInGroup) {
                doc.addPage({ margin: margin, size: 'A4' });
                y = margin;
                y = drawTableHeader(y);
            }
        }
    }

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

    // Column dimensions for table layout
    const wNo = 30;
    const wName = 315.28;
    const wAmount = 128;
    const wPerc = 62;

    const getFlexibleCellMetrics = (text, width, { font = fontRegular, fontSize = 8.5, paddingLeft = 8, paddingRight = 5, baseHeight = 18, minFontSize = 7.2, prefixText = '' } = {}) => {
        const str = String(text || '');
        const pStr = String(prefixText || '');
        const availWidth = Math.max(20, width - paddingLeft - paddingRight);
        doc.font(font).fontSize(fontSize);
        const fullOneLineWidth = doc.widthOfString(pStr + str);
        if (fullOneLineWidth <= availWidth) {
            return { rowHeight: baseHeight, fittedFontSize: fontSize };
        }
        const scaledSize = (availWidth / fullOneLineWidth) * fontSize;
        if (scaledSize >= minFontSize) {
            return { rowHeight: baseHeight, fittedFontSize: Math.floor(scaledSize * 10) / 10 };
        }
        const wrapFontSize = 7.5;
        doc.font(font).fontSize(wrapFontSize);
        const pWidth = pStr ? doc.widthOfString(pStr) : 0;
        const bodyWidth = Math.max(20, availWidth - pWidth);
        const wrappedHeight = doc.heightOfString(str, { width: bodyWidth, lineGap: 1 });
        const dynamicHeight = Math.max(baseHeight, Math.ceil(wrappedHeight) + 8);
        return { rowHeight: dynamicHeight, fittedFontSize: wrapFontSize };
    };

    const drawCell = (x, currentY, width, height, cellOpts = {}) => {
        const {
            bg = null,
            border = '#000000',
            borderWidth = 0.5,
            text = '',
            prefixText = '',
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
            const str = String(text);
            doc.font(font).fontSize(fontSize).fillColor(textColor);
            const textWidth = width - paddingLeft - paddingRight;
            if (prefixText) {
                const pStr = String(prefixText);
                const pWidth = doc.widthOfString(pStr);
                const bodyWidth = Math.max(20, textWidth - pWidth);
                const bodyHeight = doc.heightOfString(str, { width: bodyWidth, lineGap: 1 });
                const bodyY = bodyHeight > fontSize * 1.4
                    ? currentY + Math.max(2, (height - bodyHeight) / 2) - 0.5
                    : textY;
                doc.text(pStr, x + paddingLeft, bodyY, { width: pWidth + 2, align: 'left', lineBreak: false });
                doc.text(str, x + paddingLeft + pWidth, bodyY, { width: bodyWidth, align: align, lineGap: 1 });
            } else {
                const blockHeight = doc.heightOfString(str, { width: textWidth, lineGap: 1 });
                const blockY = blockHeight > fontSize * 1.4
                    ? currentY + Math.max(2, (height - blockHeight) / 2) - 0.5
                    : textY;
                doc.text(str, x + paddingLeft, blockY, { width: textWidth, align: align, lineGap: 1 });
            }
        }
    };

    // 1. TOP HEADER BANNER (Dark Navy Blue with Gold/Yellow Text)
    const headerHeight = 52;
    doc.rect(margin, y, contentWidth, headerHeight).fillColor('#0a1c58').fill();
    doc.rect(margin, y, contentWidth, headerHeight).lineWidth(0.5).strokeColor('#000000').stroke();

    // Center Title: LAP. KEU and BRANCH CODE / NAME
    const branchLabel = (options.branchCode && options.branchCode.trim())
        ? options.branchCode.trim()
        : branchName;

    doc.font(fontBold).fontSize(14).fillColor('#ffff00');
    doc.text('LAP. KEU', margin, y + 10, { width: contentWidth, align: 'center' });
    doc.text(branchLabel.toUpperCase(), margin, y + 28, { width: contentWidth, align: 'center' });

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
    const omzetItemsInitial = (data.income_breakdown || []).filter(it => {
        const n = (it.category_name || '').toLowerCase();
        return (n.includes('omzet') || n.includes('omset')) && !n.includes('lain');
    });
    const totalOmzetNetInitial = omzetItemsInitial.reduce((sum, it) => sum + (Number(it.total) || 0), 0);
    const totalOtherIncomeInitial = (data.income_breakdown || []).filter(it => !(it.category_name || '').toLowerCase().includes('omzet') && !(it.category_name || '').toLowerCase().includes('omset')).reduce((sum, it) => sum + (Number(it.total) || 0), 0);
    const totalPemasukanFinal = Number(data.omzet_total) || (totalOmzetNetInitial + totalOtherIncomeInitial + Number(data.pelunasan_piutang_bulan_lalu || 0));

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

    // Calculate total net omzet from income breakdown
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

    const pemasukanRows = [];

    // A) Sales channels
    if (salesChannelsList.length === 0) {
        if (totalOmzetNet > 0) {
            pemasukanRows.push({ name: 'Omzet Penjualan', amount: totalOmzetNet });
        }
    } else {
        salesChannelsList.forEach((sc) => {
            let scName = (sc.name || sc.channel_name || '').trim();
            // Remove redundant 'Omzet' / 'Omset' prefix if present so channel names like 'Oz Dine In' remain clean
            scName = scName.replace(/^(omzet|omset)\s+/i, '');
            const amt = Number(sc.amount) || 0;
            pemasukanRows.push({ name: scName, amount: amt });
        });

        // If there is unallocated omzet not covered by the channels
        const unallocatedOmzet = totalOmzetNet - totalSalesChannels;
        if (unallocatedOmzet >= 1) {
            pemasukanRows.push({ name: 'Omzet Belum Teralokasi Channel', amount: unallocatedOmzet });
        }
    }

    // B) Other Income Categories (Lain-lain or other categories that are not the main Omzet)
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

    // C) Pelunasan Piutang Bulan Lalu (if any)
    if (data.pelunasan_piutang_bulan_lalu && Number(data.pelunasan_piutang_bulan_lalu) > 0) {
        const amt = Number(data.pelunasan_piutang_bulan_lalu);
        const label = `Pelunasan Piutang ${data.prev_month_label || 'Bulan Lalu'}`;
        pemasukanRows.push({ name: label, amount: amt });
    }

    const pemasukanPcts = reconcilePercentages(pemasukanRows.map(r => r.amount), totalPemasukanFinal);
    pemasukanRows.forEach((row, idx) => {
        const { rowHeight: curH, fittedFontSize } = getFlexibleCellMetrics(row.name, wName, { font: fontBold, fontSize: 8.5, paddingLeft: 8, baseHeight: rowH });
        checkNewPage(curH);
        const percStr = pemasukanPcts[idx].toFixed(2).replace('.', ',') + '%';
        const pemRowBg = idx % 2 === 0 ? '#ebf1de' : '#ffffff';
        drawCell(margin, y, wNo, curH, { bg: pemRowBg, text: `${pemIdx++}`, font: fontBold, fontSize: 8.5, align: 'center' });
        drawCell(margin + wNo, y, wName, curH, { bg: pemRowBg, text: row.name, font: fontBold, fontSize: fittedFontSize, paddingLeft: 8 });
        drawCell(margin + wNo + wName, y, wAmount, curH, { bg: pemRowBg, rpPrefix: true, rpAmount: formatCurrencyForPDF(row.amount), font: fontBold, fontSize: 8.5 });
        drawCell(margin + wNo + wName + wAmount, y, wPerc, curH, { bg: pemRowBg, text: percStr, font: fontBold, fontSize: 8.5, align: 'center' });
        y += curH;
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

    // Render regular expenses with 1, 2, 3, 4...
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
        const percStr = formatPercent(amt, totalPemasukanFinal);
        const prefixText = isChild ? `  ${subCode}   ` : '';
        const rowFont = isChild ? fontRegular : fontBold;
        const rowBg = (expVisualRowIdx++ % 2 === 0) ? '#f2dcdb' : '#ffffff';
        const { rowHeight: curH, fittedFontSize } = getFlexibleCellMetrics(ex.category_name, wName, { font: rowFont, fontSize: 8.5, paddingLeft: 8, baseHeight: rowH, prefixText });
        checkNewPage(curH);

        drawCell(margin, y, wNo, curH, { bg: rowBg, text: rowNo, font: fontBold, fontSize: 8.5, align: 'center' });
        drawCell(margin + wNo, y, wName, curH, { bg: rowBg, text: ex.category_name, prefixText, font: rowFont, fontSize: fittedFontSize, paddingLeft: 8 });
        drawCell(margin + wNo + wName, y, wAmount, curH, { bg: rowBg, rpPrefix: amt > 0, rpAmount: amt > 0 ? formatCurrencyForPDF(amt) : '-', font: rowFont, fontSize: 8.5 });
        drawCell(margin + wNo + wName + wAmount, y, wPerc, curH, { bg: rowBg, text: percStr, font: rowFont, fontSize: 8.5, align: 'center' });
        y += curH;
    });

    // Render Simpanan (if any)
    if (simpananExpenses.length > 0) {
        const totalSimpananAmt = simpananExpenses.reduce((sum, s) => sum + (Number(s.total) || 0), 0);
        const totalSimpananPerc = formatPercent(totalSimpananAmt, totalPemasukanFinal);
        const simpananNo = String(++expNumberIdx);
        const simpananParentBg = (expVisualRowIdx++ % 2 === 0) ? '#f2dcdb' : '#ffffff';

        // Parent Row for Simpanan (Bold, alternating background)
        checkNewPage(rowH);
        drawCell(margin, y, wNo, rowH, { bg: simpananParentBg, text: simpananNo, font: fontBold, fontSize: 8.5, align: 'center' });
        drawCell(margin + wNo, y, wName, rowH, { bg: simpananParentBg, text: 'Total Simpanan', font: fontBold, fontSize: 8.5, paddingLeft: 8 });
        drawCell(margin + wNo + wName, y, wAmount, rowH, { bg: simpananParentBg, rpPrefix: true, rpAmount: formatCurrencyForPDF(totalSimpananAmt), font: fontBold, fontSize: 8.5 });
        drawCell(margin + wNo + wName + wAmount, y, wPerc, rowH, { bg: simpananParentBg, text: totalSimpananPerc, font: fontBold, fontSize: 8.5, align: 'center' });
        y += rowH;

        // Sub-items for Simpanan (same style as sub-kategori, with 7.1, 7.2...)
        simpananExpenses.forEach((sx, sIdx) => {
            const subCode = `${simpananNo}.${sIdx + 1}`;
            const sAmt = Number(sx.total) || 0;
            const sPerc = formatPercent(sAmt, totalPemasukanFinal);

            let sTitle = sx.category_name;
            const customNote = typeof sx.savings_note === 'string' ? sx.savings_note.trim() : '';
            const allocAmt = Number(sx.allocation_amount) || 0;
            const allocDays = Number(sx.allocation_days) || 0;
            if (customNote) {
                const cleanNote = customNote.replace(/^\(\s*|\s*\)$/g, '');
                sTitle = `${sx.category_name} ( ${cleanNote} )`;
            } else if (!sTitle.includes('@')) {
                if (allocAmt > 0 && allocDays > 0) {
                    sTitle = `${sx.category_name} ( ${formatCurrencyForPDF(allocAmt)} @ ${allocDays} Hari )`;
                } else if (allocAmt > 0) {
                    sTitle = `${sx.category_name} ( ${formatCurrencyForPDF(allocAmt)} )`;
                } else if (allocDays > 0) {
                    sTitle = `${sx.category_name} ( ${allocDays} Hari )`;
                }
            }

            const prefixText = `  ${subCode}   `;
            const { rowHeight: curH, fittedFontSize } = getFlexibleCellMetrics(sTitle, wName, { font: fontRegular, fontSize: 8.5, paddingLeft: 8, baseHeight: rowH, prefixText });
            checkNewPage(curH);

            const subRowBg = (expVisualRowIdx++ % 2 === 0) ? '#f2dcdb' : '#ffffff';
            drawCell(margin, y, wNo, curH, { bg: subRowBg, text: '', font: fontRegular, fontSize: 8.5, align: 'center' });
            drawCell(margin + wNo, y, wName, curH, { bg: subRowBg, text: sTitle, prefixText, font: fontRegular, fontSize: fittedFontSize, paddingLeft: 8 });
            drawCell(margin + wNo + wName, y, wAmount, curH, { bg: subRowBg, rpPrefix: sAmt > 0, rpAmount: sAmt > 0 ? formatCurrencyForPDF(sAmt) : '-', font: fontRegular, fontSize: 8.5 });
            drawCell(margin + wNo + wName + wAmount, y, wPerc, curH, { bg: subRowBg, text: sPerc, font: fontRegular, fontSize: 8.5, align: 'center' });
            y += curH;
        });
    }

    // 4. RINGKASAN SECTION
    const ringkasanH = 20;
    const ringkasanRowCount = piutangAmount > 0 ? 4 : 3;
    checkNewPage(ringkasanH + rowH * ringkasanRowCount + 10);

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

    // Row: PIUTANG (#fff2cc)
    if (piutangAmount > 0) {
        const piutangPerc = formatPercent(piutangAmount, totalPemasukanFinal);
        drawCell(margin, y, wNo + wName, rowH, { bg: '#fff2cc', text: piutangLabel, font: fontBold, fontSize: 8.5, paddingLeft: 8 });
        drawCell(margin + wNo + wName, y, wAmount, rowH, { bg: '#fff2cc', rpPrefix: true, rpAmount: formatCurrencyForPDF(piutangAmount), font: fontBold, fontSize: 8.5 });
        drawCell(margin + wNo + wName + wAmount, y, wPerc, rowH, { bg: '#fff2cc', text: piutangPerc, font: fontBold, fontSize: 8.5, align: 'center' });
        y += rowH;
    }

    // Row 3: PROFIT/SELISIH (#d9e2f3)
    const totalProfitAmount = Number(data.profit) !== undefined && !isNaN(Number(data.profit))
        ? Number(data.profit)
        : (totalPemasukanFinal - totalPengeluaran - piutangAmount);
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
    checkNewPage(stokH + rowH * 3 + 10);

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

    // Selisih Nilai Stok
    const stokAwalNum = parseFloat(data.stok_awal) || 0;
    const stokAkhirNum = parseFloat(data.stok_akhir) || 0;
    const hasStokData = Boolean(
        (data.stok_awal !== null && data.stok_awal !== undefined && data.stok_awal !== '') ||
        (data.stok_akhir !== null && data.stok_akhir !== undefined && data.stok_akhir !== '')
    );
    const selisihStok = stokAkhirNum - stokAwalNum;

    drawCell(margin, y, wNo + wName, rowH, { bg: '#ffffff', text: 'Selisih Nilai Stok', font: fontRegular, fontSize: 8.5, paddingLeft: 8 });
    drawCell(margin + wNo + wName, y, wAmount + wPerc, rowH, { 
        bg: '#ffffff', 
        rpPrefix: hasStokData, 
        rpAmount: hasStokData ? formatCurrencyForPDF(selisihStok) : '-', 
        font: fontRegular, 
        fontSize: 8.5 
    });
    y += rowH;

    // ==========================================
    // HALAMAN 2: GRAFIK LINGKARAN KEUANGAN (PEMASUKAN & PENGELUARAN DALAM 1 HALAMAN)
    // ==========================================
    doc.addPage();
    const pMargin = 25;
    const pContentWidth = pageWidth - 2 * pMargin; // 545.28 pt
    let yP2 = 25;

    // Header Banner Page 2 (Square / Flat borders, no rounded)
    const headerP2Height = 34;
    doc.rect(pMargin, yP2, pContentWidth, headerP2Height).fillColor('#0a1c58').fill();
    doc.rect(pMargin, yP2, pContentWidth, headerP2Height).lineWidth(0.5).strokeColor('#000000').stroke();

    doc.font(fontBold).fontSize(10).fillColor('#ffff00');
    doc.text('GRAFIK & DIAGRAM KEUANGAN (PEMASUKAN & PENGELUARAN)', pMargin, yP2 + 6, { width: pContentWidth, align: 'center' });
    doc.fontSize(11).text(branchLabel.toUpperCase(), pMargin, yP2 + 19, { width: pContentWidth, align: 'center' });

    doc.font(fontBold).fontSize(9).fillColor('#ffff00');
    doc.text(dateLabel, pMargin + pContentWidth - 150, yP2 + 6, { width: 140, align: 'right' });
    doc.text(openDaysLabel, pMargin + pContentWidth - 150, yP2 + 19, { width: 140, align: 'right' });

    yP2 += headerP2Height + 8;

    // Dimensions for 2 stacked cards on 1 single page
    const cardHeight = 358;
    const headerStripHeight = 22;
    const chartImgHeight = cardHeight - headerStripHeight;

    const SVG_CHART_WIDTH = 2400;
    const SVG_CHART_HEIGHT = Math.round(SVG_CHART_WIDTH * (chartImgHeight / pContentWidth));

    // Helper: Draw Full Circular Pie Chart with integrated in-slice labels and leader lines (Always Centered, Ultra Sharp, 100% Circular)
    const generatePiePNG = async (items, totalVal, width = SVG_CHART_WIDTH, height = SVG_CHART_HEIGHT) => {
        const validItems = items.filter(d => d.amount > 0);
        const sum = validItems.reduce((acc, cur) => acc + cur.amount, 0);

        const escapeXml = (str) => String(str || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&apos;');

        const cx = width / 2;
        const cy = height / 2;
        const r = 495;

        if (validItems.length === 0 || sum === 0) {
            const svg = `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
                <rect width="100%" height="100%" fill="#ffffff" />
                <circle cx="${cx}" cy="${cy}" r="${r}" fill="#f3f4f6" stroke="#e5e7eb" stroke-width="4" />
                <text x="${cx}" y="${cy + 14}" fill="#9ca3af" font-family="Arial, Helvetica, sans-serif" font-size="38" text-anchor="middle">Tidak ada data transaksi</text>
            </svg>`;
            return await sharp(Buffer.from(svg)).png().toBuffer();
        }

        if (validItems.length === 1) {
            const it = validItems[0];
            const amtStr = 'Rp ' + new Intl.NumberFormat('id-ID').format(it.amount);
            const svg = `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
                <rect width="100%" height="100%" fill="#ffffff" />
                <circle cx="${cx}" cy="${cy}" r="${r}" fill="${it.color}" stroke="#ffffff" stroke-width="4" />
                <text x="${cx}" y="${cy - 48}" fill="#ffffff" font-family="Arial, Helvetica, sans-serif" font-weight="bold" font-size="46" text-anchor="middle" style="paint-order: stroke; stroke: rgba(0,0,0,0.35); stroke-width: 3.5px;">${escapeXml(it.name)}</text>
                <text x="${cx}" y="${cy + 18}" fill="#ffffff" font-family="Arial, Helvetica, sans-serif" font-weight="bold" font-size="60" text-anchor="middle" style="paint-order: stroke; stroke: rgba(0,0,0,0.35); stroke-width: 3.5px;">100%</text>
                <text x="${cx}" y="${cy + 76}" fill="#ffffff" font-family="Arial, Helvetica, sans-serif" font-size="38" text-anchor="middle" style="paint-order: stroke; stroke: rgba(0,0,0,0.35); stroke-width: 3.5px;">${amtStr}</text>
            </svg>`;
            return await sharp(Buffer.from(svg)).png().toBuffer();
        }

        // Minimum visual angle for tiny slices (e.g. 0.05%) so they are never swallowed by borders
        const MIN_SLICE_RADIAN = 0.035; // ~2 degrees visual minimum (~21px arc at r=520)
        let availableAngle = 2 * Math.PI;
        let largeItemsSum = 0;
        const prepped = [];

        // Count how many small slices there are
        const smallCount = validItems.filter(it => (it.amount / sum) * (2 * Math.PI) < MIN_SLICE_RADIAN).length;
        const effectiveMinRadian = (smallCount * MIN_SLICE_RADIAN > 2 * Math.PI * 0.2)
            ? (2 * Math.PI * 0.2) / (smallCount || 1)
            : MIN_SLICE_RADIAN;

        const reconciledPcts = reconcilePercentages(validItems.map(it => it.amount), sum);
        validItems.forEach((item, idx) => {
            const rawAngle = (item.amount / sum) * (2 * Math.PI);
            const pct = reconciledPcts[idx];
            if (rawAngle < effectiveMinRadian) {
                availableAngle -= effectiveMinRadian;
                prepped.push({ item, pct, isMin: true, visualAngle: effectiveMinRadian });
            } else {
                largeItemsSum += item.amount;
                prepped.push({ item, pct, isMin: false });
            }
        });

        // Scale large slices proportionally
        prepped.forEach(p => {
            if (!p.isMin) {
                p.visualAngle = largeItemsSum > 0
                    ? (p.item.amount / largeItemsSum) * availableAngle
                    : (2 * Math.PI) / prepped.length;
            }
        });

        let currentAngle = -Math.PI / 2;
        const tempItems = [];
        prepped.forEach(({ item, pct, visualAngle }) => {
            const midAngle = currentAngle + visualAngle / 2;
            const isCallout = pct < 25;
            const isRight = Math.cos(midAngle) >= 0;
            tempItems.push({ item, sliceAngle: visualAngle, midAngle, pct, isCallout, isRight });
            currentAngle += visualAngle;
        });

        let paths = '';
        const inSliceLabels = [];
        const inSlicePercentagesOnly = [];
        const calloutItems = [];
        currentAngle = -Math.PI / 2;

        tempItems.forEach(({ item, sliceAngle, midAngle, pct, isCallout, isRight }) => {
            const endAngle = currentAngle + sliceAngle;
            const x1 = cx + r * Math.cos(currentAngle);
            const y1 = cy + r * Math.sin(currentAngle);
            const x2 = cx + r * Math.cos(endAngle);
            const y2 = cy + r * Math.sin(endAngle);
            const largeArc = sliceAngle > Math.PI ? 1 : 0;

            paths += `<path d="M ${cx.toFixed(1)} ${cy.toFixed(1)} L ${x1.toFixed(1)} ${y1.toFixed(1)} A ${r} ${r} 0 ${largeArc} 1 ${x2.toFixed(1)} ${y2.toFixed(1)} Z" fill="${item.color}" stroke="#ffffff" stroke-width="2" stroke-linejoin="round" />\n`;

            const pctStr = pct.toFixed(2).replace('.', ',') + '%';
            const amtStr = 'Rp ' + new Intl.NumberFormat('id-ID').format(item.amount);

            if (!isCallout) {
                const inR = pct > 50 ? r * 0.44 : r * 0.55;
                const tx = cx + inR * Math.cos(midAngle);
                const ty = cy + inR * Math.sin(midAngle);
                inSliceLabels.push({
                    name: item.name,
                    amtStr,
                    pctStr,
                    tx,
                    ty,
                    pct
                });
            } else {
                const elbowX = isRight ? cx + r + 32 : cx - r - 32;
                const endX = isRight ? elbowX + 28 : elbowX - 28;
                const textX = isRight ? endX + 12 : endX - 12;
                const maxLabelWidth = isRight ? (width - 28 - textX) : (textX - 28);

                let cleanName = String(item.name || '')
                    .replace(/\(\s*Grab,\s*Go\s*Food,\s*Dll\s*\)/i, '(Grab/GoFood/dll)')
                    .replace(/\s+/g, ' ')
                    .trim();

                let titleLines = [cleanName];
                const estSingleWidth = doc.font(fontBold).fontSize(42).widthOfString(cleanName) * 1.12;
                const parenIdx = cleanName.indexOf('(');
                if (parenIdx > 2 && (estSingleWidth > maxLabelWidth * 0.88 || cleanName.length > 18)) {
                    const beforeParen = cleanName.slice(0, parenIdx).trim();
                    const parenPart = cleanName.slice(parenIdx).trim();
                    if (beforeParen && parenPart) {
                        titleLines = [beforeParen, parenPart];
                    }
                } else if (estSingleWidth > maxLabelWidth || cleanName.length > 21) {
                    const words = cleanName.split(' ');
                    if (words.length >= 2) {
                        let bestSplit = 1;
                        let bestDiff = Infinity;
                        for (let i = 1; i < words.length; i++) {
                            const l1 = words.slice(0, i).join(' ');
                            const l2 = words.slice(i).join(' ');
                            const diff = Math.abs(l1.length - l2.length);
                            if (diff < bestDiff) {
                                bestDiff = diff;
                                bestSplit = i;
                            }
                        }
                        titleLines = [words.slice(0, bestSplit).join(' '), words.slice(bestSplit).join(' ')];
                    }
                }

                const isTwoLineTitle = titleLines.length > 1;
                calloutItems.push({
                    item,
                    pct,
                    pctStr,
                    amtStr,
                    midAngle,
                    x_edge: cx + r * Math.cos(midAngle),
                    y_edge: cy + r * Math.sin(midAngle),
                    isRight,
                    titleLines,
                    topExtent: isTwoLineTitle ? 98 : 56,
                    bottomExtent: isTwoLineTitle ? 56 : 52,
                    initialY: cy + (r + 60) * Math.sin(midAngle)
                });

                if (pct >= 1.5) {
                    const textR = pct > 8 ? r * 0.68 : r * 0.77;
                    const tx = cx + textR * Math.cos(midAngle);
                    const ty = cy + textR * Math.sin(midAngle);
                    const fSize = pct > 10 ? 38 : (pct > 5 ? 34 : (pct >= 3.5 ? 28 : 24));
                    inSlicePercentagesOnly.push({
                        pctStr,
                        tx,
                        ty,
                        fSize
                    });
                }
            }

            currentAngle = endAngle;
        });

        const lefts = calloutItems.filter(d => !d.isRight).sort((a, b) => a.initialY - b.initialY);
        const rights = calloutItems.filter(d => d.isRight).sort((a, b) => a.initialY - b.initialY);

        function relax(list) {
            if (list.length === 0) return;
            const minAllowedTop = 28;
            const maxAllowedBottom = height - 28;
            let totalNeeded = 0;
            for (let i = 0; i < list.length; i++) {
                totalNeeded += list[i].topExtent + list[i].bottomExtent;
            }
            const availSpan = maxAllowedBottom - minAllowedTop;
            const extraPadding = list.length > 1
                ? Math.min(18, Math.max(4, (availSpan - totalNeeded) / (list.length - 1)))
                : 14;
            const scaleFactor = totalNeeded > availSpan ? (availSpan / totalNeeded) : 1;

            const pairGap = (idxA, idxB) => ((list[idxA].bottomExtent + list[idxB].topExtent) * scaleFactor) + extraPadding;

            const firstMinY = minAllowedTop + list[0].topExtent * scaleFactor;
            const lastMaxY = maxAllowedBottom - list[list.length - 1].bottomExtent * scaleFactor;

            if (list[0].initialY < firstMinY) list[0].initialY = firstMinY;
            for (let i = 1; i < list.length; i++) {
                const reqY = list[i - 1].initialY + pairGap(i - 1, i);
                if (list[i].initialY < reqY) {
                    list[i].initialY = reqY;
                }
            }
            if (list[list.length - 1].initialY > lastMaxY) {
                list[list.length - 1].initialY = lastMaxY;
                for (let i = list.length - 2; i >= 0; i--) {
                    const maxY = list[i + 1].initialY - pairGap(i, i + 1);
                    if (list[i].initialY > maxY) {
                        list[i].initialY = maxY;
                    }
                }
            }
            if (list[0].initialY < firstMinY) {
                list[0].initialY = firstMinY;
                for (let i = 1; i < list.length; i++) {
                    const reqY = list[i - 1].initialY + pairGap(i - 1, i);
                    if (list[i].initialY < reqY) {
                        list[i].initialY = reqY;
                    }
                }
            }
        }

        relax(lefts);
        relax(rights);

        let inSliceSvg = '';
        inSliceLabels.forEach(d => {
            const maxInSliceWidth = r * 0.9;
            const estInWidth = doc.font(fontBold).fontSize(48).widthOfString(String(d.name || '')) * 1.06;
            const inNameSize = estInWidth > maxInSliceWidth
                ? Math.max(30, Math.floor((maxInSliceWidth / estInWidth) * 48))
                : 48;
            inSliceSvg += `
                <text x="${d.tx.toFixed(1)}" y="${(d.ty - 50).toFixed(1)}" fill="#ffffff" font-family="Arial, Helvetica, sans-serif" font-weight="bold" font-size="${inNameSize}" text-anchor="middle" style="paint-order: stroke; stroke: rgba(0,0,0,0.35); stroke-width: 3.5px;">${escapeXml(d.name)}</text>
                <text x="${d.tx.toFixed(1)}" y="${(d.ty + 18).toFixed(1)}" fill="#ffffff" font-family="Arial, Helvetica, sans-serif" font-weight="bold" font-size="60" text-anchor="middle" style="paint-order: stroke; stroke: rgba(0,0,0,0.35); stroke-width: 3.5px;">${d.pctStr}</text>
                <text x="${d.tx.toFixed(1)}" y="${(d.ty + 78).toFixed(1)}" fill="#ffffff" font-family="Arial, Helvetica, sans-serif" font-size="42" text-anchor="middle" style="paint-order: stroke; stroke: rgba(0,0,0,0.35); stroke-width: 3.5px;">${d.amtStr}</text>
            `;
        });

        inSlicePercentagesOnly.forEach(d => {
            inSliceSvg += `
                <text x="${d.tx.toFixed(1)}" y="${(d.ty + d.fSize * 0.35).toFixed(1)}" fill="#ffffff" font-family="Arial, Helvetica, sans-serif" font-weight="bold" font-size="${d.fSize}" text-anchor="middle" style="paint-order: stroke; stroke: rgba(0,0,0,0.5); stroke-width: 3px;">${d.pctStr}</text>
            `;
        });

        let calloutsSvg = '';
        [...lefts, ...rights].forEach(d => {
            const yFinal = d.initialY;
            const isR = d.isRight;
            const elbowX = isR ? cx + r + 32 : cx - r - 32;
            const endX = isR ? elbowX + 28 : elbowX - 28;
            const textAnchor = isR ? 'start' : 'end';
            const textX = isR ? endX + 12 : endX - 12;
            const maxLabelWidth = isR ? (width - 28 - textX) : (textX - 28);

            const titleLines = d.titleLines || [d.item.name];
            const baseTitleSize = titleLines.length > 1 ? 40 : 42;
            const longestTitleLine = titleLines.reduce((a, b) => (a.length >= b.length ? a : b), '');
            const estTitleWidth = doc.font(fontBold).fontSize(baseTitleSize).widthOfString(longestTitleLine) * 1.12;
            const titleFontSize = estTitleWidth > maxLabelWidth
                ? Math.max(26, Math.floor((maxLabelWidth / estTitleWidth) * baseTitleSize))
                : baseTitleSize;

            const baseSubSize = 36;
            const rawSubText = `${d.amtStr} (${d.pctStr})`;
            const estSubWidth = doc.font(fontBold).fontSize(baseSubSize).widthOfString(rawSubText) * 1.12;
            const subFontSize = estSubWidth > maxLabelWidth
                ? Math.max(24, Math.floor((maxLabelWidth / estSubWidth) * baseSubSize))
                : baseSubSize;

            let titleSvg = '';
            if (titleLines.length > 1) {
                titleSvg = `
                    <text x="${textX.toFixed(1)}" y="${(yFinal - 54).toFixed(1)}" fill="#111827" font-family="Arial, Helvetica, sans-serif" font-weight="bold" font-size="${titleFontSize}" text-anchor="${textAnchor}">${escapeXml(titleLines[0])}</text>
                    <text x="${textX.toFixed(1)}" y="${(yFinal - 8).toFixed(1)}" fill="#111827" font-family="Arial, Helvetica, sans-serif" font-weight="bold" font-size="${titleFontSize}" text-anchor="${textAnchor}">${escapeXml(titleLines[1])}</text>
                `;
            } else {
                titleSvg = `
                    <text x="${textX.toFixed(1)}" y="${(yFinal - 14).toFixed(1)}" fill="#111827" font-family="Arial, Helvetica, sans-serif" font-weight="bold" font-size="${titleFontSize}" text-anchor="${textAnchor}">${escapeXml(titleLines[0])}</text>
                `;
            }

            const subY = titleLines.length > 1 ? (yFinal + 38) : (yFinal + 36);

            calloutsSvg += `
                <polyline points="${d.x_edge.toFixed(1)},${d.y_edge.toFixed(1)} ${elbowX.toFixed(1)},${yFinal.toFixed(1)} ${endX.toFixed(1)},${yFinal.toFixed(1)}" fill="none" stroke="${d.item.color}" stroke-width="4.5" />
                <circle cx="${d.x_edge.toFixed(1)}" cy="${d.y_edge.toFixed(1)}" r="9" fill="${d.item.color}" stroke="#ffffff" stroke-width="2" />
                ${titleSvg}
                <text x="${textX.toFixed(1)}" y="${subY.toFixed(1)}" fill="#4b5563" font-family="Arial, Helvetica, sans-serif" font-size="${subFontSize}" text-anchor="${textAnchor}">${d.amtStr} <tspan font-weight="bold" fill="${d.item.color}">(${d.pctStr})</tspan></text>
            `;
        });

        const svg = `<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
            <rect width="100%" height="100%" fill="#ffffff" />
            ${paths}
            ${inSliceSvg}
            ${calloutsSvg}
        </svg>`;

        return await sharp(Buffer.from(svg)).png().toBuffer();
    };

    // Color palettes
    const incomeColors = ['#059669', '#2563eb', '#d97706', '#7c3aed', '#0891b2', '#dc2626', '#db2777', '#4b5563', '#65a30d', '#4f46e5'];
    const expenseColors = ['#2563eb', '#059669', '#d97706', '#dc2626', '#7c3aed', '#db2777', '#4b5563', '#0891b2', '#ea580c', '#65a30d'];

    // Prepare Pemasukan Items
    const pemChartItems = [];
    if (salesChannelsList.length === 0) {
        if (totalOmzetNet > 0) {
            pemChartItems.push({ name: 'Omzet Penjualan', amount: totalOmzetNet });
        }
    } else {
        salesChannelsList.forEach(sc => {
            let scName = (sc.name || sc.channel_name || '').trim();
            scName = scName.replace(/^(omzet|omset)\s+/i, '');
            const amt = Number(sc.amount) || 0;
            if (amt > 0) pemChartItems.push({ name: scName, amount: amt });
        });
        const unallocatedOmzet = totalOmzetNet - totalSalesChannels;
        if (unallocatedOmzet >= 1) {
            pemChartItems.push({ name: 'Omzet Belum Teralokasi Channel', amount: unallocatedOmzet });
        }
    }

    otherIncomes.forEach(it => {
        const amt = Number(it.total) || 0;
        if (amt > 0) {
            const displayName = (it.category_name || '').toLowerCase().includes('lain')
                ? 'Pendapatan Lain-lain'
                : it.category_name;
            pemChartItems.push({ name: displayName, amount: amt });
        }
    });

    if (data.pelunasan_piutang_bulan_lalu && Number(data.pelunasan_piutang_bulan_lalu) > 0) {
        pemChartItems.push({
            name: `Pelunasan Piutang ${data.prev_month_label || 'Bulan Lalu'}`,
            amount: Number(data.pelunasan_piutang_bulan_lalu)
        });
    }

    pemChartItems.sort((a, b) => b.amount - a.amount);
    pemChartItems.forEach((it, idx) => {
        it.color = incomeColors[idx % incomeColors.length];
    });

    // Prepare Pengeluaran Items
    const expChartItems = [];
    regularExpenses.forEach(ex => {
        if (ex.is_adjustment || ex.is_sub_item) return;
        const amt = Number(ex.total) || 0;
        if (amt > 0) expChartItems.push({ name: ex.category_name, amount: amt });
    });

    if (simpananExpenses.length > 0) {
        const totalSimpananAmt = simpananExpenses.reduce((sum, s) => sum + (Number(s.total) || 0), 0);
        if (totalSimpananAmt > 0) {
            expChartItems.push({ name: 'Total Simpanan', amount: totalSimpananAmt });
        }
    }

    expChartItems.sort((a, b) => b.amount - a.amount);
    expChartItems.forEach((it, idx) => {
        it.color = expenseColors[idx % expenseColors.length];
    });

    // --- KARTU 1: PEMASUKAN ---
    doc.save();
    doc.rect(pMargin, yP2, pContentWidth, cardHeight).fillColor('#ffffff').fill();
    doc.rect(pMargin, yP2, pContentWidth, cardHeight).lineWidth(0.75).strokeColor('#e5e7eb').stroke();
    doc.rect(pMargin, yP2, pContentWidth, headerStripHeight).fillColor('#257942').fill();
    doc.rect(pMargin, yP2, pContentWidth, headerStripHeight).lineWidth(0.5).strokeColor('#15803d').stroke();
    doc.restore();

    doc.font(fontBold).fontSize(9).fillColor('#ffffff');
    doc.text('GRAFIK LINGKARAN PEMASUKAN', pMargin + 10, yP2 + 6, { lineBreak: false });
    doc.text(`TOTAL: Rp ${formatCurrencyForPDF(totalPemasukanFinal)}  (100%)`, pMargin, yP2 + 6, { width: pContentWidth - 10, align: 'right', lineBreak: false });

    // Pie chart Pemasukan
    const pemChartPng = await generatePiePNG(pemChartItems, totalPemasukanFinal);
    doc.image(pemChartPng, pMargin, yP2 + headerStripHeight, { fit: [pContentWidth, chartImgHeight], align: 'center', valign: 'center' });

    yP2 += cardHeight + 8;

    // --- KARTU 2: PENGELUARAN ---
    doc.save();
    doc.rect(pMargin, yP2, pContentWidth, cardHeight).fillColor('#ffffff').fill();
    doc.rect(pMargin, yP2, pContentWidth, cardHeight).lineWidth(0.75).strokeColor('#e5e7eb').stroke();
    doc.rect(pMargin, yP2, pContentWidth, headerStripHeight).fillColor('#dc2626').fill();
    doc.rect(pMargin, yP2, pContentWidth, headerStripHeight).lineWidth(0.5).strokeColor('#b91c1c').stroke();
    doc.restore();

    doc.font(fontBold).fontSize(9).fillColor('#ffffff');
    doc.text('GRAFIK LINGKARAN PENGELUARAN', pMargin + 10, yP2 + 6, { lineBreak: false });
    doc.text(`TOTAL: Rp ${formatCurrencyForPDF(totalPengeluaran)}  (${totalExpPerc})`, pMargin, yP2 + 6, { width: pContentWidth - 10, align: 'right', lineBreak: false });

    // Pie chart Pengeluaran
    const expChartPng = await generatePiePNG(expChartItems, totalPengeluaran);
    doc.image(expChartPng, pMargin, yP2 + headerStripHeight, { fit: [pContentWidth, chartImgHeight], align: 'center', valign: 'center' });

    yP2 += cardHeight + 6;

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
