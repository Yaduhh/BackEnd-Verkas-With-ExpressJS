module.exports = {
    up: async ({ query }) => {
        await query(`
      CREATE TABLE transaction_repayments (
        id INT AUTO_INCREMENT PRIMARY KEY,
        transaction_id INT NOT NULL,
        mitra_piutang_id INT NOT NULL,
        user_id INT NOT NULL,
        amount DECIMAL(15,2) NOT NULL,
        payment_date DATE NOT NULL,
        note TEXT,
        lampiran TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        CONSTRAINT fk_tr_transaction FOREIGN KEY (transaction_id) REFERENCES transactions(id) ON DELETE CASCADE,
        CONSTRAINT fk_tr_mitra FOREIGN KEY (mitra_piutang_id) REFERENCES mitra_piutang(id) ON DELETE CASCADE,
        CONSTRAINT fk_tr_user FOREIGN KEY (user_id) REFERENCES users(id)
      )
    `);

        // Add indexes
        await query(`CREATE INDEX idx_tr_transaction_id ON transaction_repayments(transaction_id)`);
        await query(`CREATE INDEX idx_tr_mitra_id ON transaction_repayments(mitra_piutang_id)`);

        console.log('  Created transaction_repayments table');
    },

    down: async ({ query }) => {
        await query(`DROP TABLE IF EXISTS transaction_repayments`);
        console.log('  Dropped transaction_repayments table');
    }
};
