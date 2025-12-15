const Transaction = require('../models/Transaction');
const { query } = require('../config/database');
const config = require('../config/config');
const {
  formatDate,
  parseDate,
  getDayName,
  getMonthNameShort,
  formatDateLabel,
  formatMonthLabel,
  getWeekRange,
  getMonthRange,
  getYearRange
} = require('../utils/dateHelper');

// Helper: Format section for response
function formatSection(date, items, transactions, req) {
  const d = parseDate(date);
  const income = transactions
    .filter(t => t.type === 'income')
    .reduce((sum, t) => sum + parseFloat(t.amount), 0);
  const expense = transactions
    .filter(t => t.type === 'expense')
    .reduce((sum, t) => sum + parseFloat(t.amount), 0);
  
  // Get base URL from config (prioritize config over req)
  const baseUrl = config.baseUrl || `${req.protocol}://${req.get('host')}`;
  
  // Helper to convert path to full URL using baseUrl from config
  const pathToUrl = (path) => {
    if (!path) return null;
    if (path.startsWith('http://') || path.startsWith('https://')) {
      // Extract path from URL
      try {
        const urlObj = new URL(path);
        const urlPath = urlObj.pathname;
        // Always use baseUrl from config
        return `${baseUrl}${urlPath}`;
      } catch (e) {
        // If URL parsing fails, return as is
        return path;
      }
    }
    return `${baseUrl}${path.startsWith('/') ? path : '/' + path}`;
  };
  
  return {
    dateLabel: formatDateLabel(d, 'day'),
    dayLabel: getDayName(d),
    monthLabel: formatMonthLabel(d),
    headerIncome: income,
    headerExpense: expense,
    items: items.map(item => {
      // Parse lampiran if it's JSON string (array), otherwise use as string
      let lampiran = null;
      if (item.lampiran) {
        try {
          const parsed = JSON.parse(item.lampiran);
          // If parsed is array, convert each path to URL
          if (Array.isArray(parsed)) {
            lampiran = parsed.map(pathToUrl);
          } else {
            // Single value, convert to URL and wrap in array
            lampiran = [pathToUrl(parsed)];
          }
        } catch (e) {
          // If not JSON, use as string and convert to URL
          lampiran = [pathToUrl(item.lampiran)];
        }
      }
      
      return {
        transaction_id: item.id, // Add transaction ID for detail navigation
        category: item.category_name,
        note: item.note || '',
        amount: item.type === 'expense' ? -parseFloat(item.amount) : parseFloat(item.amount),
        lampiran: lampiran, // Always array or null with full URLs
        edit_accepted: item.edit_accepted !== undefined && item.edit_accepted !== null ? parseInt(item.edit_accepted) : 0 // 0 = default, 1 = pending, 2 = approved, 3 = rejected
      };
    })
  };
}

// Dashboard Harian
const getHarian = async (req, res, next) => {
  try {
    const { date } = req.query;
    
    // Get branch_id from middleware (getCurrentBranch already set req.branchId)
    // For admin: auto-assigned, for owner: from X-Branch-Id header
    const branchId = req.branchId;
    
    if (!branchId) {
      return res.status(400).json({
        success: false,
        message: 'Branch ID is required. Please provide X-Branch-Id header.'
      });
    }
    
    // Get transactions for the date (all users in branch, not just current user)
    const transactions = await Transaction.findAll({
      // userId: undefined, // Don't filter by user - show all transactions in branch
      branchId: branchId, // Already integer from middleware
      startDate: date,
      endDate: date,
      limit: 10000,
      page: 1
    });
    
    // Get summary (all users in branch, not just current user)
    const summary = await Transaction.getSummary({
      // userId: undefined, // Don't filter by user - show all transactions in branch
      branchId: branchId, // Already integer from middleware
      startDate: date,
      endDate: date
    });
    
    // Format title
    const d = parseDate(date);
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
    const title = `${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}`;
    
    // Group by date (should be same date for harian)
    const sections = transactions.length > 0 ? [formatSection(date, transactions, transactions, req)] : [];
    
    res.json({
      success: true,
      data: {
        title,
        summary,
        sections
      }
    });
  } catch (error) {
    next(error);
  }
};

// Dashboard Mingguan
const getMingguan = async (req, res, next) => {
  try {
    const { year, month, week } = req.query;
    
    // Get branch_id from middleware (getCurrentBranch already set req.branchId)
    const branchId = req.branchId;
    
    if (!branchId) {
      return res.status(400).json({
        success: false,
        message: 'Branch ID is required. Please provide X-Branch-Id header.'
      });
    }
    
    // Get week range
    const weekRange = getWeekRange(parseInt(year), parseInt(month), week ? parseInt(week) : 1);
    
    // Get all transactions in the month (no pagination limit for dashboard)
    // All users in branch, not just current user
    const monthRange = getMonthRange(parseInt(year), parseInt(month));
    const allTransactions = await Transaction.findAll({
      // userId: undefined, // Don't filter by user - show all transactions in branch
      branchId: branchId, // Already integer from middleware
      startDate: monthRange.start,
      endDate: monthRange.end,
      limit: 10000, // Large limit to get all transactions
      page: 1
    });
    
    // Group by week
    const weeks = [];
    for (let w = 1; w <= 5; w++) {
      const wr = getWeekRange(parseInt(year), parseInt(month), w);
      const weekTransactions = allTransactions.filter(t => {
        // Handle both date (YYYY-MM-DD) and datetime (YYYY-MM-DDTHH:mm:ss.sssZ) formats
        let tDate = t.transaction_date;
        
        // Convert to string if it's a Date object
        if (tDate instanceof Date) {
          tDate = tDate.toISOString().split('T')[0]; // Get YYYY-MM-DD
        } else if (typeof tDate === 'string') {
          if (tDate.includes('T')) {
            // Extract date part from datetime
            tDate = tDate.split('T')[0];
          }
        } else {
          // Skip if not a valid date
          return false;
        }
        
        // Compare dates as strings (YYYY-MM-DD format is sortable)
        return tDate >= wr.start && tDate <= wr.end;
      });
      
      // Always include week if it has transactions OR if it's the requested week
      if (weekTransactions.length > 0 || (week && w === parseInt(week))) {
        weeks.push({
          week: w,
          range: wr,
          transactions: weekTransactions
        });
      }
    }
    
    console.log('📅 getMingguan - allTransactions count:', allTransactions.length);
    console.log('📅 getMingguan - weeks count:', weeks.length);
    console.log('📅 getMingguan - monthRange:', monthRange);
    if (allTransactions.length > 0) {
      console.log('📅 getMingguan - sample transaction:', {
        date: allTransactions[0].transaction_date,
        type: allTransactions[0].type,
        amount: allTransactions[0].amount
      });
    }
    
    // Get summary for the month (all users in branch, not just current user)
    const summary = await Transaction.getSummary({
      // userId: undefined, // Don't filter by user - show all transactions in branch
      branchId: branchId, // Already integer from middleware
      startDate: monthRange.start,
      endDate: monthRange.end
    });
    
    // Format title
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
    const title = `${months[parseInt(month) - 1]} ${year}`;
    
    // Format sections
    const sections = weeks.map(w => {
      const startDate = parseDate(w.range.start);
      return formatSection(w.range.start, w.transactions, w.transactions, req);
    });
    
    res.json({
      success: true,
      data: {
        title,
        summary,
        sections
      }
    });
  } catch (error) {
    next(error);
  }
};

// Dashboard Bulanan - Returns all months in a year (for Bulanan tab)
const getBulananAll = async (req, res, next) => {
  try {
    const { year } = req.query;
    
    // Get branch_id from middleware (getCurrentBranch already set req.branchId)
    const branchId = req.branchId;
    
    if (!branchId) {
      return res.status(400).json({
        success: false,
        message: 'Branch ID is required. Please provide X-Branch-Id header.'
      });
    }
    
    // Get year range
    const yearRange = getYearRange(parseInt(year));
    
    console.log('📅 getBulananAll - yearRange:', yearRange);
    console.log('📅 getBulananAll - year:', year);
    console.log('📅 getBulananAll - branchId:', branchId);
    
    // Get transactions (no pagination limit for dashboard)
    // All users in branch, not just current user
    const transactions = await Transaction.findAll({
      // userId: undefined, // Don't filter by user - show all transactions in branch
      branchId: branchId, // Already integer from middleware
      startDate: yearRange.start,
      endDate: yearRange.end,
      limit: 10000, // Large limit to get all transactions
      page: 1
    });
    
    console.log('📅 getBulananAll - transactions count:', transactions.length);
    if (transactions.length > 0) {
      console.log('📅 getBulananAll - sample transaction:', {
        date: transactions[0].transaction_date,
        type: transactions[0].type,
        amount: transactions[0].amount
      });
    }
    
    // Get summary (all users in branch, not just current user)
    const summary = await Transaction.getSummary({
      // userId: undefined, // Don't filter by user - show all transactions in branch
      branchId: branchId, // Already integer from middleware
      startDate: yearRange.start,
      endDate: yearRange.end
    });
    
    // Group by month
    const transactionsByMonth = {};
    transactions.forEach(t => {
      // Handle both date (YYYY-MM-DD) and datetime (YYYY-MM-DDTHH:mm:ss.sssZ) formats
      // Extract date part directly to avoid timezone issues
      let dateStr = t.transaction_date;
      
      // Convert to string if it's a Date object
      if (dateStr instanceof Date) {
        dateStr = dateStr.toISOString().split('T')[0]; // Get YYYY-MM-DD
      } else if (typeof dateStr === 'string') {
        if (dateStr.includes('T')) {
          dateStr = dateStr.split('T')[0]; // Extract YYYY-MM-DD part
        }
      } else {
        console.error('❌ Invalid transaction_date type:', typeof dateStr, dateStr);
        return;
      }
      
      // Parse the date part
      const date = parseDate(dateStr);
      if (!date || isNaN(date.getTime())) {
        console.error('❌ Invalid transaction_date:', t.transaction_date, 'extracted:', dateStr);
        return;
      }
      
      // Use UTC methods to avoid timezone issues
      const year = date.getUTCFullYear();
      const month = date.getUTCMonth() + 1; // 1-12
      const monthKey = `${year}-${String(month).padStart(2, '0')}`;
      if (!transactionsByMonth[monthKey]) {
        transactionsByMonth[monthKey] = [];
      }
      transactionsByMonth[monthKey].push(t);
    });
    
    // Format title
    const title = String(year);
    
    // Format sections (sorted by month descending)
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
    const monthKeys = Object.keys(transactionsByMonth).sort((a, b) => b.localeCompare(a));
    
    console.log('📊 getBulananAll - monthKeys:', monthKeys);
    console.log('📊 getBulananAll - transactionsByMonth keys:', Object.keys(transactionsByMonth));
    
    const sections = monthKeys.map(monthKey => {
      const parts = monthKey.split('-');
      if (parts.length !== 2) {
        console.error('❌ Invalid monthKey format:', monthKey);
        return null;
      }
      const y = parts[0];
      const m = parts[1];
      const yearNum = parseInt(y, 10);
      const monthIndex = parseInt(m, 10);
      
      if (isNaN(yearNum) || yearNum < 2000 || yearNum > 2100) {
        console.error('❌ Invalid year:', y, 'from monthKey:', monthKey);
        return null;
      }
      
      if (isNaN(monthIndex) || monthIndex < 1 || monthIndex > 12) {
        console.error('❌ Invalid month index:', m, 'from monthKey:', monthKey);
        return null;
      }
      
      const firstDate = `${y}-${m}-01`;
      const testDate = parseDate(firstDate);
      if (isNaN(testDate.getTime())) {
        console.error('❌ Invalid date created from:', firstDate);
        return null;
      }
      
      const section = formatSection(firstDate, transactionsByMonth[monthKey], transactionsByMonth[monthKey], req);
      
      // Override dengan format untuk bulanan (per bulan dalam tahun)
      const monthName = months[monthIndex - 1]; // monthIndex is 1-12, array is 0-11
      if (!monthName) {
        console.error('❌ Month name not found for index:', monthIndex - 1);
        return null;
      }
      
      section.dateLabel = monthName;
      section.dayLabel = 'Bulan';
      section.monthLabel = String(yearNum); // Tahun
      
      return section;
    }).filter(s => s !== null); // Filter out null sections
    
    res.json({
      success: true,
      data: {
        title,
        summary,
        sections
      }
    });
  } catch (error) {
    next(error);
  }
};

// Dashboard Bulanan (single month)
const getBulanan = async (req, res, next) => {
  try {
    const { year, month } = req.query;
    
    // Get branch_id from middleware (getCurrentBranch already set req.branchId)
    const branchId = req.branchId;
    
    if (!branchId) {
      return res.status(400).json({
        success: false,
        message: 'Branch ID is required. Please provide X-Branch-Id header.'
      });
    }
    
    // Get month range
    const monthRange = getMonthRange(parseInt(year), parseInt(month));
    
    console.log('📅 getBulanan - monthRange:', monthRange);
    console.log('📅 getBulanan - year:', year, 'month:', month);
    console.log('📅 getBulanan - branchId:', branchId);
    
    // Get transactions (no pagination limit for dashboard)
    // All users in branch, not just current user
    const transactions = await Transaction.findAll({
      // userId: undefined, // Don't filter by user - show all transactions in branch
      branchId: branchId, // Already integer from middleware
      startDate: monthRange.start,
      endDate: monthRange.end,
      limit: 10000, // Large limit to get all transactions
      page: 1
    });
    
    console.log('📅 getBulanan - transactions count:', transactions.length);
    if (transactions.length > 0) {
      console.log('📅 getBulanan - sample transaction:', {
        date: transactions[0].transaction_date,
        type: transactions[0].type,
        amount: transactions[0].amount
      });
    }
    
    // Get summary (all users in branch, not just current user)
    const summary = await Transaction.getSummary({
      // userId: undefined, // Don't filter by user - show all transactions in branch
      branchId: branchId, // Already integer from middleware
      startDate: monthRange.start,
      endDate: monthRange.end
    });
    
    // Group by date
    const transactionsByDate = {};
    transactions.forEach(t => {
      // Handle both date (YYYY-MM-DD) and datetime (YYYY-MM-DDTHH:mm:ss.sssZ) formats
      let date = t.transaction_date;
      
      // Convert to string if it's a Date object
      if (date instanceof Date) {
        date = date.toISOString().split('T')[0]; // Get YYYY-MM-DD
      } else if (typeof date === 'string') {
        if (date.includes('T')) {
          // Extract date part from datetime
          date = date.split('T')[0];
        }
      } else {
        // Skip if not a valid date
        console.error('❌ Invalid transaction_date type:', typeof date, date);
        return;
      }
      
      if (!transactionsByDate[date]) {
        transactionsByDate[date] = [];
      }
      transactionsByDate[date].push(t);
    });
    
    // Format title
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
    const title = `${months[parseInt(month) - 1]} ${year}`;
    
    // Format sections (sorted by date descending)
    const dates = Object.keys(transactionsByDate).sort((a, b) => b.localeCompare(a));
    const sections = dates.map(date => formatSection(date, transactionsByDate[date], transactionsByDate[date], req));
    
    res.json({
      success: true,
      data: {
        title,
        summary,
        sections
      }
    });
  } catch (error) {
    next(error);
  }
};

// Dashboard Tahunan - Returns data grouped by YEAR (not month)
// This is used for the "Tahunan" tab which shows years, not months
const getTahunan = async (req, res, next) => {
  try {
    const { year } = req.query; // Optional: filter by specific year, or get all years
    
    // Get branch_id from middleware (getCurrentBranch already set req.branchId)
    const branchId = req.branchId;
    
    if (!branchId) {
      return res.status(400).json({
        success: false,
        message: 'Branch ID is required. Please provide X-Branch-Id header.'
      });
    }
    
    // Get all transactions (no date filter, or filter by year if provided)
    let startDate = null;
    let endDate = null;
    
    if (year) {
      // If year is provided, get transactions for that year only
      const yearRange = getYearRange(parseInt(year));
      startDate = yearRange.start;
      endDate = yearRange.end;
    } else {
      // If no year, get all transactions (for all years view)
      // We'll use a wide range, or better: get all transactions without date filter
      startDate = '2000-01-01'; // Start from year 2000
      endDate = '2100-12-31'; // End at year 2100
    }
    
    console.log('📅 getTahunan - startDate:', startDate, 'endDate:', endDate);
    console.log('📅 getTahunan - branchId:', branchId);
    
    // Get transactions (no pagination limit for dashboard)
    // All users in branch, not just current user
    const transactions = await Transaction.findAll({
      // userId: undefined, // Don't filter by user - show all transactions in branch
      branchId: branchId, // Already integer from middleware
      startDate: startDate,
      endDate: endDate,
      limit: 10000, // Large limit to get all transactions
      page: 1
    });
    
    console.log('📅 getTahunan - transactions count:', transactions.length);
    if (transactions.length > 0) {
      console.log('📅 getTahunan - sample transaction:', {
        date: transactions[0].transaction_date,
        type: transactions[0].type,
        amount: transactions[0].amount
      });
    }
    
    // Get summary for all transactions (all users in branch, not just current user)
    const summary = await Transaction.getSummary({
      // userId: undefined, // Don't filter by user - show all transactions in branch
      branchId: branchId, // Already integer from middleware
      startDate: startDate,
      endDate: endDate
    });
    
    // Group by YEAR (not month)
    const transactionsByYear = {};
    transactions.forEach(t => {
      // Handle both date (YYYY-MM-DD) and datetime (YYYY-MM-DDTHH:mm:ss.sssZ) formats
      // Extract date part directly to avoid timezone issues
      let dateStr = t.transaction_date;
      
      // Convert to string if it's a Date object
      if (dateStr instanceof Date) {
        dateStr = dateStr.toISOString().split('T')[0]; // Get YYYY-MM-DD
      } else if (typeof dateStr === 'string') {
        if (dateStr.includes('T')) {
          dateStr = dateStr.split('T')[0]; // Extract YYYY-MM-DD part
        }
      } else {
        console.error('❌ Invalid transaction_date type:', typeof dateStr, dateStr);
        return;
      }
      
      // Parse the date part
      const date = parseDate(dateStr);
      if (!date || isNaN(date.getTime())) {
        console.error('❌ Invalid transaction_date:', t.transaction_date, 'extracted:', dateStr);
        return;
      }
      
      // Use UTC methods to avoid timezone issues
      const year = date.getUTCFullYear();
      const yearKey = String(year);
      
      if (!transactionsByYear[yearKey]) {
        transactionsByYear[yearKey] = [];
      }
      transactionsByYear[yearKey].push(t);
    });
    
    // Format title - show selected year or "Semua Tahun"
    const title = year ? String(year) : 'Semua Tahun';
    
    // Format sections (sorted by year descending)
    const yearKeys = Object.keys(transactionsByYear).sort((a, b) => parseInt(b) - parseInt(a));
    
    console.log('📊 getTahunan - yearKeys:', yearKeys);
    console.log('📊 getTahunan - transactionsByYear keys:', Object.keys(transactionsByYear));
    
    const sections = yearKeys.map(yearKey => {
      const yearNum = parseInt(yearKey, 10);
      
      if (isNaN(yearNum) || yearNum < 2000 || yearNum > 2100) {
        console.error('❌ Invalid year:', yearKey);
        return null;
      }
      
      // Use first day of year for section date
      const firstDate = `${yearKey}-01-01`;
      const testDate = parseDate(firstDate);
      if (isNaN(testDate.getTime())) {
        console.error('❌ Invalid date created from:', firstDate);
        return null;
      }
      
      const section = formatSection(firstDate, transactionsByYear[yearKey], transactionsByYear[yearKey], req);
      
      // Override dengan format untuk tahunan (per tahun, bukan per bulan)
      section.dateLabel = yearKey; // Tahun sebagai dateLabel
      section.dayLabel = 'Tahun';
      section.monthLabel = ''; // Kosongkan monthLabel karena ini per tahun
      
      console.log(`✅ Section formatted - dateLabel: ${section.dateLabel}, dayLabel: ${section.dayLabel}`);
      
      return section;
    }).filter(s => s !== null); // Filter out null sections
    
    res.json({
      success: true,
      data: {
        title,
        summary,
        sections
      }
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getHarian,
  getMingguan,
  getBulanan,
  getBulananAll,
  getTahunan
};

