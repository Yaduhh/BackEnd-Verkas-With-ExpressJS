module.exports = {
  up: async ({ query }) => {
    await query(`
      CREATE TABLE payments (
        id INT AUTO_INCREMENT PRIMARY KEY,
        subscription_id INT NOT NULL,
        amount DECIMAL(10,2) NOT NULL,
        payment_method ENUM('bank_transfer', 'credit_card', 'e_wallet', 'manual') DEFAULT 'manual',
        payment_provider VARCHAR(50),
        transaction_id VARCHAR(255),
        status ENUM('pending', 'paid', 'failed', 'refunded') DEFAULT 'pending',
        paid_at DATETIME NULL,
        due_date DATE NOT NULL,
        invoice_url TEXT,
        notes TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_payments_subscription_id (subscription_id),
        INDEX idx_payments_status (status),
        INDEX idx_payments_due_date (due_date),
        INDEX idx_payments_transaction_id (transaction_id),
        FOREIGN KEY (subscription_id) REFERENCES subscriptions(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    
    console.log('  Created payments table');
  },
  
  down: async ({ query }) => {
    await query(`DROP TABLE IF EXISTS payments`);
    console.log('  Dropped payments table');
  }
};

