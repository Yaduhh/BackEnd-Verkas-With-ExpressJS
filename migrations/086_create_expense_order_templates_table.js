module.exports = {
  up: async ({ query }) => {
    await query(`
      CREATE TABLE IF NOT EXISTS expense_order_templates (
        id INT AUTO_INCREMENT PRIMARY KEY,
        branch_id INT NOT NULL,
        name VARCHAR(255) NOT NULL,
        template_data JSON NOT NULL,
        is_default TINYINT(1) DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        CONSTRAINT fk_eot_branch FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    try {
      await query(`CREATE INDEX idx_eot_branch_id ON expense_order_templates(branch_id)`);
    } catch (e) {
      console.log('Index idx_eot_branch_id may already exist');
    }

    console.log('  Created expense_order_templates table');
  },

  down: async ({ query }) => {
    await query(`DROP TABLE IF EXISTS expense_order_templates`);
    console.log('  Dropped expense_order_templates table');
  }
};
