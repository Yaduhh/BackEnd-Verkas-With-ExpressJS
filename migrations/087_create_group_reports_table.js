module.exports = {
  up: async ({ query }) => {
    await query(`
      CREATE TABLE IF NOT EXISTS group_reports (
        id INT AUTO_INCREMENT PRIMARY KEY,
        owner_id INT NOT NULL,
        group_name VARCHAR(100) NOT NULL,
        month TINYINT NOT NULL,
        year SMALLINT NOT NULL,
        stok_awal DECIMAL(15,2) NOT NULL DEFAULT 0,
        stok_akhir DECIMAL(15,2) NOT NULL DEFAULT 0,
        working_days TINYINT NOT NULL DEFAULT 25,
        bagi_hasil JSON NULL,
        sales_channels JSON NULL,
        expense_adjustments JSON NULL,
        expense_order JSON NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY unique_group_report (owner_id, group_name, month, year),
        INDEX idx_group_owner (owner_id, group_name),
        INDEX idx_group_period (year, month),
        CONSTRAINT fk_group_reports_owner FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    console.log('  Created group_reports table');
  },

  down: async ({ query }) => {
    await query(`DROP TABLE IF EXISTS group_reports`);
    console.log('  Dropped group_reports table');
  }
};
