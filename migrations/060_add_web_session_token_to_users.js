const { query } = require('../config/database');

module.exports = {
  up: async () => {
    try {
      // Check if column already exists
      const [columns] = await query(`
        SELECT COLUMN_NAME 
        FROM INFORMATION_SCHEMA.COLUMNS 
        WHERE TABLE_SCHEMA = DATABASE() 
        AND TABLE_NAME = 'users' 
        AND COLUMN_NAME = 'web_session_token'
      `);

      if (!columns) {
        await query('ALTER TABLE users ADD COLUMN web_session_token VARCHAR(255) NULL');
        console.log('✅ Added web_session_token column to users table');
      } else {
        console.log('ℹ️ web_session_token column already exists');
      }
    } catch (error) {
      console.error('Error adding web_session_token column:', error);
      throw error;
    }
  },

  down: async () => {
    try {
      await query('ALTER TABLE users DROP COLUMN web_session_token');
      console.log('✅ Dropped web_session_token column from users table');
    } catch (error) {
      console.error('Error dropping web_session_token column:', error);
      throw error;
    }
  }
};
