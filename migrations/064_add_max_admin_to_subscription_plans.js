module.exports = {
  up: async ({ query }) => {
    await query(`
      ALTER TABLE subscription_plans 
      ADD COLUMN max_admin INT NULL DEFAULT NULL AFTER max_branches
    `);
    
    // Seed default limits for seeded plans
    await query("UPDATE subscription_plans SET max_admin = 1 WHERE name = 'Free'");
    await query("UPDATE subscription_plans SET max_admin = 5 WHERE name = 'Basic'");
    await query("UPDATE subscription_plans SET max_admin = 20 WHERE name = 'Pro'");
    // Enterprise remains NULL (unlimited)
    
    console.log('  Successfully added max_admin column to subscription_plans');
  },
  
  down: async ({ query }) => {
    await query(`
      ALTER TABLE subscription_plans 
      DROP COLUMN max_admin
    `);
    console.log('  Successfully dropped max_admin column from subscription_plans');
  }
};
