/**
 * Migration: Remove category type column
 * Date: 2026-02-16
 * Description: Remove type column - all categories are now flexible and can be used for both income and expense
 */

module.exports = {
    async up({ query }) {
        console.log('  Removing type column from categories table...');

        // Drop the type column
        await query(`
      ALTER TABLE categories 
      DROP COLUMN type
    `);

        console.log('  ✅ Type column removed - all categories are now flexible!');
    },

    async down({ query }) {
        console.log('  Adding back type column...');

        // Add type column back with default value
        await query(`
      ALTER TABLE categories 
      ADD COLUMN type VARCHAR(20) NULL 
      COMMENT 'Transaction type: income or expense'
    `);

        console.log('  ✅ Type column restored');
    }
};
