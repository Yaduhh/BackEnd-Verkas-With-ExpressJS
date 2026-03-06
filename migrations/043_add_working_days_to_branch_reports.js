module.exports = {
    up: async ({ query }) => {
        await query(`
            ALTER TABLE branch_reports 
            ADD COLUMN working_days INT DEFAULT 25 AFTER stok_akhir
        `);
        console.log('  Added working_days column to branch_reports table');
    },

    down: async ({ query }) => {
        await query(`
            ALTER TABLE branch_reports 
            DROP COLUMN working_days
        `);
        console.log('  Dropped working_days column from branch_reports table');
    }
};
