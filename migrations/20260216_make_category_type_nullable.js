/**
 * Migration: Make category type nullable
 * Date: 2026-02-16
 * Description: Allow categories to be used for both income and expense transactions
 */

module.exports = {
    async up({ query }) {
        console.log('  Making category type column nullable...');

        // Make type column nullable
        await query(`
      ALTER TABLE categories 
      MODIFY COLUMN type VARCHAR(20) NULL 
      COMMENT 'Transaction type: income, expense, or NULL for flexible categories'
    `);

        console.log('  ✅ Category type is now nullable - categories can be flexible!');
    },

    async down({ query }) {
        console.log('  Reverting category type to NOT NULL...');

        // Note: This will fail if there are NULL values
        // You may want to set a default value first
        await query(`
      UPDATE categories 
      SET type = 'expense' 
      WHERE type IS NULL
    `);

        await query(`
      ALTER TABLE categories 
      MODIFY COLUMN type VARCHAR(20) NOT NULL 
      COMMENT 'Transaction type: income or expense'
    `);

        console.log('  ✅ Category type reverted to NOT NULL');
    }
};
