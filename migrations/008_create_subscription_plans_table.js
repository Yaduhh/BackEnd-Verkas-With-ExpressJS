module.exports = {
  up: async ({ query }) => {
    await query(`
      CREATE TABLE subscription_plans (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        description TEXT,
        max_branches INT NULL,
        price_monthly DECIMAL(10,2) NULL,
        price_yearly DECIMAL(10,2) NULL,
        features JSON,
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_plans_is_active (is_active),
        UNIQUE KEY unique_plan_name (name)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    
    // Seed default plans
    await query(`
      INSERT INTO subscription_plans (name, description, max_branches, price_monthly, price_yearly, features) VALUES
      ('Free', 'Free plan dengan 1 branch', 1, 0, 0, '["1 Branch", "Basic Features"]'),
      ('Basic', '5 branches', 5, 50000, 500000, '["5 Branches", "All Features"]'),
      ('Pro', '20 branches', 20, 150000, 1500000, '["20 Branches", "All Features", "Priority Support"]'),
      ('Enterprise', 'Unlimited branches', NULL, 300000, 3000000, '["Unlimited Branches", "All Features", "Priority Support", "Custom Features"]')
    `);
    
    console.log('  Created subscription_plans table');
    console.log('  Seeded default subscription plans');
  },
  
  down: async ({ query }) => {
    await query(`DROP TABLE IF EXISTS subscription_plans`);
    console.log('  Dropped subscription_plans table');
  }
};

