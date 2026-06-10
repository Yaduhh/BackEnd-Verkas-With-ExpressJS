module.exports = {
  up: async ({ query }) => {
    await query(`
      CREATE TABLE IF NOT EXISTS system_settings (
        \`key\` VARCHAR(255) PRIMARY KEY,
        \`value\` TEXT,
        \`updated_at\` TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      )
    `);
    console.log('  Successfully created system_settings table');
  },
  
  down: async ({ query }) => {
    await query(`
      DROP TABLE IF EXISTS system_settings
    `);
    console.log('  Successfully dropped system_settings table');
  }
};
