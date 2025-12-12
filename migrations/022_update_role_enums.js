module.exports = {
  up: async ({ query }) => {
    try {
      // Update users.role enum: add 'master' and 'co-owner'
      await query(`
        ALTER TABLE users
        MODIFY COLUMN role ENUM('master', 'owner', 'co-owner', 'admin') NOT NULL DEFAULT 'admin'
      `);
      console.log('  Updated users.role enum to include master, owner, co-owner, admin');
    } catch (error) {
      if (error.message.includes('Duplicate column') || error.message.includes('already exists')) {
        console.log('  users.role enum might already be updated, skipping');
      } else {
        throw error;
      }
    }

    try {
      // Update owner_team_members.role enum: add 'co-owner'
      await query(`
        ALTER TABLE owner_team_members
        MODIFY COLUMN role ENUM('owner', 'co-owner', 'member') DEFAULT 'member'
      `);
      console.log('  Updated owner_team_members.role enum to include owner, co-owner, member');
    } catch (error) {
      if (error.message.includes('Duplicate column') || error.message.includes('already exists')) {
        console.log('  owner_team_members.role enum might already be updated, skipping');
      } else {
        throw error;
      }
    }

    try {
      // Update activity_logs.user_role enum: add 'master' and 'co-owner'
      await query(`
        ALTER TABLE activity_logs
        MODIFY COLUMN user_role ENUM('master', 'owner', 'co-owner', 'admin') NOT NULL
      `);
      console.log('  Updated activity_logs.user_role enum to include master, owner, co-owner, admin');
    } catch (error) {
      // Table might not exist yet, or enum already updated
      if (error.message.includes("doesn't exist") || 
          error.message.includes('Duplicate column') || 
          error.message.includes('already exists')) {
        console.log('  activity_logs.user_role enum might not exist or already updated, skipping');
      } else {
        throw error;
      }
    }
  },
  
  down: async ({ query }) => {
    try {
      // Revert users.role enum back to original
      await query(`
        ALTER TABLE users
        MODIFY COLUMN role ENUM('owner', 'admin') NOT NULL DEFAULT 'admin'
      `);
      console.log('  Reverted users.role enum to owner, admin');
    } catch (error) {
      console.log('  Error reverting users.role enum:', error.message);
    }

    try {
      // Revert owner_team_members.role enum back to original
      await query(`
        ALTER TABLE owner_team_members
        MODIFY COLUMN role ENUM('owner', 'member') DEFAULT 'member'
      `);
      console.log('  Reverted owner_team_members.role enum to owner, member');
    } catch (error) {
      console.log('  Error reverting owner_team_members.role enum:', error.message);
    }

    try {
      // Revert activity_logs.user_role enum back to original
      await query(`
        ALTER TABLE activity_logs
        MODIFY COLUMN user_role ENUM('owner', 'admin') NOT NULL
      `);
      console.log('  Reverted activity_logs.user_role enum to owner, admin');
    } catch (error) {
      console.log('  Error reverting activity_logs.user_role enum:', error.message);
    }
  }
};
