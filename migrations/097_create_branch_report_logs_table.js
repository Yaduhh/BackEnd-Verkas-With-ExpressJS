module.exports = {
  up: async ({ query }) => {
    await query(`
      CREATE TABLE IF NOT EXISTS branch_report_logs (
        id INT AUTO_INCREMENT PRIMARY KEY,
        branch_id INT NULL,
        owner_id INT NULL,
        group_name VARCHAR(100) NULL,
        month TINYINT NOT NULL,
        year SMALLINT NOT NULL,
        user_id INT NULL,
        user_name VARCHAR(150) NOT NULL DEFAULT 'Sistem',
        user_role VARCHAR(50) NOT NULL DEFAULT '',
        action_type VARCHAR(100) NOT NULL DEFAULT 'update_report',
        summary VARCHAR(500) NOT NULL,
        changes JSON NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_brl_branch_period (branch_id, year, month, created_at),
        INDEX idx_brl_group_period (owner_id, group_name, year, month, created_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);
    console.log('  Created branch_report_logs table');
  },

  down: async ({ query }) => {
    await query(`DROP TABLE IF EXISTS branch_report_logs;`);
    console.log('  Dropped branch_report_logs table');
  }
};
