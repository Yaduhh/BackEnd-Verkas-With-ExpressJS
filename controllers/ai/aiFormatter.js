// Formatting helper for currency and date objects

const formatIDR = (num) => {
  return new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(num);
};

const formatIDRClean = (num) => {
  const val = parseFloat(num);
  if (isNaN(val)) return num;
  return new Intl.NumberFormat('id-ID', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(val);
};

function getMonthRange(year, month) {
  const start = `${year}-${String(month).padStart(2, '0')}-01`;
  const end = new Date(year, month, 0).getDate();
  const endDate = `${year}-${String(month).padStart(2, '0')}-${String(end).padStart(2, '0')}`;
  return { start, end: endDate };
}

// Traverses query results and formats Date/Numeric objects to clean values
function formatDatesToLocal(obj, parentKey = '') {
  if (obj === null || obj === undefined) return obj;
  if (obj instanceof Date) {
    const pad = (n) => String(n).padStart(2, '0');
    const year = obj.getFullYear();
    const month = pad(obj.getMonth() + 1);
    const date = pad(obj.getDate());
    const hours = pad(obj.getHours());
    const minutes = pad(obj.getMinutes());
    const seconds = pad(obj.getSeconds());
    return `${year}-${month}-${date} ${hours}:${minutes}:${seconds}`;
  }

  if (Array.isArray(obj)) {
    return obj.map(item => formatDatesToLocal(item, parentKey));
  }

  if (typeof obj === 'object') {
    const result = {};
    for (const key in obj) {
      if (Object.prototype.hasOwnProperty.call(obj, key)) {
        // Format columns that are stored as DECIMAL in DB but should be represented cleanly
        const val = obj[key];
        const isNumericString = typeof val === 'string' && !isNaN(val) && val.trim() !== '' && !val.includes('-');
        
        if (isNumericString && (
          key.includes('amount') || 
          key.includes('pemasukan') || 
          key.includes('pengeluaran') || 
          key.includes('omzet') || 
          key.includes('saldo') || 
          key.includes('pb1') ||
          key.includes('debt') ||
          key.includes('piutang') ||
          key.includes('repayment')
        )) {
          result[key] = parseFloat(val);
        } else {
          result[key] = formatDatesToLocal(val, key);
        }
      }
    }
    return result;
  }

  return obj;
}

const formatMonthIndo = (monthStr) => {
  if (!monthStr) return '';
  const [y, m] = monthStr.split('-');
  const d = new Date(parseInt(y), parseInt(m) - 1, 1);
  return d.toLocaleString('id-ID', { month: 'long', year: 'numeric' });
};

module.exports = {
  formatIDR,
  formatIDRClean,
  formatDatesToLocal,
  getMonthRange,
  formatMonthIndo
};
