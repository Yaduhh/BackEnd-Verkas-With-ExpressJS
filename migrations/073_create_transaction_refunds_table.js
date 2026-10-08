module.exports = {
  up: async ({ query }) => {
    await query(`
      CREATE TABLE IF NOT EXISTS transaction_refunds (
        id INT AUTO_INCREMENT PRIMARY KEY,
        transaction_id INT NOT NULL,
        user_id INT NOT NULL,
        amount DECIMAL(15,2) NOT NULL,
        refund_date DATE NOT NULL,
        note TEXT,
        lampiran TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        CONSTRAINT fk_tref_transaction FOREIGN KEY (transaction_id) REFERENCES transactions(id) ON DELETE CASCADE,
        CONSTRAINT fk_tref_user FOREIGN KEY (user_id) REFERENCES users(id)
      )
    `);

    try {
      await query(`CREATE INDEX idx_tref_transaction_id ON transaction_refunds(transaction_id)`);
    } catch (e) {
      console.log('Index idx_tref_transaction_id may already exist');
    }

    console.log('  Created transaction_refunds table');
  },

  down: async ({ query }) => {
    await query(`DROP TABLE IF EXISTS transaction_refunds`);
    console.log('  Dropped transaction_refunds table');
  }
};
