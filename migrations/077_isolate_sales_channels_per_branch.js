module.exports = {
  up: async ({ query }) => {
    // 1. Assign existing global channels (1, 2, 3, 4, 5) to branch 20 (BOSGIL MALANG) where transactions were recorded
    await query(`
      UPDATE sales_channels 
      SET branch_id = 20 
      WHERE branch_id IS NULL AND id IN (1, 2, 3, 4, 5)
    `);

    // 2. Clone channels for branch 12 (BOSGIL KARAWACI) which also had transactions on these channels
    const channelsToClone = [
      { oldId: 1, name: '1. Omzet Dine In', desc: 'Penjualan langsung di outlet/kasir', active: 1, deleted: 0 },
      { oldId: 2, name: '3. Omzet Online', desc: 'Pesanan melalui platform GrabFood', active: 1, deleted: 0 },
      { oldId: 3, name: 'GoFood', desc: 'Pesanan melalui platform GoFood', active: 1, deleted: 1 },
      { oldId: 4, name: '4. Omzet Admin Pesanan', desc: 'Pesanan melalui platform ShopeeFood', active: 1, deleted: 0 },
      { oldId: 5, name: '2. Omzet Take Away', desc: 'Pesanan bungkus / WhatsApp delivery', active: 1, deleted: 0 },
    ];

    for (const ch of channelsToClone) {
      const res = await query(
        `INSERT INTO sales_channels (branch_id, name, description, is_active, status_deleted)
         VALUES (12, ?, ?, ?, ?)`,
        [ch.name, ch.desc, ch.active, ch.deleted]
      );
      const newChannelId = res.insertId;

      // Update branch 12's transactions to point to this new branch 12 channel
      await query(`
        UPDATE transaction_sales_channels tsc
        JOIN transactions t ON tsc.transaction_id = t.id
        SET tsc.sales_channel_id = ?
        WHERE t.branch_id = 12 AND tsc.sales_channel_id = ?
      `, [newChannelId, ch.oldId]);
    }

    // 3. For any remaining channels with branch_id IS NULL (if any), delete them or assign to branch 14
    await query(`DELETE FROM sales_channels WHERE branch_id IS NULL`);

    // 4. Seed default channels for branch 14 (BOSGIL BSD) so it has its own channels
    const defaultChannels = [
      { name: 'Dine In', desc: 'Penjualan langsung di outlet/kasir' },
      { name: 'Take Away', desc: 'Pesanan bungkus / WhatsApp delivery' },
      { name: 'GrabFood', desc: 'Pesanan melalui platform GrabFood' },
      { name: 'ShopeeFood', desc: 'Pesanan melalui platform ShopeeFood' },
      { name: 'GoFood', desc: 'Pesanan melalui platform GoFood' }
    ];

    for (const d of defaultChannels) {
      await query(
        `INSERT INTO sales_channels (branch_id, name, description, is_active, status_deleted)
         VALUES (14, ?, ?, 1, 0)`,
        [d.name, d.desc]
      );
    }

    // 5. Alter table to make branch_id NOT NULL
    await query(`
      ALTER TABLE sales_channels 
      MODIFY COLUMN branch_id INT NOT NULL
    `);

    console.log('  Isolated sales_channels per branch and updated transaction references');
  },

  down: async ({ query }) => {
    await query(`
      ALTER TABLE sales_channels 
      MODIFY COLUMN branch_id INT NULL
    `);
    console.log('  Reverted sales_channels.branch_id to NULLable');
  }
};
