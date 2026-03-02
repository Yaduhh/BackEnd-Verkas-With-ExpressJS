const createCsvWriter = require('csv-writer').createObjectCsvWriter;
const path = require('path');
const { EXPORTS_DIR } = require('./commonHelper');

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

module.exports = {
    exportToCSV
};
