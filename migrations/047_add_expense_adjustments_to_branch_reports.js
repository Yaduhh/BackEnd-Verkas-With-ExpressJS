module.exports = {
    up: async ({ query }) => {
        await query(`
            ALTER TABLE branch_reports 
            ADD COLUMN expense_adjustments JSON NULL AFTER bagi_hasil
        `);
        console.log('  Added expense_adjustments column to branch_reports table');
    },

    down: async ({ query }) => {
        await query(`
            ALTER TABLE branch_reports 
            DROP COLUMN expense_adjustments
        `);
        console.log('  Dropped expense_adjustments column from branch_reports table');
    }
};
