module.exports = {
    up: async ({ query }) => {
        await query(`
            ALTER TABLE transactions 
            MODIFY COLUMN category_id INT NULL
        `);
        console.log('  Modified category_id to be nullable in transactions table');
    },

    down: async ({ query }) => {
        // Warning: Changing it back to NOT NULL might fail if there are rows with NULL category_id
        await query(`
            ALTER TABLE transactions 
            MODIFY COLUMN category_id INT NOT NULL
        `);
        console.log('  Modified category_id to be NOT NULL in transactions table');
    }
};
