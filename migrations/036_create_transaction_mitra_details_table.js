module.exports = {
    up: async ({ query }) => {
        await query(`
      CREATE TABLE transaction_mitra_details (
        id INT AUTO_INCREMENT PRIMARY KEY,
        transaction_id INT NOT NULL,
        mitra_piutang_id INT NOT NULL,
        amount DECIMAL(15,2) NOT NULL DEFAULT 0,
        paid_amount DECIMAL(15,2) NOT NULL DEFAULT 0,
        remaining_debt DECIMAL(15,2) NOT NULL DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        CONSTRAINT fk_tmd_transaction FOREIGN KEY (transaction_id) REFERENCES transactions(id) ON DELETE CASCADE,
        CONSTRAINT fk_tmd_mitra FOREIGN KEY (mitra_piutang_id) REFERENCES mitra_piutang(id) ON DELETE CASCADE
      )
    `);

        // Add index for better performance
        await query(`CREATE INDEX idx_tmd_transaction_id ON transaction_mitra_details(transaction_id)`);
        await query(`CREATE INDEX idx_tmd_mitra_id ON transaction_mitra_details(mitra_piutang_id)`);

        console.log('  Created transaction_mitra_details table');
    },

    down: async ({ query }) => {
        await query(`DROP TABLE IF EXISTS transaction_mitra_details`);
        console.log('  Dropped transaction_mitra_details table');
    }
};
