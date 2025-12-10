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

// Export to PDF
async function exportToPDF(data, filename, title) {
  const filepath = path.join(EXPORTS_DIR, filename);
  const doc = new PDFDocument();
  
  doc.pipe(fs.createWriteStream(filepath));
  
  // Title
  doc.fontSize(18).text(title || 'Laporan Keuangan', { align: 'center' });
  doc.moveDown();
  
  // Table header
  const tableTop = doc.y;
  const itemHeight = 20;
  const pageWidth = doc.page.width;
  const margin = 50;
  const tableWidth = pageWidth - 2 * margin;
  
  const colWidths = {
    date: tableWidth * 0.15,
    category: tableWidth * 0.25,
    type: tableWidth * 0.15,
    amount: tableWidth * 0.25,
    note: tableWidth * 0.20
  };
  
  // Header
  doc.fontSize(10).font('Helvetica-Bold');
  doc.text('Tanggal', margin, tableTop, { width: colWidths.date });
  doc.text('Kategori', margin + colWidths.date, tableTop, { width: colWidths.category });
  doc.text('Tipe', margin + colWidths.date + colWidths.category, tableTop, { width: colWidths.type });
  doc.text('Jumlah', margin + colWidths.date + colWidths.category + colWidths.type, tableTop, { width: colWidths.amount });
  doc.text('Keterangan', margin + colWidths.date + colWidths.category + colWidths.type + colWidths.amount, tableTop, { width: colWidths.note });
  
  // Data rows
  doc.font('Helvetica').fontSize(9);
  let y = tableTop + itemHeight;
  
  data.forEach((item, index) => {
    if (y > doc.page.height - 50) {
      doc.addPage();
      y = 50;
    }
    
    doc.text(item.transaction_date, margin, y, { width: colWidths.date });
    doc.text(item.category_name, margin + colWidths.date, y, { width: colWidths.category });
    doc.text(item.type === 'income' ? 'Pemasukan' : 'Pengeluaran', margin + colWidths.date + colWidths.category, y, { width: colWidths.type });
    doc.text(item.amount.toString(), margin + colWidths.date + colWidths.category + colWidths.type, y, { width: colWidths.amount });
    doc.text(item.note || '', margin + colWidths.date + colWidths.category + colWidths.type + colWidths.amount, y, { width: colWidths.note });
    
    y += itemHeight;
  });
  
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

// Export BukuKas to PDF (format sama seperti BukuKasScreen)
async function exportBukuKasToPDF(reportData, filename, branchName, selectedMonth) {
  const filepath = path.join(EXPORTS_DIR, filename);
  const doc = new PDFDocument({ margin: 50, size: 'A4' });
  
  doc.pipe(fs.createWriteStream(filepath));
  
  const pageWidth = doc.page.width;
  const margin = 50;
  const contentWidth = pageWidth - 2 * margin;
  let y = margin;
  
  // Helper function to check if need new page
  const checkNewPage = (requiredHeight) => {
    if (y + requiredHeight > doc.page.height - 50) {
      doc.addPage();
      y = margin;
      return true;
    }
    return false;
  };
  
  // Helper function to convert hex to RGB with opacity
  const hexToRgbWithOpacity = (hex, opacity = 0.1) => {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    if (!result) return null;
    return {
      r: parseInt(result[1], 16),
      g: parseInt(result[2], 16),
      b: parseInt(result[3], 16),
      opacity: opacity
    };
  };
  
  // Helper function to draw section box
  const drawSectionBox = (title, icon, color) => {
    checkNewPage(80);
    
    // Convert hex color to RGB with opacity for fill
    const fillRgb = hexToRgbWithOpacity(color, 0.1);
    const strokeRgb = hexToRgbWithOpacity(color, 0.4);
    
    // Draw rounded rectangle with fill and stroke
    if (fillRgb) {
      doc.save();
      doc.roundedRect(margin, y, contentWidth, 50, 8);
      doc.opacity(fillRgb.opacity);
      doc.fillColor(`rgb(${fillRgb.r}, ${fillRgb.g}, ${fillRgb.b})`);
      doc.fill();
      doc.restore();
      
      if (strokeRgb) {
        doc.save();
        doc.opacity(strokeRgb.opacity);
        doc.strokeColor(`rgb(${strokeRgb.r}, ${strokeRgb.g}, ${strokeRgb.b})`);
        doc.lineWidth(1);
        doc.roundedRect(margin, y, contentWidth, 50, 8);
        doc.stroke();
        doc.restore();
      }
    } else {
      doc.roundedRect(margin, y, contentWidth, 50, 8)
         .fillAndStroke(color, color);
    }
    
    doc.fontSize(16).font('Helvetica-Bold').fillColor('#1f2937');
    doc.text(title, margin + 60, y + 15, { width: contentWidth - 70 });
    
    y += 60;
  };
  
  // Report Header
  doc.fontSize(24).font('Helvetica-Bold').fillColor('#10b981');
  doc.text('KESIMPULAN KAS', margin, y, { align: 'center', width: contentWidth });
  y += 30;
  
  doc.fontSize(18).font('Helvetica-Bold').fillColor('#1f2937');
  doc.text(branchName.toUpperCase(), margin, y, { align: 'center', width: contentWidth });
  y += 40;
  
  // Period
  const year = selectedMonth.getFullYear();
  const month = selectedMonth.getMonth();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const monthName = getMonthName(month);
  
  doc.fontSize(12).font('Helvetica').fillColor('#6b7280');
  doc.text(
    `01 - ${String(daysInMonth).padStart(2, '0')} ${monthName} ${year}`,
    margin,
    y,
    { align: 'center', width: contentWidth }
  );
  y += 20;
  
  doc.fontSize(10).fillColor('#6b7280');
  doc.text(
    `${daysInMonth} Hari Kerja`,
    margin,
    y,
    { align: 'center', width: contentWidth }
  );
  y += 40;
  
  // Omzet Section
  drawSectionBox('Omzet', '📈', '#3b82f6');
  
  // Total Omzet
  doc.fontSize(14).font('Helvetica').fillColor('#6b7280');
  doc.text('Total Omzet', margin + 20, y);
  
  doc.fontSize(20).font('Helvetica-Bold').fillColor('#1f2937');
  const totalOmzetText = formatCurrency(reportData.omzet.total);
  const totalOmzetWidth = doc.widthOfString(totalOmzetText);
  doc.text(totalOmzetText, pageWidth - margin - 20 - totalOmzetWidth, y);
  y += 25;
  
  doc.fontSize(10).font('Helvetica').fillColor('#6b7280');
  doc.text('100%', pageWidth - margin - 20 - doc.widthOfString('100%'), y);
  y += 30;
  
  // Sales Channel
  doc.fontSize(12).font('Helvetica-Bold').fillColor('#1f2937');
  doc.text('Sales Channel', margin + 20, y);
  y += 25;
  
  if (reportData.omzet.salesChannel.length > 0) {
    reportData.omzet.salesChannel.forEach((channel, index) => {
      checkNewPage(30);
      
      doc.fontSize(11).font('Helvetica').fillColor('#1f2937');
      doc.text(channel.name, margin + 20, y, { width: contentWidth - 200 });
      
      const amountText = formatCurrency(channel.amount);
      const amountWidth = doc.widthOfString(amountText);
      doc.text(amountText, pageWidth - margin - 20 - amountWidth, y);
      
      y += 15;
      
      doc.fontSize(9).font('Helvetica').fillColor('#6b7280');
      doc.text(formatPercentage(channel.percentage), margin + 20, y);
      
      y += 20;
      
      if (index < reportData.omzet.salesChannel.length - 1) {
        doc.moveTo(margin + 20, y - 5)
           .lineTo(pageWidth - margin - 20, y - 5)
           .strokeColor('#e5e7eb')
           .lineWidth(0.5)
           .stroke();
        y += 10;
      }
    });
  } else {
    doc.fontSize(11).font('Helvetica').fillColor('#6b7280');
    doc.text('Tidak ada data', margin + 20, y);
    y += 20;
  }
  
  y += 20;
  
  // Pengeluaran Section
  drawSectionBox('Pengeluaran', '📉', '#ef4444');
  
  // Total Pengeluaran
  doc.fontSize(18).font('Helvetica-Bold').fillColor('#1f2937');
  const totalPengeluaranText = formatCurrency(reportData.pengeluaran.total);
  const totalPengeluaranWidth = doc.widthOfString(totalPengeluaranText);
  doc.text(totalPengeluaranText, pageWidth - margin - 20 - totalPengeluaranWidth, y);
  
  const pengeluaranPercentage = reportData.omzet.total > 0 
    ? (reportData.pengeluaran.total / reportData.omzet.total) * 100 
    : 0;
  doc.fontSize(10).font('Helvetica').fillColor('#6b7280');
  doc.text(
    formatPercentage(pengeluaranPercentage),
    pageWidth - margin - 20 - doc.widthOfString(formatPercentage(pengeluaranPercentage)),
    y + 20
  );
  y += 50;
  
  // Expense Breakdown
  if (reportData.pengeluaran.breakdown.length > 0) {
    reportData.pengeluaran.breakdown.forEach((item, index) => {
      checkNewPage(30);
      
      doc.fontSize(11).font('Helvetica').fillColor('#1f2937');
      doc.text(item.name, margin + 20, y, { width: contentWidth - 200 });
      
      const amountText = formatCurrency(item.amount);
      const amountWidth = doc.widthOfString(amountText);
      doc.text(amountText, pageWidth - margin - 20 - amountWidth, y);
      
      y += 15;
      
      doc.fontSize(9).font('Helvetica').fillColor('#6b7280');
      doc.text(formatPercentage(item.percentage), margin + 20, y);
      
      y += 20;
      
      if (index < reportData.pengeluaran.breakdown.length - 1) {
        doc.moveTo(margin + 20, y - 5)
           .lineTo(pageWidth - margin - 20, y - 5)
           .strokeColor('#e5e7eb')
           .lineWidth(0.5)
           .stroke();
        y += 10;
      }
    });
  }
  
  y += 20;
  
  // Profit Section
  checkNewPage(60);
  const isProfitNegative = reportData.profit < 0;
  const profitColor = isProfitNegative ? '#ef4444' : '#10b981';
  const profitFillRgb = hexToRgbWithOpacity(profitColor, 0.2);
  const profitStrokeRgb = hexToRgbWithOpacity(profitColor, 0.4);
  
  if (profitFillRgb) {
    doc.save();
    doc.roundedRect(margin, y, contentWidth, 60, 12);
    doc.opacity(profitFillRgb.opacity);
    doc.fillColor(`rgb(${profitFillRgb.r}, ${profitFillRgb.g}, ${profitFillRgb.b})`);
    doc.fill();
    doc.restore();
    
    if (profitStrokeRgb) {
      doc.save();
      doc.opacity(profitStrokeRgb.opacity);
      doc.strokeColor(`rgb(${profitStrokeRgb.r}, ${profitStrokeRgb.g}, ${profitStrokeRgb.b})`);
      doc.lineWidth(1);
      doc.roundedRect(margin, y, contentWidth, 60, 12);
      doc.stroke();
      doc.restore();
    }
  } else {
    doc.roundedRect(margin, y, contentWidth, 60, 12)
       .fillAndStroke(profitColor, profitColor);
  }
  
  doc.fontSize(18).font('Helvetica-Bold').fillColor('#1f2937');
  doc.text('Profit', margin + 60, y + 18);
  
  doc.fontSize(24).font('Helvetica-Bold').fillColor(profitColor);
  const profitText = formatCurrency(reportData.profit);
  const profitWidth = doc.widthOfString(profitText);
  doc.text(profitText, pageWidth - margin - 20 - profitWidth, y + 15);
  
  const profitPercentage = reportData.omzet.total > 0 
    ? (reportData.profit / reportData.omzet.total) * 100 
    : 0;
  doc.fontSize(10).font('Helvetica').fillColor('#6b7280');
  doc.text(
    formatPercentage(profitPercentage),
    pageWidth - margin - 20 - doc.widthOfString(formatPercentage(profitPercentage)),
    y + 40
  );
  
  y += 80;
  
  // Bagi Hasil Section
  drawSectionBox('Bagi Hasil', '🤝', '#a855f7');
  
  // Pusat
  doc.fontSize(11).font('Helvetica').fillColor('#1f2937');
  doc.text('Pusat', margin + 20, y);
  doc.fontSize(10).font('Helvetica').fillColor('#6b7280');
  doc.text('30%', pageWidth - margin - 20 - doc.widthOfString('30%'), y);
  y += 20;
  
  doc.fontSize(16).font('Helvetica-Bold').fillColor('#1f2937');
  const pusatText = formatCurrency(reportData.bagiHasil.pusat);
  doc.text(pusatText, margin + 20, y);
  y += 40;
  
  // Mitra
  doc.fontSize(11).font('Helvetica').fillColor('#1f2937');
  doc.text('Mitra', margin + 20, y);
  doc.fontSize(10).font('Helvetica').fillColor('#6b7280');
  doc.text('70%', pageWidth - margin - 20 - doc.widthOfString('70%'), y);
  y += 20;
  
  doc.fontSize(16).font('Helvetica-Bold').fillColor('#1f2937');
  const mitraText = formatCurrency(reportData.bagiHasil.mitra);
  doc.text(mitraText, margin + 20, y);
  y += 40;
  
  // Stok Persediaan Section
  drawSectionBox('Stok Persediaan', '📦', '#f59e0b');
  
  // Awal
  doc.fontSize(10).font('Helvetica').fillColor('#6b7280');
  doc.text('Awal', margin + 20, y);
  y += 15;
  
  doc.fontSize(16).font('Helvetica-Bold').fillColor('#1f2937');
  const awalText = formatCurrency(reportData.stokPersediaan.awal);
  doc.text(awalText, margin + 20, y);
  y += 40;
  
  // Akhir
  doc.fontSize(10).font('Helvetica').fillColor('#6b7280');
  doc.text('Akhir', margin + 20, y);
  y += 15;
  
  doc.fontSize(16).font('Helvetica-Bold').fillColor('#1f2937');
  const akhirText = formatCurrency(reportData.stokPersediaan.akhir);
  doc.text(akhirText, margin + 20, y);
  
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

