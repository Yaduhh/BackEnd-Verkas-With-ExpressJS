module.exports = {
  up: async ({ query }) => {
    await query(`
      CREATE TABLE IF NOT EXISTS branch_stocks (
        id INT AUTO_INCREMENT PRIMARY KEY,
        branch_id INT NOT NULL,
        kode VARCHAR(100) NOT NULL DEFAULT '',
        nama_produk VARCHAR(255) NOT NULL,
        satuan VARCHAR(50) NOT NULL DEFAULT 'PCS',
        stok_awal DECIMAL(18, 2) NOT NULL DEFAULT 0.00,
        hpp_awal DECIMAL(18, 2) NOT NULL DEFAULT 0.00,
        beli DECIMAL(18, 2) NOT NULL DEFAULT 0.00,
        retur_jual DECIMAL(18, 2) NOT NULL DEFAULT 0.00,
        transfer_masuk DECIMAL(18, 2) NOT NULL DEFAULT 0.00,
        total_barang DECIMAL(18, 2) NOT NULL DEFAULT 0.00,
        jual DECIMAL(18, 2) NOT NULL DEFAULT 0.00,
        retur_beli DECIMAL(18, 2) NOT NULL DEFAULT 0.00,
        transfer_keluar DECIMAL(18, 2) NOT NULL DEFAULT 0.00,
        penyesuaian_stok DECIMAL(18, 2) NOT NULL DEFAULT 0.00,
        qty_akhir DECIMAL(18, 2) NOT NULL DEFAULT 0.00,
        hpp_akhir DECIMAL(18, 2) NOT NULL DEFAULT 0.00,
        total_hpp DECIMAL(18, 2) NOT NULL DEFAULT 0.00,
        status_deleted TINYINT(1) NOT NULL DEFAULT 0,
        deleted_at DATETIME NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_branch_stocks_branch (branch_id, status_deleted),
        INDEX idx_branch_stocks_kode (branch_id, kode)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);
    console.log('  Created branch_stocks table');
  },

  down: async ({ query }) => {
    await query(`DROP TABLE IF EXISTS branch_stocks;`);
    console.log('  Dropped branch_stocks table');
  }
};

