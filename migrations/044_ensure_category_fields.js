/**
 * Migration: Ensure type column exists in categories table
 * Date: 2026-03-07
 * Description: Adds the type column back to categories table if it was missing
 */

module.exports = {
    up: async ({ query }) => {
        console.log('  Ensuring categories table has all required columns...');

        // We use a safe approach to add columns if they don't exist
        // Note: MySQL doesn't have "ADD COLUMN IF NOT EXISTS" for older versions, 
        // but we can check the table structure first or just run migrations.

        try {
            await query(`ALTER TABLE categories ADD COLUMN type ENUM('income', 'expense', 'both') DEFAULT 'both' AFTER name`);
            console.log('  ✅ Added type column');
        } catch (err) {
            if (err.code === 'ER_DUP_COLUMN_NAME' || err.message.includes('Duplicate column name')) {
                console.log('  ℹ️ Column type already exists, skipping...');
            } else {
                throw err;
            }
        }

        try {
            await query(`ALTER TABLE categories ADD COLUMN is_folder TINYINT(1) DEFAULT 0 AFTER type`);
            console.log('  ✅ Added is_folder column');
        } catch (err) {
            if (err.code === 'ER_DUP_COLUMN_NAME' || err.message.includes('Duplicate column name')) {
                console.log('  ℹ️ Column is_folder already exists, skipping...');
            } else {
                throw err;
            }
        }

        try {
            await query(`ALTER TABLE categories ADD COLUMN parent_id INT NULL AFTER is_folder`);
            console.log('  ✅ Added parent_id column');
        } catch (err) {
            if (err.code === 'ER_DUP_COLUMN_NAME' || err.message.includes('Duplicate column name')) {
                console.log('  ℹ️ Column parent_id already exists, skipping...');
            } else {
                throw err;
            }
        }
    },

    down: async ({ query }) => {
        console.log('  Removing added columns...');
        try {
            await query(`ALTER TABLE categories DROP COLUMN type, DROP COLUMN is_folder, DROP COLUMN parent_id`);
            console.log('  ✅ Columns removed');
        } catch (err) {
            console.log('  ⚠️ Error during rollback:', err.message);
        }
    }
};
