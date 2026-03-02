const XLSX = require('xlsx');
const path = require('path');
const { EXPORTS_DIR } = require('./commonHelper');

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

module.exports = {
    exportToExcel
};
