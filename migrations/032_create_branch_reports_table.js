module.exports = {
    up: async ({ query }) => {
        await query(`
      CREATE TABLE branch_reports (
        id           INT AUTO_INCREMENT PRIMARY KEY,
        branch_id    INT NOT NULL,
        month        TINYINT NOT NULL,
        year         SMALLINT NOT NULL,

        -- Auto-calculated dari transaksi kas umum (cached, di-update saat fetch)
        omzet_total        DECIMAL(15,2) NOT NULL DEFAULT 0,
        pengeluaran_total  DECIMAL(15,2) NOT NULL DEFAULT 0,

        -- Manual input: Sales Channels
        -- JSON array: [{ "name": "GrabFood", "amount": 500000 }, ...]
        sales_channels JSON NULL,

        -- Manual input: Bagi Hasil
        -- JSON array: [{ "title": "Pusat", "percentage": 30, "amount": 150000 }, ...]
        bagi_hasil JSON NULL,

        -- Manual input: Stok Persediaan
        stok_awal   DECIMAL(15,2) NOT NULL DEFAULT 0,
        stok_akhir  DECIMAL(15,2) NOT NULL DEFAULT 0,

        -- Timestamps
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

        -- Constraints
        UNIQUE KEY unique_branch_month_year (branch_id, month, year),
        INDEX idx_branch_id (branch_id),
        INDEX idx_year_month (year, month),

        FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

        console.log('  Created branch_reports table');
    },

    down: async ({ query }) => {
        await query('DROP TABLE IF EXISTS branch_reports');
        console.log('  Dropped branch_reports table');
    }
};
