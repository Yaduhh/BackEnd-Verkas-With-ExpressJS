module.exports = {
    up: async ({ query }) => {
        await query(`ALTER TABLE categories ADD COLUMN type ENUM('income', 'expense', 'both') DEFAULT 'both' AFTER name`);
        console.log('  Added type column to categories table');
    },

    down: async ({ query }) => {
        await query(`ALTER TABLE categories DROP COLUMN type`);
        console.log('  Dropped type column from categories table');
    }
};
