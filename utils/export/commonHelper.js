const path = require('path');
const fs = require('fs');

// Create exports directory if not exists
const EXPORTS_DIR = path.join(__dirname, '../../exports');
if (!fs.existsSync(EXPORTS_DIR)) {
    fs.mkdirSync(EXPORTS_DIR, { recursive: true });
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

// Get month name in Indonesian
function getMonthName(monthIndex) {
    const months = [
        'JANUARI', 'FEBRUARI', 'MARET', 'APRIL', 'MEI', 'JUNI',
        'JULI', 'AGUSTUS', 'SEPTEMBER', 'OKTOBER', 'NOVEMBER', 'DESEMBER'
    ];
    return months[monthIndex];
}

module.exports = {
    EXPORTS_DIR,
    generateFilename,
    getMimeType,
    formatCurrency,
    getMonthName
};
