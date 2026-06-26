module.exports = {
  up: async ({ query }) => {
    await query(`
      CREATE TABLE IF NOT EXISTS savings_account_allocations (
        id INT AUTO_INCREMENT PRIMARY KEY,
        category_id INT NOT NULL,
        payment_method_id INT NOT NULL,
        allocated_amount DECIMAL(15, 2) NOT NULL DEFAULT 0.00,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        CONSTRAINT fk_saa_category FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE CASCADE,
        CONSTRAINT fk_saa_payment_method FOREIGN KEY (payment_method_id) REFERENCES payment_methods(id) ON DELETE CASCADE,
        CONSTRAINT uq_saa_category_payment_method UNIQUE (category_id, payment_method_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
    `);
    console.log('  Successfully created savings_account_allocations table');
  },
  
  down: async ({ query }) => {
    await query(`DROP TABLE IF EXISTS savings_account_allocations`);
    console.log('  Successfully dropped savings_account_allocations table');
  }
};
