module.exports = {
    up: async ({ query }) => {
        // 1. Tambah kolom transaction_mitra_detail_id
        await query(`
            ALTER TABLE transaction_repayments 
            ADD COLUMN transaction_mitra_detail_id INT NULL AFTER mitra_piutang_id,
            ADD CONSTRAINT fk_tr_transaction_mitra_detail FOREIGN KEY (transaction_mitra_detail_id) REFERENCES transaction_mitra_details(id) ON DELETE SET NULL
        `);
        console.log('  Added transaction_mitra_detail_id to transaction_repayments table');

        // 2. Petakan data pelunasan yang sudah ada ke alokasi mitra yang cocok (gunakan MIN(id) jika ada duplikat)
        await query(`
            UPDATE transaction_repayments tr
            JOIN (
                SELECT transaction_id, mitra_piutang_id, MIN(id) as detail_id
                FROM transaction_mitra_details
                GROUP BY transaction_id, mitra_piutang_id
            ) tmd ON tr.transaction_id = tmd.transaction_id AND tr.mitra_piutang_id = tmd.mitra_piutang_id
            SET tr.transaction_mitra_detail_id = tmd.detail_id
        `);
        console.log('  Mapped existing transaction_repayments to transaction_mitra_details');
    },

    down: async ({ query }) => {
        await query(`ALTER TABLE transaction_repayments DROP FOREIGN KEY fk_tr_transaction_mitra_detail`);
        await query(`ALTER TABLE transaction_repayments DROP COLUMN transaction_mitra_detail_id`);
        console.log('  Dropped transaction_mitra_detail_id from transaction_repayments table');
    }
};
