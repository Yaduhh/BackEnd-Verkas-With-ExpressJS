module.exports = {
  up: async ({ query }) => {
    await query(`
      CREATE TABLE IF NOT EXISTS transaction_income_details (
        id INT AUTO_INCREMENT PRIMARY KEY,
        transaction_id INT NOT NULL,
        payment_method_id INT NOT NULL,
        amount DECIMAL(15,2) NOT NULL DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        CONSTRAINT fk_tid_transaction FOREIGN KEY (transaction_id) REFERENCES transactions(id) ON DELETE CASCADE,
        CONSTRAINT fk_tid_payment_method FOREIGN KEY (payment_method_id) REFERENCES payment_methods(id) ON DELETE CASCADE
      )
    `);

    // Add index for better performance (wrapped in try-catch because MySQL doesn't support CREATE INDEX IF NOT EXISTS)
    try {
      await query(`CREATE INDEX idx_tid_transaction_id ON transaction_income_details(transaction_id)`);
      await query(`CREATE INDEX idx_tid_payment_method_id ON transaction_income_details(payment_method_id)`);
    } catch (e) {
      console.log('  Indexes might already exist, skipping...');
    }

    console.log('  Created transaction_income_details table');
  },

  down: async ({ query }) => {
    await query(`DROP TABLE IF EXISTS transaction_income_details`);
    console.log('  Dropped transaction_income_details table');
  }
};
