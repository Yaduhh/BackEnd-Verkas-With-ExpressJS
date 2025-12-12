const Transaction = require('../models/Transaction');
const Category = require('../models/Category');
const {
  exportToExcel,
  exportToCSV,
  exportToPDF,
  exportBukuKasToPDF,
  generateFilename,
  getMimeType
} = require('../utils/exportHelper');
const fs = require('fs');

// Export report
const exportReport = async (req, res, next) => {
  try {
    // Support both GET (query params) and POST (body)
    const source = req.method === 'GET' ? req.query : req.body;
    
    const {
      title = 'Laporan Keuangan',
      from_date,
      to_date,
      category,
      format = 'XLS',
      include_deleted = false
    } = source;
    
    const userId = req.userId;
    
    // Get branch_id from header or middleware
    const branchId = req.branchId || req.headers['x-branch-id'];
    
    if (!branchId) {
      return res.status(400).json({
        success: false,
        message: 'Branch ID is required. Please provide X-Branch-Id header.'
      });
    }
    
    // Verify branch access
    const Branch = require('../models/Branch');
    const hasAccess = await Branch.userHasAccess(userId, parseInt(branchId), req.user.role);
    if (!hasAccess) {
      return res.status(403).json({
        success: false,
        message: 'No access to this branch'
      });
    }
    
    // Build query params - JANGAN filter berdasarkan userId karena admin bisa input transaksi
    // Hanya filter berdasarkan branchId untuk mengambil semua transaksi di branch tersebut
    const queryParams = {
      branchId: parseInt(branchId),
      startDate: from_date,
      endDate: to_date,
      includeDeleted: include_deleted === true || include_deleted === 'true'
    };
    
    if (category && category !== 'Semua Kategori') {
      queryParams.category = category;
    }
    
    // Get transactions - semua transaksi di branch, bukan hanya yang dibuat oleh user tertentu
    const transactions = await Transaction.findAll({
      ...queryParams,
      sort: 'terbaru',
      page: 1,
      limit: 10000 // Large limit for export
    });
    
    if (transactions.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'No transactions found for the selected period'
      });
    }
    
    // Generate filename
    const filename = generateFilename(format, title);
    
    // Export based on format
    let filepath;
    switch (format.toUpperCase()) {
      case 'XLS':
        filepath = await exportToExcel(transactions, filename, title);
        break;
      case 'CSV':
        filepath = await exportToCSV(transactions, filename);
        break;
      case 'PDF':
        // For PDF, use BukuKas format (calculate report first)
        const allCategories = await Category.findAll({ branchId: parseInt(branchId) });
        const daysInMonth = from_date && to_date 
          ? Math.ceil((new Date(to_date) - new Date(from_date)) / (1000 * 60 * 60 * 24)) + 1
          : 30;
        const reportData = calculateReport(transactions, allCategories, daysInMonth);
        
        // Get branch info
        const Branch = require('../models/Branch');
        const branch = await Branch.findById(parseInt(branchId));
        const branchName = branch ? branch.name : 'Branch';
        
        // Create date object for selected period
        const selectedDate = from_date ? new Date(from_date) : new Date();
        
        filepath = await exportBukuKasToPDF(reportData, filename, branchName, selectedDate, {
          fromDate: from_date,
          toDate: to_date,
          title: title,
        });
        break;
      default:
        return res.status(400).json({
          success: false,
          message: 'Invalid format. Must be XLS, CSV, or PDF'
        });
    }
    
    // Send file
    res.setHeader('Content-Type', getMimeType(format));
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    
    const fileStream = fs.createReadStream(filepath);
    fileStream.pipe(res);
    
    // Clean up file after sending
    fileStream.on('end', () => {
      setTimeout(() => {
        fs.unlink(filepath, (err) => {
          if (err) console.error('Error deleting export file:', err);
        });
      }, 5000); // Delete after 5 seconds
    });
  } catch (error) {
    next(error);
  }
};

// Calculate financial report (same logic as BukuKasScreen)
function calculateReport(transactions, categories, workingDays) {
  // Calculate Omzet (Income)
  const incomeTransactions = transactions.filter(t => t.type === 'income');
  const totalOmzet = incomeTransactions.reduce((sum, t) => sum + parseFloat(t.amount.toString()), 0);
  
  // Group income transactions by category
  const salesChannelByCategory = {};
  incomeTransactions.forEach(t => {
    const categoryName = t.category_name || 'Lain-Lain';
    salesChannelByCategory[categoryName] = (salesChannelByCategory[categoryName] || 0) + parseFloat(t.amount.toString());
  });

  // Convert to array and sort by amount (descending)
  const salesChannel = Object.entries(salesChannelByCategory)
    .map(([name, amount]) => ({
      name,
      amount,
      percentage: totalOmzet > 0 ? (amount / totalOmzet) * 100 : 0,
    }))
    .sort((a, b) => b.amount - a.amount);

  const pendapatanLain = 0; // Can be calculated from specific categories

  // Calculate Pengeluaran (Expenses)
  const expenseTransactions = transactions.filter(t => t.type === 'expense');
  const totalPengeluaran = expenseTransactions.reduce((sum, t) => sum + parseFloat(t.amount.toString()), 0);

  // Group expenses by category
  const expenseByCategory = {};
  expenseTransactions.forEach(t => {
    const categoryName = t.category_name || 'Lain-Lain';
    expenseByCategory[categoryName] = (expenseByCategory[categoryName] || 0) + parseFloat(t.amount.toString());
  });

  const expenseBreakdown = Object.entries(expenseByCategory).map(([name, amount]) => ({
    name,
    amount,
    percentage: totalPengeluaran > 0 ? (amount / totalPengeluaran) * 100 : 0,
  })).sort((a, b) => b.amount - a.amount);

  // Calculate Profit
  const profit = totalOmzet - totalPengeluaran;

  // Calculate Bagi Hasil (30% Pusat, 70% Mitra)
  const bagiHasil = {
    pusat: profit * 0.3,
    mitra: profit * 0.7,
  };

  // Stok Persediaan (placeholder - you may need to implement inventory tracking)
  const stokPersediaan = {
    awal: 0,
    akhir: 0,
  };

  return {
    omzet: {
      total: totalOmzet,
      pendapatanLain,
      salesChannel,
    },
    pengeluaran: {
      total: totalPengeluaran,
      breakdown: expenseBreakdown,
    },
    profit,
    bagiHasil,
    stokPersediaan,
  };
}

// Export BukuKas report
const exportBukuKas = async (req, res, next) => {
  try {
    // Support both GET (query params) and POST (body)
    const source = req.method === 'GET' ? req.query : req.body;
    
    const {
      title = 'Kesimpulan Kas',
      month, // Format: YYYY-MM (e.g., "2024-01")
      year, // Format: YYYY
    } = source;
    
    const userId = req.userId;
    
    // Get branch_id from header or middleware
    const branchId = req.branchId || req.headers['x-branch-id'];
    
    if (!branchId) {
      return res.status(400).json({
        success: false,
        message: 'Branch ID is required. Please provide X-Branch-Id header.'
      });
    }
    
    // Verify branch access
    const Branch = require('../models/Branch');
    const hasAccess = await Branch.userHasAccess(userId, parseInt(branchId), req.user.role);
    if (!hasAccess) {
      return res.status(403).json({
        success: false,
        message: 'No access to this branch'
      });
    }
    
    // Get branch info
    const branch = await Branch.findById(parseInt(branchId));
    if (!branch) {
      return res.status(404).json({
        success: false,
        message: 'Branch not found'
      });
    }
    
    // Calculate date range for selected month
    let selectedYear, selectedMonth;
    if (month && year) {
      // If month and year provided separately
      selectedYear = parseInt(year);
      selectedMonth = parseInt(month) - 1; // month is 0-indexed in JS Date
    } else if (month) {
      // If month format is YYYY-MM
      const parts = month.split('-');
      selectedYear = parseInt(parts[0]);
      selectedMonth = parseInt(parts[1]) - 1;
    } else {
      // Default to current month
      const now = new Date();
      selectedYear = now.getFullYear();
      selectedMonth = now.getMonth();
    }
    
    const startDate = `${selectedYear}-${String(selectedMonth + 1).padStart(2, '0')}-01`;
    const daysInMonth = new Date(selectedYear, selectedMonth + 1, 0).getDate();
    const endDate = `${selectedYear}-${String(selectedMonth + 1).padStart(2, '0')}-${String(daysInMonth).padStart(2, '0')}`;
    
    // Get transactions - semua transaksi di branch, bukan hanya yang dibuat oleh user tertentu
    const transactions = await Transaction.findAll({
      branchId: parseInt(branchId),
      startDate,
      endDate,
      sort: 'terbaru',
      page: 1,
      limit: 10000 // Large limit for export
    });
    
    // Get categories (for future use if needed)
    const allCategories = await Category.findAll({ branchId: parseInt(branchId) });
    
    // Calculate report
    const reportData = calculateReport(transactions, allCategories, daysInMonth);
    
    // Generate filename
    const filename = generateFilename('PDF', title);
    
    // Create Date object for selected month
    const selectedMonthDate = new Date(selectedYear, selectedMonth, 1);
    
    // Export to PDF
    const filepath = await exportBukuKasToPDF(reportData, filename, branch.name, selectedMonthDate);
    
    // Send file
    res.setHeader('Content-Type', getMimeType('PDF'));
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    
    const fileStream = fs.createReadStream(filepath);
    fileStream.pipe(res);
    
    // Clean up file after sending
    fileStream.on('end', () => {
      setTimeout(() => {
        fs.unlink(filepath, (err) => {
          if (err) console.error('Error deleting export file:', err);
        });
      }, 5000); // Delete after 5 seconds
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  exportReport,
  exportBukuKas
};

