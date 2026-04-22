module.exports = {
    up: async ({ query }) => {
        await query(`
            ALTER TABLE branch_reports 
            ADD COLUMN expense_order JSON NULL AFTER expense_adjustments
        `);
        console.log('  Added expense_order column to branch_reports table');
    },

    down: async ({ query }) => {
        await query(`
            ALTER TABLE branch_reports 
            DROP COLUMN expense_order
        `);
        console.log('  Dropped expense_order column from branch_reports table');
    }
};
