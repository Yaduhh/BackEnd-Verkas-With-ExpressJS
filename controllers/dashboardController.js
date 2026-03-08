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
        category: item.category_name || '-',
        note: item.note || '',
        amount: item.type === 'expense' ? -parseFloat(item.amount) : parseFloat(item.amount),
        pb1: item.pb1 ? parseFloat(item.pb1) : null,
        lampiran: lampiran, // Always array or null with full URLs
        user_name: item.user_name || null,
        edit_accepted: item.edit_accepted !== undefined && item.edit_accepted !== null ? parseInt(item.edit_accepted) : 0, // 0 = default, 1 = pending, 2 = approved, 3 = rejected
        is_debt_payment: item.is_debt_payment === true || item.is_debt_payment === 1 || item.is_debt_payment === '1', // Pembayaran hutang
        paid_amount: item.paid_amount !== undefined && item.paid_amount !== null ? parseFloat(item.paid_amount) : null,
        parent_transaction_id: item.parent_transaction_id || null,
        created_at: item.created_at || item.updated_at || item.createdAt || null,
        is_pb1_payment: item.is_pb1_payment === true || item.is_pb1_payment === 1 || item.is_pb1_payment === '1',
        category_id: item.category_id || null
      };
    })
  };
}

// Helper: Calculate trend against previous period
async function calculateTrend(branchId, periodType, params, currentSummary, isUmum, hasPb1) {
  let prevStart = null;
  let prevEnd = null;

  try {
    switch (periodType) {
      case 'Harian': {
        const { finalStartDate, finalEndDate } = params;
        const startObj = parseDate(finalStartDate);
        const endObj = parseDate(finalEndDate);

        // Calculate diff in days
        const diffTime = Math.abs(endObj - startObj);
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

        const prevEndObj = new Date(startObj);
        prevEndObj.setDate(prevEndObj.getDate() - 1);

        const prevStartObj = new Date(prevEndObj);
        prevStartObj.setDate(prevStartObj.getDate() - diffDays);

        prevStart = formatDate(prevStartObj);
        prevEnd = formatDate(prevEndObj);
        break;
      }
      case 'Mingguan': {
        const currentYear = parseInt(params.year);
        const currentMonth = parseInt(params.month);
        const currentWeek = parseInt(params.week) || 1;

        const currentRange = getWeekRange(currentYear, currentMonth, currentWeek);
        const curStartObj = parseDate(currentRange.start);

        const prevEndObj = new Date(curStartObj);
        prevEndObj.setDate(prevEndObj.getDate() - 1);
        const prevStartObj = new Date(prevEndObj);
        prevStartObj.setDate(prevStartObj.getDate() - 6);

        prevStart = formatDate(prevStartObj);
        prevEnd = formatDate(prevEndObj);
        break;
      }
      case 'BulananAll': {
        const prevYearRange = getYearRange(parseInt(params.year) - 1);
        prevStart = prevYearRange.start;
        prevEnd = prevYearRange.end;
        break;
      }
      case 'Bulanan': {
        const currentYear = parseInt(params.year);
        const currentMonth = parseInt(params.month);
        let prevYear = currentYear;
        let prevMonth = currentMonth - 1;
        if (prevMonth < 1) {
          prevMonth = 12;
          prevYear -= 1;
        }
        const prevMonthRange = getMonthRange(prevYear, prevMonth);
        prevStart = prevMonthRange.start;
        prevEnd = prevMonthRange.end;
        break;
      }
      case 'Tahunan': {
        if (params.year) {
          const prevYearRange = getYearRange(parseInt(params.year) - 1);
          prevStart = prevYearRange.start;
          prevEnd = prevYearRange.end;
        } else {
          return null; // Cannot compare if all years are selected
        }
        break;
      }
    }

    if (!prevStart || !prevEnd) return null;

    const prevSummary = await Transaction.getSummary({
      branchId,
      startDate: prevStart,
      endDate: prevEnd,
      isUmum: isUmum,
      hasPb1: hasPb1
    });

    const calculateChange = (current, previous) => {
      const curVal = Number(current) || 0;
      const prevVal = Number(previous) || 0;

      if (prevVal === 0) {
        if (curVal === 0) return { pctStr: '0.0%', isUp: true };
        return { pctStr: '+100.0%', isUp: true };
      }

      const pct = ((curVal - prevVal) / Math.abs(prevVal)) * 100;
      const isUp = pct >= 0;
      const sign = isUp ? '+' : '';
      return { pctStr: `${sign}${pct.toFixed(1)}%`, isUp };
    };

    const incTrend = calculateChange(currentSummary.pemasukan, prevSummary.pemasukan);
    const expTrend = calculateChange(currentSummary.pengeluaran, prevSummary.pengeluaran);
    const salTrend = calculateChange(currentSummary.saldo, prevSummary.saldo);

    return {
      inc: incTrend.pctStr,
      incUp: incTrend.isUp,
      exp: expTrend.pctStr,
      expUp: expTrend.isUp,
      expDesc: expTrend.isUp ? '(Naik)' : '(Hemat)',
      sal: salTrend.pctStr,
      salUp: salTrend.isUp
    };
  } catch (error) {
    console.error('Trend calculation error:', error);
    return null;
  }
}

// Dashboard Harian
const getHarian = async (req, res, next) => {
  try {
    const { date } = req.query;
    const branchId = req.branchId;

    if (!branchId) {
      return res.status(400).json({
        success: false,
        message: 'Branch ID is required. Please provide X-Branch-Id header.'
      });
    }

    const finalStartDate = req.query.startDate || date;
    const finalEndDate = req.query.endDate || date;
    const isUmum = req.query.is_umum === 'all' ? undefined : (req.query.is_umum === 'false' ? false : true);
    const hasPb1 = req.query.has_pb1 === 'true';

    const transactions = await Transaction.findAll({
      branchId: branchId,
      startDate: finalStartDate,
      endDate: finalEndDate,
      limit: 10000,
      page: 1,
      isUmum: isUmum,
      hasPb1: hasPb1
    });

    const summary = await Transaction.getSummary({
      branchId: branchId,
      startDate: finalStartDate,
      endDate: finalEndDate,
      isUmum: isUmum,
      hasPb1: hasPb1
    });

    summary.trend = await calculateTrend(branchId, 'Harian', { finalStartDate, finalEndDate }, summary, isUmum, hasPb1) || null;

    const transactionsByDate = {};
    transactions.forEach(t => {
      let dateStr = t.transaction_date;
      if (dateStr instanceof Date) {
        dateStr = formatDate(dateStr);
      } else if (typeof dateStr === 'string' && dateStr.includes('T')) {
        dateStr = dateStr.split('T')[0];
      }

      if (!transactionsByDate[dateStr]) {
        transactionsByDate[dateStr] = [];
      }
      transactionsByDate[dateStr].push(t);
    });

    let title = '';
    const startObj = parseDate(finalStartDate);
    const endObj = parseDate(finalEndDate);
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];

    if (finalStartDate === finalEndDate) {
      title = `${startObj.getDate()} ${months[startObj.getMonth()]} ${startObj.getFullYear()}`;
    } else {
      title = `${startObj.getDate()} ${months[startObj.getMonth()]} - ${endObj.getDate()} ${months[endObj.getMonth()]} ${endObj.getFullYear()}`;
    }

    const sortedDates = Object.keys(transactionsByDate).sort((a, b) => b.localeCompare(a));
    const sections = sortedDates.map(d => formatSection(d, transactionsByDate[d], transactionsByDate[d], req));

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
    const branchId = req.branchId;

    if (!branchId) {
      return res.status(400).json({
        success: false,
        message: 'Branch ID is required. Please provide X-Branch-Id header.'
      });
    }

    const isUmum = req.query.is_umum === 'all' ? undefined : (req.query.is_umum === 'false' ? false : true);
    const hasPb1 = req.query.has_pb1 === 'true';
    const monthRange = getMonthRange(parseInt(year), parseInt(month));
    const allTransactions = await Transaction.findAll({
      branchId: branchId,
      startDate: monthRange.start,
      endDate: monthRange.end,
      limit: 10000,
      page: 1,
      isUmum: isUmum,
      hasPb1: hasPb1
    });

    const weeks = [];
    for (let w = 1; w <= 5; w++) {
      const wr = getWeekRange(parseInt(year), parseInt(month), w);
      const weekTransactions = allTransactions.filter(t => {
        let tDate = t.transaction_date;
        if (tDate instanceof Date) {
          tDate = formatDate(tDate);
        } else if (typeof tDate === 'string') {
          if (tDate.includes('T')) tDate = tDate.split('T')[0];
        } else return false;
        return tDate >= wr.start && tDate <= wr.end;
      });

      if (weekTransactions.length > 0 || (week && w === parseInt(week))) {
        weeks.push({
          week: w,
          range: wr,
          transactions: weekTransactions
        });
      }
    }

    const summary = await Transaction.getSummary({
      branchId: branchId,
      startDate: monthRange.start,
      endDate: monthRange.end,
      isUmum: isUmum,
      hasPb1: hasPb1
    });

    summary.trend = await calculateTrend(branchId, 'Mingguan', { year, month, week }, summary, isUmum, hasPb1) || null;

    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
    const title = `${months[parseInt(month) - 1]} ${year}`;

    const sections = weeks.map(w => {
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

// Dashboard Bulanan All
const getBulananAll = async (req, res, next) => {
  try {
    const { year } = req.query;
    const branchId = req.branchId;

    if (!branchId) {
      return res.status(400).json({
        success: false,
        message: 'Branch ID is required. Please provide X-Branch-Id header.'
      });
    }

    const isUmum = req.query.is_umum === 'all' ? undefined : (req.query.is_umum === 'false' ? false : true);
    const hasPb1 = req.query.has_pb1 === 'true';
    const yearRange = getYearRange(parseInt(year));

    const transactions = await Transaction.findAll({
      branchId: branchId,
      startDate: yearRange.start,
      endDate: yearRange.end,
      limit: 10000,
      page: 1,
      isUmum: isUmum,
      hasPb1: hasPb1
    });

    const summary = await Transaction.getSummary({
      branchId: branchId,
      startDate: yearRange.start,
      endDate: yearRange.end,
      isUmum: isUmum,
      hasPb1: hasPb1
    });

    summary.trend = await calculateTrend(branchId, 'BulananAll', { year }, summary, isUmum, hasPb1) || null;

    const transactionsByMonth = {};
    transactions.forEach(t => {
      let dateStr = t.transaction_date;
      if (dateStr instanceof Date) {
        dateStr = formatDate(dateStr);
      } else if (typeof dateStr === 'string' && dateStr.includes('T')) {
        dateStr = dateStr.split('T')[0];
      } else return;

      const date = parseDate(dateStr);
      if (!date || isNaN(date.getTime())) return;

      const y = date.getFullYear();
      const m = date.getMonth() + 1;
      const monthKey = `${y}-${String(m).padStart(2, '0')}`;
      if (!transactionsByMonth[monthKey]) {
        transactionsByMonth[monthKey] = [];
      }
      transactionsByMonth[monthKey].push(t);
    });

    const title = String(year);
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
    const monthKeys = Object.keys(transactionsByMonth).sort((a, b) => b.localeCompare(a));

    const sections = monthKeys.map(monthKey => {
      const parts = monthKey.split('-');
      const y = parts[0];
      const m = parts[1];
      const yearNum = parseInt(y, 10);
      const monthIndex = parseInt(m, 10);

      const firstDate = `${y}-${m}-01`;
      const section = formatSection(firstDate, transactionsByMonth[monthKey], transactionsByMonth[monthKey], req);

      section.dateLabel = months[monthIndex - 1];
      section.dayLabel = 'Bulan';
      section.monthLabel = String(yearNum);

      return section;
    }).filter(s => s !== null);

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

// Dashboard Bulanan (Single)
const getBulanan = async (req, res, next) => {
  try {
    const { year, month } = req.query;
    const branchId = req.branchId;

    if (!branchId) {
      return res.status(400).json({
        success: false,
        message: 'Branch ID is required. Please provide X-Branch-Id header.'
      });
    }

    const isUmum = req.query.is_umum === 'all' ? undefined : (req.query.is_umum === 'false' ? false : true);
    const hasPb1 = req.query.has_pb1 === 'true';
    const monthRange = getMonthRange(parseInt(year), parseInt(month));
    const transactions = await Transaction.findAll({
      branchId: branchId,
      startDate: monthRange.start,
      endDate: monthRange.end,
      limit: 10000,
      page: 1,
      isUmum: isUmum,
      hasPb1: hasPb1
    });

    const summary = await Transaction.getSummary({
      branchId: branchId,
      startDate: monthRange.start,
      endDate: monthRange.end,
      isUmum: isUmum,
      hasPb1: hasPb1
    });

    summary.trend = await calculateTrend(branchId, 'Bulanan', { year, month }, summary, isUmum, hasPb1) || null;

    const transactionsByDate = {};
    transactions.forEach(t => {
      let date = t.transaction_date;
      if (date instanceof Date) {
        date = formatDate(date);
      } else if (typeof date === 'string' && date.includes('T')) {
        date = date.split('T')[0];
      } else if (typeof date !== 'string') return;

      if (!transactionsByDate[date]) {
        transactionsByDate[date] = [];
      }
      transactionsByDate[date].push(t);
    });

    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
    const title = `${months[parseInt(month) - 1]} ${year}`;

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

// Dashboard Tahunan
const getTahunan = async (req, res, next) => {
  try {
    const { year } = req.query;
    const branchId = req.branchId;

    if (!branchId) {
      return res.status(400).json({
        success: false,
        message: 'Branch ID is required. Please provide X-Branch-Id header.'
      });
    }

    const isUmum = req.query.is_umum === 'all' ? undefined : (req.query.is_umum === 'false' ? false : true);
    const hasPb1 = req.query.has_pb1 === 'true';
    let startDate = '2000-01-01';
    let endDate = '2100-12-31';

    if (year) {
      const yearRange = getYearRange(parseInt(year));
      startDate = yearRange.start;
      endDate = yearRange.end;
    }

    const transactions = await Transaction.findAll({
      branchId: branchId,
      startDate: startDate,
      endDate: endDate,
      limit: 10000,
      page: 1,
      isUmum: isUmum,
      hasPb1: hasPb1
    });

    const summary = await Transaction.getSummary({
      branchId: branchId,
      startDate: startDate,
      endDate: endDate,
      isUmum: isUmum,
      hasPb1: hasPb1
    });

    summary.trend = await calculateTrend(branchId, 'Tahunan', { year }, summary, isUmum, hasPb1) || null;

    const transactionsByYear = {};
    transactions.forEach(t => {
      let dateStr = t.transaction_date;
      if (dateStr instanceof Date) {
        dateStr = formatDate(dateStr);
      } else if (typeof dateStr === 'string' && dateStr.includes('T')) {
        dateStr = dateStr.split('T')[0];
      } else return;

      const date = parseDate(dateStr);
      if (!date || isNaN(date.getTime())) return;

      const yKey = String(date.getFullYear());
      if (!transactionsByYear[yKey]) {
        transactionsByYear[yKey] = [];
      }
      transactionsByYear[yKey].push(t);
    });

    const title = year ? String(year) : 'Semua Tahun';
    const yearKeys = Object.keys(transactionsByYear).sort((a, b) => parseInt(b) - parseInt(a));

    const sections = yearKeys.map(yearKey => {
      const firstDate = `${yearKey}-01-01`;
      const section = formatSection(firstDate, transactionsByYear[yearKey], transactionsByYear[yearKey], req);
      section.dateLabel = yearKey;
      section.dayLabel = 'Tahun';
      section.monthLabel = '';
      return section;
    }).filter(s => s !== null);

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
