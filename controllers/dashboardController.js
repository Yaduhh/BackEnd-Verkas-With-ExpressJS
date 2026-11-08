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
    .reduce((sum, t) => {
      let val = parseFloat(t.amount);
      // Debt logic: for main transaction (has category), count full amount (accrual basis)
      // For repayment notification (no category), don't count it to avoid double counting
      if ((t.is_debt_payment === true || t.is_debt_payment === 1 || t.is_debt_payment === '1')) {
        if (t.category_id) {
          val = parseFloat(t.amount);
        } else {
          val = 0;
        }
      }
      
      // If this is for PB1 dashboard, header income is the PB1 tax, not gross income
      if (req.query.has_pb1 === 'true') {
        return sum + (parseFloat(t.pb1) || 0);
      }
      
      const futureRef = parseFloat(t.future_refund || 0);
      return sum + (val + futureRef);
    }, 0);

  // If for PB1, round the total income tax at the end
  const incomeHeader = req.query.has_pb1 === 'true' ? Math.round(income) : income;

  const expense = transactions
    .filter(t => t.type === 'expense')
    .reduce((sum, t) => {
      // If for PB1, only count setoran pajak
      if (req.query.has_pb1 === 'true' && !t.is_pb1_payment) return sum;
      const futureRef = parseFloat(t.future_refund || 0);
      return sum + (parseFloat(t.amount) + futureRef);
    }, 0);

  // Get base URL from config (prioritize config over req)
  const baseUrl = config.baseUrl || `${req.protocol}://${req.get('host')}`;

  // Helper to convert path to full URL using baseUrl from config
  const pathToUrl = (path) => {
    if (!path) return null;

    const formatSingle = (urlStr) => {
      if (!urlStr || typeof urlStr !== 'string') return urlStr;
      if (urlStr.startsWith('http://') || urlStr.startsWith('https://')) {
        try {
          const urlObj = new URL(urlStr);
          const urlPath = urlObj.pathname;
          return `${baseUrl}${urlPath}`;
        } catch (e) {
          return urlStr;
        }
      }
      return `${baseUrl}${urlStr.startsWith('/') ? urlStr : '/' + urlStr}`;
    };

    if (typeof path === 'object' && path !== null) {
      if (path.url) {
        return {
          ...path,
          url: formatSingle(path.url)
        };
      }
      return path;
    }

    return formatSingle(path);
  };

  return {
    dateLabel: formatDateLabel(d, 'day'),
    dayLabel: getDayName(d),
    monthLabel: formatMonthLabel(d),
    headerIncome: incomeHeader,
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

      const itemFutureRef = parseFloat(item.future_refund || 0);
      const effectiveAmount = parseFloat(item.amount) + itemFutureRef;
      let displayAmount = item.type === 'expense' ? -effectiveAmount : effectiveAmount;
      
      // Handle debt payment logic for dashboard list (Accrual Basis)
      if (item.type === 'income' && (item.is_debt_payment === true || item.is_debt_payment === 1 || item.is_debt_payment === '1')) {
        if (item.category_id) {
          // Piutang Utama: Tampilkan Full Amount (Omzet Utuh)
          displayAmount = effectiveAmount;
        } else {
          // Notifikasi Pelunasan: Tetap tampilkan nominal pelunasan agar terlihat di daftar
          displayAmount = effectiveAmount;
        }
      }

      return {
        transaction_id: item.id, // Add transaction ID for detail navigation
        branch_id: item.branch_id || null,
        branch_name: item.branch_name || null,
        branch_code: item.branch_code || null,
        category: item.category_name || '-',
        note: item.note || '',
        amount: displayAmount,
        total_refund: item.total_refund !== undefined ? parseFloat(item.total_refund) : 0,
        future_refund: itemFutureRef,
        net_amount: item.net_amount !== undefined ? parseFloat(item.net_amount) : effectiveAmount,
        pb1: item.pb1 ? parseFloat(item.pb1) : null,
        lampiran: lampiran, // Always array or null with full URLs
        user_name: item.user_name || null,
        bank_account_name: item.bank_account_name || null,
        bank_account_type: item.bank_account_type || null,
        edit_accepted: item.edit_accepted !== undefined && item.edit_accepted !== null ? parseInt(item.edit_accepted) : 0, // 0 = default, 1 = pending, 2 = approved, 3 = rejected
        is_debt_payment: item.is_debt_payment === true || item.is_debt_payment === 1 || item.is_debt_payment === '1', // Pembayaran hutang
        paid_amount: item.paid_amount !== undefined && item.paid_amount !== null ? parseFloat(item.paid_amount) : null,
        parent_transaction_id: item.parent_transaction_id || null,
        parent_transaction_date: item.parent_transaction_date || null,
        created_at: item.created_at || item.updated_at || item.createdAt || null,
        transaction_date: item.transaction_date,
        is_pb1_payment: item.is_pb1_payment === true || item.is_pb1_payment === 1 || item.is_pb1_payment === '1',
        category_id: item.category_id || null,
        category_min_attachment: item.category_min_attachment !== undefined && item.category_min_attachment !== null ? parseInt(item.category_min_attachment) : 0
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
      } else if (typeof dateStr === 'string') {
        dateStr = dateStr.includes('T') ? dateStr.split('T')[0] : dateStr;
      } else {
        return;
      }

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
    const [transactions, summary] = await Promise.all([
      Transaction.findAll({
        branchId: branchId,
        startDate: monthRange.start,
        endDate: monthRange.end,
        limit: 10000,
        page: 1,
        isUmum: isUmum,
        hasPb1: hasPb1
      }),
      Transaction.getSummary({
        branchId: branchId,
        startDate: monthRange.start,
        endDate: monthRange.end,
        isUmum: isUmum,
        hasPb1: hasPb1
      })
    ]);

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

    const [transactions, summary] = await Promise.all([
      Transaction.findAll({
        branchId: branchId,
        startDate: startDate,
        endDate: endDate,
        limit: 10000,
        page: 1,
        isUmum: isUmum,
        hasPb1: hasPb1
      }),
      Transaction.getSummary({
        branchId: branchId,
        startDate: startDate,
        endDate: endDate,
        isUmum: isUmum,
        hasPb1: hasPb1
      })
    ]);

    summary.trend = await calculateTrend(branchId, 'Tahunan', { year }, summary, isUmum, hasPb1) || null;

    const transactionsByYear = {};
    transactions.forEach(t => {
      let dateStr = t.transaction_date;
      if (dateStr instanceof Date) {
        dateStr = formatDate(dateStr);
      } else if (typeof dateStr === 'string') {
        dateStr = dateStr.includes('T') ? dateStr.split('T')[0] : dateStr;
      } else {
        return;
      }

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

// Dashboard Grup Cabang (Multi-Branch Group Dashboard)
const getGroupDashboard = async (req, res, next) => {
  try {
    const { group_name, branchIds, tab = 'Bulanan', year, month, date, startDate, endDate } = req.query;

    const Branch = require('../models/Branch');
    const accessibleBranches = await Branch.findByUserAccess(req.userId, req.user.role);
    const accessibleIds = accessibleBranches.map(b => b.id);

    let targetBranches = [];
    if (branchIds) {
      const ids = (typeof branchIds === 'string' ? branchIds.split(',') : branchIds)
        .map(id => parseInt(id.trim ? id.trim() : id))
        .filter(id => !isNaN(id) && accessibleIds.includes(id));
      targetBranches = accessibleBranches.filter(b => ids.includes(b.id));
    } else if (group_name && group_name !== 'Semua' && group_name !== 'ALL') {
      targetBranches = accessibleBranches.filter(b => b.group_name && b.group_name.toLowerCase() === group_name.toLowerCase());
    } else {
      targetBranches = accessibleBranches;
    }

    if (targetBranches.length === 0) {
      return res.json({
        success: true,
        data: {
          title: group_name || 'Grup Cabang',
          group_name: group_name || 'Gabungan',
          branches: [],
          summary: {
            income: 0,
            expense: 0,
            balance: 0,
            total_transactions: 0
          },
          sections: []
        }
      });
    }

    const targetBranchIds = targetBranches.map(b => b.id);
    const isUmum = req.query.is_umum === 'all' ? undefined : (req.query.is_umum === 'false' ? false : true);
    const hasPb1 = req.query.has_pb1 === 'true';

    const currentYear = parseInt(year) || new Date().getFullYear();
    const currentMonth = parseInt(month) || (new Date().getMonth() + 1);

    let finalStart = '';
    let finalEnd = '';
    let title = '';

    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];

    if (tab === 'Harian') {
      finalStart = startDate || date || formatDate(new Date());
      finalEnd = endDate || date || formatDate(new Date());
      const s = parseDate(finalStart);
      const e = parseDate(finalEnd);
      title = finalStart === finalEnd 
        ? `${s.getDate()} ${months[s.getMonth()]} ${s.getFullYear()}`
        : `${s.getDate()} ${months[s.getMonth()]} - ${e.getDate()} ${months[e.getMonth()]} ${e.getFullYear()}`;
    } else if (tab === 'Mingguan') {
      const monthRange = getMonthRange(currentYear, currentMonth);
      finalStart = monthRange.start;
      finalEnd = monthRange.end;
      title = `${months[currentMonth - 1]} ${currentYear}`;
    } else if (tab === 'Tahunan') {
      const yearRange = getYearRange(currentYear);
      finalStart = yearRange.start;
      finalEnd = yearRange.end;
      title = String(currentYear);
    } else {
      // Bulanan (default)
      const monthRange = getMonthRange(currentYear, currentMonth);
      finalStart = monthRange.start;
      finalEnd = monthRange.end;
      title = `${months[currentMonth - 1]} ${currentYear}`;
    }

    // Fetch transactions across branches
    const transactions = await Transaction.findAll({
      branchIds: targetBranchIds,
      startDate: finalStart,
      endDate: finalEnd,
      limit: 10000,
      page: 1,
      isUmum: isUmum,
      hasPb1: hasPb1
    });

    // Fetch summary across branches with unified financial logic
    let summary;
    if (targetBranchIds.length === 1) {
      summary = await Transaction.getSummary({
        branchId: targetBranchIds[0],
        startDate: finalStart,
        endDate: finalEnd,
        isUmum: isUmum,
        hasPb1: hasPb1
      });

      summary.trend = await calculateTrend(
        targetBranchIds[0],
        tab === 'Mingguan' ? 'Bulanan' : tab,
        { year: currentYear, month: currentMonth, finalStartDate: finalStart, finalEndDate: finalEnd },
        summary,
        isUmum,
        hasPb1
      ) || null;
    } else {
      const branchSummaries = await Promise.all(
        targetBranchIds.map(bId =>
          Transaction.getSummary({
            branchId: bId,
            startDate: finalStart,
            endDate: finalEnd,
            isUmum: isUmum,
            hasPb1: hasPb1
          })
        )
      );

      summary = branchSummaries.reduce((acc, curr) => ({
        pemasukan: acc.pemasukan + (curr.pemasukan || 0),
        total_omzet: acc.total_omzet + (curr.total_omzet || 0),
        pemasukan_lain: acc.pemasukan_lain + (curr.pemasukan_lain || 0),
        pelunasan_piutang_lalu: acc.pelunasan_piutang_lalu + (curr.pelunasan_piutang_lalu || 0),
        pengeluaran: acc.pengeluaran + (curr.pengeluaran || 0),
        folder_pengeluaran: (acc.folder_pengeluaran || 0) + (curr.folder_pengeluaran || 0),
        total_piutang_mitra: (acc.total_piutang_mitra || 0) + (curr.total_piutang_mitra || 0),
        saldo: acc.saldo + (curr.saldo || 0),
        total_pb1: acc.total_pb1 + (curr.total_pb1 || 0),
        total_pb1_paid: acc.total_pb1_paid + (curr.total_pb1_paid || 0),
        saldo_pb1: acc.saldo_pb1 + (curr.saldo_pb1 || 0)
      }), {
        pemasukan: 0,
        total_omzet: 0,
        pemasukan_lain: 0,
        pelunasan_piutang_lalu: 0,
        pengeluaran: 0,
        folder_pengeluaran: 0,
        total_piutang_mitra: 0,
        saldo: 0,
        total_pb1: 0,
        total_pb1_paid: 0,
        saldo_pb1: 0
      });
      summary.trend = null;
    }

    // Group transactions by date
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

    const sortedDates = Object.keys(transactionsByDate).sort((a, b) => b.localeCompare(a));
    const sections = sortedDates.map(d => formatSection(d, transactionsByDate[d], transactionsByDate[d], req));

    res.json({
      success: true,
      data: {
        title,
        group_name: group_name || 'Gabungan',
        branches: targetBranches.map(b => ({ id: b.id, name: b.name, code: b.code, group_name: b.group_name })),
        summary,
        sections
      }
    });
  } catch (error) {
    next(error);
  }
};

// Global Balance & Multi-Branch Kas Simpanan Consolidation
const getGlobalBalanceSummary = async (req, res, next) => {
  try {
    const { group_name, branchIds, startDate, endDate, month, year, period = 'all' } = req.query;

    const Branch = require('../models/Branch');
    const accessibleBranches = await Branch.findByUserAccess(req.userId, req.user.role);
    const accessibleIds = accessibleBranches.map(b => b.id);

    let targetBranches = [];
    if (branchIds) {
      const ids = (typeof branchIds === 'string' ? branchIds.split(',') : branchIds)
        .map(id => parseInt(id.trim ? id.trim() : id))
        .filter(id => !isNaN(id) && accessibleIds.includes(id));
      targetBranches = accessibleBranches.filter(b => ids.includes(b.id));
    } else if (group_name && group_name !== 'Semua' && group_name !== 'ALL') {
      targetBranches = accessibleBranches.filter(b => b.group_name && b.group_name.toLowerCase() === group_name.toLowerCase());
    } else {
      targetBranches = accessibleBranches;
    }

    if (targetBranches.length === 0) {
      return res.json({
        success: true,
        data: {
          filter: { period: period, startDate: null, endDate: null },
          branches: [],
          branch_balances: [],
          savings_folders: [],
          categories_breakdown: { pemasukan: [], pengeluaran: [] },
          grand_totals: {
            total_branches: 0,
            total_omzet: 0,
            total_pemasukan: 0,
            total_pengeluaran: 0,
            total_saldo_berjalan: 0,
            total_kas_simpanan: 0,
            total_saldo_global: 0
          }
        }
      });
    }

    const targetBranchIds = targetBranches.map(b => b.id);

    // Determine date boundaries based on period (Harian, Bulanan, Tahunan)
    let filterStart = null;
    let filterEnd = null;

    if (period === 'harian' || period === 'daily') {
      filterStart = startDate || req.query.date || formatDate(new Date());
      filterEnd = endDate || req.query.date || filterStart;
    } else if (period === 'tahunan' || period === 'yearly') {
      const curYear = parseInt(year) || new Date().getFullYear();
      const yRange = getYearRange(curYear);
      filterStart = yRange.start;
      filterEnd = yRange.end;
    } else {
      // Default: 'bulanan' / 'monthly'
      const curYear = parseInt(year) || new Date().getFullYear();
      const curMonth = parseInt(month) || (new Date().getMonth() + 1);
      const mRange = getMonthRange(curYear, curMonth);
      filterStart = mRange.start;
      filterEnd = mRange.end;
    }

    // 1. Calculate per-branch balance and totals using Transaction.getSummary
    const branchSummaries = await Promise.all(
      targetBranches.map(async (b) => {
        const sum = await Transaction.getSummary({
          branchId: b.id,
          startDate: filterStart,
          endDate: filterEnd,
          isUmum: true
        });

        // Also fetch all-time balance if period is filtered, or use sum.saldo
        const allTimeSum = filterStart
          ? await Transaction.getSummary({ branchId: b.id, isUmum: true })
          : sum;

        return {
          id: b.id,
          name: b.name,
          code: b.code || '',
          group_name: b.group_name || 'Tanpa Grup',
          omzet: Number(sum.total_omzet || 0),
          pemasukan_lain: Number(sum.pemasukan_lain || 0),
          total_pemasukan: Number(sum.pemasukan || 0),
          pengeluaran: Number(sum.pengeluaran || sum.folder_pengeluaran || 0),
          saldo_berjalan: Number(sum.saldo || 0),
          all_time_saldo: Number(allTimeSum.saldo || 0),
          total_pb1: Number(sum.total_pb1 || 0),
          total_pb1_paid: Number(sum.total_pb1_paid || 0),
          saldo_pb1: Number(sum.saldo_pb1 || (sum.total_pb1 - sum.total_pb1_paid) || 0)
        };
      })
    );

    // 2. Query Kas Simpanan per branch & category
    const placeholders = targetBranchIds.map(() => '?').join(',');
    const queryParams1 = [...targetBranchIds];
    const queryParams2 = [...targetBranchIds];
    let dateFilter1 = '';
    let dateFilter2 = '';

    if (filterEnd) {
      dateFilter1 = 'AND transaction_date <= ?';
      queryParams1.push(filterEnd);
      dateFilter2 = 'AND t.transaction_date <= ?';
      queryParams2.push(filterEnd);
    }

    const savingsSql = `
      SELECT 
        t.branch_id,
        cat.id as category_id,
        cat.name as category_name, 
        COALESCE(SUM(CASE WHEN t.type = 'income' OR (t.is_umum = 1 AND t.type = 'expense') THEN amount_val ELSE -amount_val END), 0) as saldo 
      FROM (
        SELECT id, branch_id, type, is_umum, amount as amount_val, category_id, transaction_date 
        FROM transactions 
        WHERE branch_id IN (${placeholders}) AND status_deleted = 0 AND (is_draft = 0 OR is_draft IS NULL)
        ${dateFilter1}
        UNION ALL 
        SELECT t.id, t.branch_id, t.type, t.is_umum, tsd.amount as amount_val, tsd.category_id, t.transaction_date 
        FROM transaction_savings_details tsd 
        JOIN transactions t ON tsd.transaction_id = t.id 
        WHERE t.branch_id IN (${placeholders}) AND t.status_deleted = 0 AND (t.is_draft = 0 OR t.is_draft IS NULL)
        ${dateFilter2}
      ) as t 
      JOIN categories cat ON t.category_id = cat.id 
      WHERE cat.status_deleted = 0 
        AND cat.parent_id IS NOT NULL 
      GROUP BY t.branch_id, cat.id, cat.name
      ORDER BY cat.name ASC
    `;

    const savingsRows = await query(savingsSql, [...queryParams1, ...queryParams2]);

    // Map savings into branches and folders
    const savingsFoldersMap = {};
    const branchSavingsTotalMap = {};
    const branchSavingsItemsMap = {};

    targetBranches.forEach(b => {
      branchSavingsTotalMap[b.id] = 0;
      branchSavingsItemsMap[b.id] = [];
    });

    savingsRows.forEach(row => {
      const bId = row.branch_id;
      const catName = row.category_name;
      const saldo = parseFloat(row.saldo) || 0;

      branchSavingsTotalMap[bId] = (branchSavingsTotalMap[bId] || 0) + saldo;
      if (branchSavingsItemsMap[bId]) {
        branchSavingsItemsMap[bId].push({
          category_id: row.category_id,
          name: catName,
          saldo: saldo
        });
      }

      if (!savingsFoldersMap[catName]) {
        savingsFoldersMap[catName] = {
          name: catName,
          category_id: row.category_id,
          total_saldo: 0,
          branch_details: []
        };
      }

      savingsFoldersMap[catName].total_saldo += saldo;
      savingsFoldersMap[catName].branch_details.push({
        branch_id: bId,
        branch_name: targetBranches.find(b => b.id === bId)?.name || `Cabang #${bId}`,
        branch_code: targetBranches.find(b => b.id === bId)?.code || '',
        saldo: saldo
      });
    });

    // Also include Pajak PB1 as a savings/tax reserve folder if total_pb1 exists
    const totalPb1Saldo = branchSummaries.reduce((acc, curr) => acc + (curr.saldo_pb1 || 0), 0);
    if (totalPb1Saldo !== 0 || branchSummaries.some(b => b.total_pb1 > 0)) {
      if (!savingsFoldersMap['Pajak PB1']) {
        savingsFoldersMap['Pajak PB1'] = {
          name: 'Pajak PB1 (Titipan/Cadangan)',
          category_id: 0,
          total_saldo: totalPb1Saldo,
          branch_details: branchSummaries.map(b => ({
            branch_id: b.id,
            branch_name: b.name,
            branch_code: b.code,
            saldo: b.saldo_pb1
          }))
        };
      }
    }

    const savingsFolders = Object.values(savingsFoldersMap).sort((a, b) => b.total_saldo - a.total_saldo);

    // Merge total simpanan and savings items into branchSummaries
    const branchBalances = branchSummaries.map(b => {
      const simpanan = branchSavingsTotalMap[b.id] || 0;
      const items = [...(branchSavingsItemsMap[b.id] || [])];
      if (b.saldo_pb1 > 0 || b.total_pb1 > 0) {
        items.unshift({
          category_id: 0,
          name: 'Pajak PB1',
          saldo: b.saldo_pb1
        });
      }
      const totalSimpananWithPb1 = simpanan + (b.saldo_pb1 > 0 ? b.saldo_pb1 : 0);
      return {
        ...b,
        total_simpanan: totalSimpananWithPb1,
        total_saldo_cabang: b.saldo_berjalan + totalSimpananWithPb1,
        savings_items: items.sort((x, y) => y.saldo - x.saldo)
      };
    });

    // 3. Consolidated Categories Breakdown (Income & Expense) per branch and total
    const catParams = [...targetBranchIds];
    let catDateFilter = '';
    if (filterStart && filterEnd) {
      catDateFilter = 'AND t.transaction_date BETWEEN ? AND ?';
      catParams.push(filterStart, filterEnd);
    }

    const catBreakdownSql = `
      SELECT 
        t.branch_id,
        COALESCE(c.name, 'Lain-lain') as category_name,
        c.type as category_type,
        SUM(
          CASE 
            WHEN t.type = 'expense' THEN t.amount 
            ELSE 0 
          END
        ) as total_expense,
        SUM(
          CASE 
            WHEN t.type = 'income' THEN t.amount 
            ELSE 0 
          END
        ) as total_income
      FROM transactions t
      LEFT JOIN categories c ON t.category_id = c.id
      WHERE t.branch_id IN (${placeholders})
        AND t.status_deleted = 0
        AND (t.is_draft = 0 OR t.is_draft IS NULL)
        AND t.is_umum = 1
        ${catDateFilter}
      GROUP BY t.branch_id, c.name, c.type
      ORDER BY total_expense DESC, total_income DESC
    `;

    const catRows = await query(catBreakdownSql, catParams);

    // Map categories into each branch
    const branchCategoriesMap = {};
    targetBranches.forEach(b => {
      branchCategoriesMap[b.id] = { pemasukan: [], pengeluaran: [] };
    });

    catRows.forEach(r => {
      const bId = r.branch_id;
      if (branchCategoriesMap[bId]) {
        if (parseFloat(r.total_expense) > 0) {
          branchCategoriesMap[bId].pengeluaran.push({
            category_name: r.category_name,
            total: parseFloat(r.total_expense) || 0
          });
        }
        if (parseFloat(r.total_income) > 0) {
          branchCategoriesMap[bId].pemasukan.push({
            category_name: r.category_name,
            total: parseFloat(r.total_income) || 0
          });
        }
      }
    });

    branchBalances.forEach(b => {
      if (branchCategoriesMap[b.id]) {
        b.categories = {
          pemasukan: branchCategoriesMap[b.id].pemasukan.sort((x, y) => y.total - x.total),
          pengeluaran: branchCategoriesMap[b.id].pengeluaran.sort((x, y) => y.total - x.total)
        };
      } else {
        b.categories = { pemasukan: [], pengeluaran: [] };
      }
    });

    // Consolidated global categories
    const expenseTotalsMap = {};
    const incomeTotalsMap = {};
    catRows.forEach(r => {
      const exp = parseFloat(r.total_expense) || 0;
      const inc = parseFloat(r.total_income) || 0;
      if (exp > 0) {
        expenseTotalsMap[r.category_name] = (expenseTotalsMap[r.category_name] || 0) + exp;
      }
      if (inc > 0) {
        incomeTotalsMap[r.category_name] = (incomeTotalsMap[r.category_name] || 0) + inc;
      }
    });

    const expenseCategories = Object.entries(expenseTotalsMap).map(([name, total]) => ({
      category_name: name,
      total: total
    })).sort((a, b) => b.total - a.total);

    const incomeCategories = Object.entries(incomeTotalsMap).map(([name, total]) => ({
      category_name: name,
      total: total
    })).sort((a, b) => b.total - a.total);

    // 4. Calculate Grand Totals
    const totalOmzet = branchBalances.reduce((sum, b) => sum + b.omzet, 0);
    const totalPemasukan = branchBalances.reduce((sum, b) => sum + b.total_pemasukan, 0);
    const totalPengeluaran = branchBalances.reduce((sum, b) => sum + b.pengeluaran, 0);
    const totalSaldoBerjalan = branchBalances.reduce((sum, b) => sum + b.saldo_berjalan, 0);
    const totalKasSimpanan = branchBalances.reduce((sum, b) => sum + b.total_simpanan, 0);
    const totalSaldoGlobal = totalSaldoBerjalan + totalKasSimpanan;

    res.json({
      success: true,
      data: {
        filter: {
          period: period,
          startDate: filterStart,
          endDate: filterEnd
        },
        grand_totals: {
          total_branches: targetBranches.length,
          total_omzet: totalOmzet,
          total_pemasukan: totalPemasukan,
          total_pengeluaran: totalPengeluaran,
          total_saldo_berjalan: totalSaldoBerjalan,
          total_kas_simpanan: totalKasSimpanan,
          total_saldo_global: totalSaldoGlobal
        },
        branch_balances: branchBalances,
        savings_folders: savingsFolders,
        categories_breakdown: {
          pemasukan: incomeCategories,
          pengeluaran: expenseCategories
        }
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
  getTahunan,
  getGroupDashboard,
  getGlobalBalanceSummary
};
