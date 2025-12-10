// Date utility functions

// Get week range from year, month, week number
function getWeekRange(year, month, week) {
  // Month is 1-12, convert to 0-11 for Date
  const monthIndex = month - 1;
  
  // Get first day of month
  const firstDay = new Date(year, monthIndex, 1);
  const firstDayOfWeek = firstDay.getDay(); // 0 = Sunday
  
  // Calculate start date of week
  // Week 1 starts from first day of month
  const daysToAdd = (week - 1) * 7 - firstDayOfWeek;
  const startDate = new Date(year, monthIndex, 1 + daysToAdd);
  
  // End date is 6 days after start
  const endDate = new Date(startDate);
  endDate.setDate(endDate.getDate() + 6);
  
  return {
    start: formatDate(startDate),
    end: formatDate(endDate)
  };
}

// Format date to YYYY-MM-DD
function formatDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// Parse date string to Date object
// Handles both date format (YYYY-MM-DD) and datetime format (YYYY-MM-DDTHH:mm:ss.sssZ)
function parseDate(dateString) {
  if (!dateString) {
    return new Date(NaN);
  }
  
  // If already a datetime string (contains T), use it directly
  if (dateString.includes('T')) {
    return new Date(dateString);
  }
  
  // If just a date string, add time
  return new Date(dateString + 'T00:00:00');
}

// Get day name in Indonesian
function getDayName(date) {
  const days = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
  return days[date.getDay()];
}

// Get month name in Indonesian (short)
function getMonthNameShort(monthIndex) {
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
  return months[monthIndex];
}

// Get month name in Indonesian (full)
function getMonthNameFull(monthIndex) {
  const months = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
  return months[monthIndex];
}

// Format date label for sections
function formatDateLabel(date, format = 'day') {
  const d = typeof date === 'string' ? parseDate(date) : date;
  
  if (format === 'day') {
    return String(d.getDate()).padStart(2, '0');
  }
  if (format === 'month') {
    return getMonthNameShort(d.getMonth());
  }
  if (format === 'year') {
    return String(d.getFullYear());
  }
  return '';
}

// Format month label (MM.YYYY)
function formatMonthLabel(date) {
  const d = typeof date === 'string' ? parseDate(date) : date;
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year = d.getFullYear();
  return `${month}.${year}`;
}

// Get start and end of month
function getMonthRange(year, month) {
  const start = new Date(year, month - 1, 1);
  const end = new Date(year, month, 0); // Last day of month
  return {
    start: formatDate(start),
    end: formatDate(end)
  };
}

// Get start and end of year
function getYearRange(year) {
  const start = new Date(year, 0, 1);
  const end = new Date(year, 11, 31);
  return {
    start: formatDate(start),
    end: formatDate(end)
  };
}

module.exports = {
  getWeekRange,
  formatDate,
  parseDate,
  getDayName,
  getMonthNameShort,
  getMonthNameFull,
  formatDateLabel,
  formatMonthLabel,
  getMonthRange,
  getYearRange
};

