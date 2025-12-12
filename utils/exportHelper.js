const XLSX = require('xlsx');
const createCsvWriter = require('csv-writer').createObjectCsvWriter;
const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');

// Create exports directory if not exists
const EXPORTS_DIR = path.join(__dirname, '../exports');
if (!fs.existsSync(EXPORTS_DIR)) {
  fs.mkdirSync(EXPORTS_DIR, { recursive: true });
}

// Export to Excel (XLS)
async function exportToExcel(data, filename, title) {
  const workbook = XLSX.utils.book_new();
  
  // Prepare data
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

// Export to CSV
async function exportToCSV(data, filename) {
  const filepath = path.join(EXPORTS_DIR, filename);
  
  const csvWriter = createCsvWriter({
    path: filepath,
    header: [
      { id: 'transaction_date', title: 'Tanggal' },
      { id: 'category_name', title: 'Kategori' },
      { id: 'type', title: 'Tipe' },
      { id: 'amount', title: 'Jumlah' },
      { id: 'note', title: 'Keterangan' }
    ]
  });
  
  const records = data.map(item => ({
    transaction_date: item.transaction_date,
    category_name: item.category_name,
    type: item.type === 'income' ? 'Pemasukan' : 'Pengeluaran',
    amount: item.amount,
    note: item.note || ''
  }));
  
  await csvWriter.writeRecords(records);
  return filepath;
}

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
  const totalIncome = data.filter(t => t.type === 'income').reduce((sum, t) => sum + parseFloat(t.amount), 0);
  const totalExpense = data.filter(t => t.type === 'expense').reduce((sum, t) => sum + parseFloat(t.amount), 0);
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
    doc.text(formatCurrency(parseFloat(item.amount)), margin + colWidths.date + colWidths.category + colWidths.type + 5, rowY, { width: colWidths.amount - 10 });
    
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

// Generate filename
function generateFilename(format, title = 'laporan') {
  const timestamp = Date.now();
  const sanitizedTitle = title.replace(/[^a-z0-9]/gi, '_').toLowerCase();
  // Map format to correct extension
  const extMap = {
    'XLS': 'xlsx',
    'CSV': 'csv',
    'PDF': 'pdf'
  };
  const ext = extMap[format.toUpperCase()] || format.toLowerCase();
  return `${sanitizedTitle}_${timestamp}.${ext}`;
}

// Get MIME type
function getMimeType(format) {
  const mimeTypes = {
    'XLS': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'CSV': 'text/csv',
    'PDF': 'application/pdf'
  };
  return mimeTypes[format] || 'application/octet-stream';
}

// Format currency (IDR)
function formatCurrency(amount) {
  return new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    minimumFractionDigits: 0,
  }).format(amount);
}

// Format currency with separated Rp for alignment
function formatCurrencyAligned(amount) {
  const formatted = new Intl.NumberFormat('id-ID', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
  return {
    prefix: 'Rp',
    value: formatted
  };
}

// Format percentage
function formatPercentage(value) {
  return `${value.toFixed(2)}%`;
}

// Get month name in Indonesian
function getMonthName(monthIndex) {
  const months = [
    'JANUARI', 'FEBRUARI', 'MARET', 'APRIL', 'MEI', 'JUNI',
    'JULI', 'AGUSTUS', 'SEPTEMBER', 'OKTOBER', 'NOVEMBER', 'DESEMBER'
  ];
  return months[monthIndex];
}

// Export BukuKas to PDF using PDFKit (Minimalist, Simple, Elegant, Professional)
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
  
  // Format date helper
  const formatDateRange = () => {
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
  
  // Calculate percentages
  const profitPercentage = reportData.omzet.total > 0 ? (reportData.profit / reportData.omzet.total) * 100 : 0;
  const pengeluaranPercentage = reportData.omzet.total > 0 ? (reportData.pengeluaran.total / reportData.omzet.total) * 100 : 0;
  
  // Try to register Poppins font if available, otherwise use Helvetica
  let usePoppins = false;
  const fontsDir = path.join(__dirname, '../fonts');
  const poppinsDir = path.join(__dirname, '../../VERKAS/assets/fonts');
  
  // Try fonts directory first, then VERKAS assets
  const poppinsRegular = fs.existsSync(path.join(fontsDir, 'Poppins-Regular.ttf')) 
    ? path.join(fontsDir, 'Poppins-Regular.ttf')
    : path.join(poppinsDir, 'Poppins-Regular.ttf');
  const poppinsBold = fs.existsSync(path.join(fontsDir, 'Poppins-Bold.ttf'))
    ? path.join(fontsDir, 'Poppins-Bold.ttf')
    : path.join(poppinsDir, 'Poppins-Bold.ttf');
  const poppinsMedium = fs.existsSync(path.join(fontsDir, 'Poppins-Medium.ttf'))
    ? path.join(fontsDir, 'Poppins-Medium.ttf')
    : path.join(poppinsDir, 'Poppins-Medium.ttf');
  const poppinsSemiBold = fs.existsSync(path.join(fontsDir, 'Poppins-SemiBold.ttf'))
    ? path.join(fontsDir, 'Poppins-SemiBold.ttf')
    : path.join(poppinsDir, 'Poppins-SemiBold.ttf');
  
  try {
    if (fs.existsSync(poppinsRegular)) {
      doc.registerFont('Poppins', poppinsRegular);
      if (fs.existsSync(poppinsBold)) {
        doc.registerFont('Poppins-Bold', poppinsBold);
      } else {
        doc.registerFont('Poppins-Bold', poppinsRegular);
      }
      if (fs.existsSync(poppinsMedium)) {
        doc.registerFont('Poppins-Medium', poppinsMedium);
      } else {
        doc.registerFont('Poppins-Medium', poppinsRegular);
      }
      if (fs.existsSync(poppinsSemiBold)) {
        doc.registerFont('Poppins-SemiBold', poppinsSemiBold);
      } else {
        doc.registerFont('Poppins-SemiBold', poppinsBold || poppinsRegular);
      }
      usePoppins = true;
    }
  } catch (error) {
    // Silently fallback to Helvetica
  }
  
  const fontRegular = usePoppins ? 'Poppins' : 'Helvetica';
  const fontBold = usePoppins ? 'Poppins-Bold' : 'Helvetica-Bold';
  const fontMedium = usePoppins ? 'Poppins-Medium' : 'Helvetica-Bold';
  
  // ===== HEADER SECTION =====
  // Title
  doc.fillColor('#000000').fontSize(20).font(fontBold);
  doc.text('LAPORAN KEUANGAN', margin, y, { align: 'center', width: contentWidth });
  y += 24;
  
  // Branch Name
  doc.fontSize(13).font(fontRegular).fillColor('#000000');
  doc.text(branchName.toUpperCase(), margin, y, { align: 'center', width: contentWidth });
  y += 18;
  
  // Period
  doc.fontSize(9).font(fontRegular).fillColor('#666666');
  doc.text(formatDateRange(), margin, y, { align: 'center', width: contentWidth });
  y += 12;
  doc.text(`${getDaysInMonth()} Hari Kerja`, margin, y, { align: 'center', width: contentWidth });
  y += 28;
  
  // ===== OMZET SECTION =====
  checkNewPage(150);
  
  // Section Title
  doc.fillColor('#000000').fontSize(12).font(fontBold);
  doc.text('OMZET', margin, y);
  y += 18;
  
  // Total Omzet Box
  const omzetBoxY = y;
  doc.rect(margin, omzetBoxY, contentWidth, 36)
     .fillColor('#f8f9fa')
     .fill();
  doc.strokeColor('#e5e7eb').lineWidth(1);
  doc.rect(margin, omzetBoxY, contentWidth, 36).stroke();
  
  doc.fontSize(11).font(fontMedium).fillColor('#666666');
  doc.text('Total Omzet', margin + 12, omzetBoxY + 10);
  
  doc.font(fontBold).fontSize(16).fillColor('#000000');
  doc.text(formatCurrency(reportData.omzet.total), margin + 12, omzetBoxY + 10, { align: 'right', width: contentWidth - 24 });
  
  y = omzetBoxY + 44;
  
  // Sales Channel Breakdown
  if (reportData.omzet.salesChannel.length > 0) {
    doc.fontSize(10).font(fontMedium).fillColor('#000000');
    doc.text('Sales Channel', margin, y);
    y += 16;
    
    const rowHeight = 20;
    const col1Width = contentWidth * 0.60; // Name column
    const col2Width = contentWidth * 0.25; // Amount column
    const col3Width = contentWidth * 0.15; // Percentage column
    
    reportData.omzet.salesChannel.forEach((channel, index) => {
      checkNewPage(rowHeight + 2);
      
      const rowY = y;
      
      // Divider line (except first item)
      if (index > 0) {
        doc.strokeColor('#f0f0f0').lineWidth(0.5);
        doc.moveTo(margin + 8, rowY - 2).lineTo(pageWidth - margin - 8, rowY - 2).stroke();
      }
      
      // Channel name
      doc.fontSize(10).font(fontRegular).fillColor('#000000');
      doc.text(channel.name, margin + 8, rowY, { width: col1Width - 8 });
      
      // Amount
      doc.font(fontMedium).fontSize(10).fillColor('#000000');
      doc.text(formatCurrency(channel.amount), margin + col1Width, rowY, { 
        width: col2Width,
        align: 'right'
      });
      
      // Percentage
      doc.fontSize(9).font(fontRegular).fillColor('#666666');
      doc.text(formatPercentage(channel.percentage), margin + col1Width + col2Width, rowY, { 
        width: col3Width,
        align: 'right'
      });
      
      y += rowHeight;
    });
    
    y += 12;
  }
  
  y += 24;
  
  // ===== PENGELUARAN SECTION =====
  checkNewPage(150);
  
  // Section Title
  doc.fillColor('#000000').fontSize(12).font(fontBold);
  doc.text('PENGELUARAN', margin, y);
  y += 18;
  
  // Total Pengeluaran Box
  const pengeluaranBoxY = y;
  doc.rect(margin, pengeluaranBoxY, contentWidth, 36)
     .fillColor('#fef2f2')
     .fill();
  doc.strokeColor('#fee2e2').lineWidth(1);
  doc.rect(margin, pengeluaranBoxY, contentWidth, 36).stroke();
  
  doc.fontSize(11).font(fontMedium).fillColor('#666666');
  doc.text('Total Pengeluaran', margin + 12, pengeluaranBoxY + 10);
  
  doc.font(fontBold).fontSize(16).fillColor('#000000');
  doc.text(formatCurrency(reportData.pengeluaran.total), margin + 12, pengeluaranBoxY + 10, { align: 'right', width: contentWidth - 24 });
  
  y = pengeluaranBoxY + 44;
  
  // Breakdown Pengeluaran
  if (reportData.pengeluaran.breakdown.length > 0) {
    const rowHeight = 20;
    const col1Width = contentWidth * 0.60; // Name column
    const col2Width = contentWidth * 0.25; // Amount column
    const col3Width = contentWidth * 0.15; // Percentage column
    
    reportData.pengeluaran.breakdown.forEach((item, index) => {
      checkNewPage(rowHeight + 2);
      
      const rowY = y;
      
      // Divider line (except first item)
      if (index > 0) {
        doc.strokeColor('#f0f0f0').lineWidth(0.5);
        doc.moveTo(margin + 8, rowY - 2).lineTo(pageWidth - margin - 8, rowY - 2).stroke();
      }
      
      // Item name
      doc.fontSize(10).font(fontRegular).fillColor('#000000');
      doc.text(item.name, margin + 8, rowY, { width: col1Width - 8 });
      
      // Amount
      doc.font(fontMedium).fontSize(10).fillColor('#000000');
      doc.text(formatCurrency(item.amount), margin + col1Width, rowY, { 
        width: col2Width,
        align: 'right'
      });
      
      // Percentage
      doc.fontSize(9).font(fontRegular).fillColor('#666666');
      doc.text(formatPercentage(item.percentage), margin + col1Width + col2Width, rowY, { 
        width: col3Width,
        align: 'right'
      });
      
      y += rowHeight;
    });
    
    y += 12;
  }
  
  y += 24;
  
  // ===== PROFIT SECTION =====
  checkNewPage(80);
  
  // Profit Box
  const profitBoxY = y;
  const profitBgColor = reportData.profit < 0 ? '#fef2f2' : '#f0fdf4';
  const profitBorderColor = reportData.profit < 0 ? '#fee2e2' : '#dcfce7';
  const profitTextColor = reportData.profit < 0 ? '#dc2626' : '#16a34a';
  
  doc.rect(margin, profitBoxY, contentWidth, 36)
     .fillColor(profitBgColor)
     .fill();
  doc.strokeColor(profitBorderColor).lineWidth(1.5);
  doc.rect(margin, profitBoxY, contentWidth, 36).stroke();
  
  doc.fontSize(11).font(fontMedium).fillColor('#666666');
  doc.text('PROFIT', margin + 12, profitBoxY + 10);
  
  doc.font(fontBold).fontSize(16).fillColor(profitTextColor);
  doc.text(formatCurrency(reportData.profit), margin + 12, profitBoxY + 10, { align: 'right', width: contentWidth - 24 });
  
  y = profitBoxY + 44;
  
  // ===== BAGI HASIL SECTION =====
  checkNewPage(100);
  
  // Section Title
  doc.fillColor('#000000').fontSize(12).font(fontBold);
  doc.text('PEMBAGIAN HASIL', margin, y);
  y += 22;
  
  // Pusat Box
  const pusatBoxY = y;
  doc.rect(margin, pusatBoxY, contentWidth, 32)
     .fillColor('#f8f9fa')
     .fill();
  doc.strokeColor('#e5e7eb').lineWidth(1);
  doc.rect(margin, pusatBoxY, contentWidth, 32).stroke();
  
  doc.fontSize(10).font(fontRegular).fillColor('#666666');
  doc.text('Pusat (30%)', margin + 12, pusatBoxY + 8);
  
  doc.font(fontBold).fontSize(15).fillColor('#000000');
  doc.text(formatCurrency(reportData.bagiHasil.pusat), margin + 12, pusatBoxY + 8, { align: 'right', width: contentWidth - 24 });
  
  y = pusatBoxY + 40;
  
  // Mitra Box
  const mitraBoxY = y;
  doc.rect(margin, mitraBoxY, contentWidth, 32)
     .fillColor('#f8f9fa')
     .fill();
  doc.strokeColor('#e5e7eb').lineWidth(1);
  doc.rect(margin, mitraBoxY, contentWidth, 32).stroke();
  
  doc.fontSize(10).font(fontRegular).fillColor('#666666');
  doc.text('Mitra (70%)', margin + 12, mitraBoxY + 8);
  
  doc.font(fontBold).fontSize(15).fillColor('#000000');
  doc.text(formatCurrency(reportData.bagiHasil.mitra), margin + 12, mitraBoxY + 8, { align: 'right', width: contentWidth - 24 });
  
  y = mitraBoxY + 40;
  
  // ===== FOOTER - Simple & Minimalist =====
  const footerY = doc.page.height - 30;
  doc.fillColor('#999999').fontSize(8).font(fontRegular);
  doc.text(
    `Dibuat pada: ${new Date().toLocaleString('id-ID', { 
      day: '2-digit', 
      month: 'long', 
      year: 'numeric', 
      hour: '2-digit', 
      minute: '2-digit' 
    })}`,
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

module.exports = {
  exportToExcel,
  exportToCSV,
  exportToPDF,
  exportBukuKasToPDF,
  generateFilename,
  getMimeType,
  EXPORTS_DIR
};

