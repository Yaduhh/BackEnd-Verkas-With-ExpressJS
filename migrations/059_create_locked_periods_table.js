module.exports = {
  up: async ({ query }) => {
    await query(`
      CREATE TABLE IF NOT EXISTS locked_periods (
        id INT AUTO_INCREMENT PRIMARY KEY,
        branch_id INT NOT NULL,
        month INT NOT NULL,
        year INT NOT NULL,
        is_locked BOOLEAN DEFAULT false,
        locked_by INT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY unique_branch_month_year (branch_id, month, year),
        FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE CASCADE,
        FOREIGN KEY (locked_by) REFERENCES users(id) ON DELETE SET NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);
    console.log('  Created locked_periods table');
  },

  down: async ({ query }) => {
    await query(`DROP TABLE IF NOT EXISTS locked_periods`);
    console.log('  Dropped locked_periods table');
  }
};
