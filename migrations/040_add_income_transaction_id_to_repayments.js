module.exports = {
    up: async ({ query }) => {
        await query(`
            ALTER TABLE transaction_repayments 
            ADD COLUMN income_transaction_id INT NULL AFTER user_id,
            ADD CONSTRAINT fk_tr_income_transaction FOREIGN KEY (income_transaction_id) REFERENCES transactions(id) ON DELETE SET NULL
        `);
        console.log('  Added income_transaction_id to transaction_repayments table');
    },

    down: async ({ query }) => {
        await query(`ALTER TABLE transaction_repayments DROP FOREIGN KEY fk_tr_income_transaction`);
        await query(`ALTER TABLE transaction_repayments DROP COLUMN income_transaction_id`);
        console.log('  Dropped income_transaction_id from transaction_repayments table');
    }
};
