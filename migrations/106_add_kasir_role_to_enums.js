module.exports = {
  up: async ({ query }) => {
    try {
      // Update users.role enum: add 'kasir'
      await query(`
        ALTER TABLE users
        MODIFY COLUMN role ENUM('master', 'owner', 'co-owner', 'admin', 'kasir') NOT NULL DEFAULT 'admin'
      `);
      console.log('  Updated users.role enum to include master, owner, co-owner, admin, kasir');
    } catch (error) {
      if (error.message.includes('Duplicate column') || error.message.includes('already exists')) {
        console.log('  users.role enum might already be updated, skipping');
      } else {
        throw error;
      }
    }

    try {
      // Update activity_logs.user_role enum: add 'kasir'
      await query(`
        ALTER TABLE activity_logs
        MODIFY COLUMN user_role ENUM('master', 'owner', 'co-owner', 'admin', 'kasir') NOT NULL
      `);
      console.log('  Updated activity_logs.user_role enum to include master, owner, co-owner, admin, kasir');
    } catch (error) {
      if (
        error.message.includes("doesn't exist") ||
        error.message.includes('Duplicate column') ||
        error.message.includes('already exists')
      ) {
        console.log('  activity_logs.user_role enum might not exist or already updated, skipping');
      } else {
        throw error;
      }
    }
  },

  down: async ({ query }) => {
    try {
      // Revert any 'kasir' users back to 'admin' before shrinking enum
      await query(`UPDATE users SET role = 'admin' WHERE role = 'kasir'`);
      await query(`
        ALTER TABLE users
        MODIFY COLUMN role ENUM('master', 'owner', 'co-owner', 'admin') NOT NULL DEFAULT 'admin'
      `);
      console.log('  Reverted users.role enum to master, owner, co-owner, admin');
    } catch (error) {
      console.log('  Error reverting users.role enum:', error.message);
    }

    try {
      await query(`UPDATE activity_logs SET user_role = 'admin' WHERE user_role = 'kasir'`);
      await query(`
        ALTER TABLE activity_logs
        MODIFY COLUMN user_role ENUM('master', 'owner', 'co-owner', 'admin') NOT NULL
      `);
      console.log('  Reverted activity_logs.user_role enum to master, owner, co-owner, admin');
    } catch (error) {
      console.log('  Error reverting activity_logs.user_role enum:', error.message);
    }
  }
};
