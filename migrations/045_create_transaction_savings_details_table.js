module.exports = {
  up: async ({ query }) => {
    await query(`
      CREATE TABLE transaction_savings_details (
        id INT AUTO_INCREMENT PRIMARY KEY,
        transaction_id INT NOT NULL,
        category_id INT NOT NULL,
        amount DECIMAL(15,2) NOT NULL DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        CONSTRAINT fk_tsd_transaction FOREIGN KEY (transaction_id) REFERENCES transactions(id) ON DELETE CASCADE,
        CONSTRAINT fk_tsd_category FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE CASCADE
      )
    `);

    // Add index for better performance
    await query(`CREATE INDEX idx_tsd_transaction_id ON transaction_savings_details(transaction_id)`);
    await query(`CREATE INDEX idx_tsd_category_id ON transaction_savings_details(category_id)`);

    console.log('  Created transaction_savings_details table');
  },

  down: async ({ query }) => {
    await query(`DROP TABLE IF EXISTS transaction_savings_details`);
    console.log('  Dropped transaction_savings_details table');
  }
};
