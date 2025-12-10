module.exports = {
  up: async ({ query }) => {
    await query(`
      CREATE TABLE subscriptions (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT NOT NULL,
        plan_id INT NOT NULL,
        billing_period ENUM('monthly', 'yearly') NOT NULL,
        status ENUM('active', 'expired', 'cancelled', 'pending') DEFAULT 'pending',
        start_date DATE NOT NULL,
        end_date DATE NOT NULL,
        auto_renew BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_subscriptions_user_id (user_id),
        INDEX idx_subscriptions_plan_id (plan_id),
        INDEX idx_subscriptions_status (status),
        INDEX idx_subscriptions_end_date (end_date),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (plan_id) REFERENCES subscription_plans(id) ON DELETE RESTRICT
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    
    console.log('  Created subscriptions table');
  },
  
  down: async ({ query }) => {
    await query(`DROP TABLE IF EXISTS subscriptions`);
    console.log('  Dropped subscriptions table');
  }
};

