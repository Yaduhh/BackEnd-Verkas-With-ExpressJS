module.exports = {
    up: async ({ query }) => {
        await query(`ALTER TABLE transactions ADD COLUMN pb1 DECIMAL(15,2) DEFAULT NULL AFTER amount`);
        console.log('  Added pb1 column to transactions table');
    },

    down: async ({ query }) => {
        await query(`ALTER TABLE transactions DROP COLUMN pb1`);
        console.log('  Dropped pb1 column from transactions table');
    }
};
