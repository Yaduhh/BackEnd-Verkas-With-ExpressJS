module.exports = {
  up: async ({ query }) => {
    await query(`
      CREATE TABLE payment_methods (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        branch_id INT DEFAULT NULL,
        is_active TINYINT(1) DEFAULT 1,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        CONSTRAINT fk_pm_branch FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE CASCADE
      )
    `);
    console.log('  Created payment_methods table');
  },

  down: async ({ query }) => {
    await query(`DROP TABLE IF EXISTS payment_methods`);
    console.log('  Dropped payment_methods table');
  }
};
