const DEFAULT_SOLD_ITEMS = [
  { name: 'Potong 4 Ayam Dioven', unit1_label: 'Ekor', unit2_label: 'Potong', legacy_key: 'ayam_dioven', sort_order: 1 },
  { name: 'Potong 4 Ayam Dijual', unit1_label: 'Ekor', unit2_label: 'Potong', legacy_key: 'ayam_dijual', sort_order: 2 },
  { name: 'Potong 4 Ayam Reject', unit1_label: 'Ekor', unit2_label: 'Potong', legacy_key: 'ayam_reject', sort_order: 3 },
  { name: 'Kambing Presto 1 Kg', unit1_label: 'Ekor', unit2_label: 'Potong', legacy_key: 'kambing_presto', sort_order: 4 },
  { name: 'Kambing Dijual', unit1_label: 'Ekor', unit2_label: 'Potong', legacy_key: 'kambing_dijual', sort_order: 5 },
  { name: 'Tambahan Kambing Kecil', unit1_label: 'Ekor', unit2_label: 'Potong', legacy_key: 'kambing_kecil', sort_order: 6 }
];

module.exports = {
  up: async ({ query }) => {
    await query(`
      CREATE TABLE IF NOT EXISTS cashier_sold_items (
        id INT AUTO_INCREMENT PRIMARY KEY,
        branch_id INT NOT NULL,
        name VARCHAR(150) NOT NULL,
        unit1_label VARCHAR(50) NOT NULL DEFAULT 'Ekor',
        unit2_label VARCHAR(50) NULL DEFAULT 'Potong',
        legacy_key VARCHAR(64) NULL DEFAULT NULL,
        sort_order INT NOT NULL DEFAULT 0,
        is_active TINYINT(1) NOT NULL DEFAULT 1,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_csi_branch_sort (branch_id, is_active, sort_order, id),
        CONSTRAINT fk_csi_branch FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);
    console.log('  Created cashier_sold_items table');

    await query(`
      CREATE TABLE IF NOT EXISTS cashier_report_sold_items (
        id INT AUTO_INCREMENT PRIMARY KEY,
        report_id INT NOT NULL,
        sold_item_id INT NULL DEFAULT NULL,
        item_name VARCHAR(150) NOT NULL DEFAULT '',
        unit1_label VARCHAR(50) NOT NULL DEFAULT 'Ekor',
        unit2_label VARCHAR(50) NULL DEFAULT 'Potong',
        qty1 DECIMAL(15,2) NOT NULL DEFAULT 0,
        qty2 DECIMAL(15,2) NOT NULL DEFAULT 0,
        sort_order INT NOT NULL DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_crsi_report (report_id, sort_order, id),
        INDEX idx_crsi_master (sold_item_id),
        CONSTRAINT fk_crsi_report FOREIGN KEY (report_id) REFERENCES cashier_daily_reports(id) ON DELETE CASCADE,
        CONSTRAINT fk_crsi_master FOREIGN KEY (sold_item_id) REFERENCES cashier_sold_items(id) ON DELETE SET NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);
    console.log('  Created cashier_report_sold_items table');

    const branches = await query(`SELECT id FROM branches`);
    for (const b of branches) {
      const existingMasters = await query(
        `SELECT COUNT(*) as cnt FROM cashier_sold_items WHERE branch_id = ?`,
        [b.id]
      );
      if (Number(existingMasters[0]?.cnt || 0) === 0) {
        for (const def of DEFAULT_SOLD_ITEMS) {
          await query(
            `INSERT INTO cashier_sold_items (branch_id, name, unit1_label, unit2_label, legacy_key, sort_order, is_active)
             VALUES (?, ?, ?, ?, ?, ?, 1)`,
            [b.id, def.name, def.unit1_label, def.unit2_label, def.legacy_key, def.sort_order]
          );
        }
      }
    }

    const masters = await query(`SELECT id, branch_id, name, unit1_label, unit2_label, legacy_key, sort_order FROM cashier_sold_items`);
    const masterByBranchAndLegacy = new Map();
    for (const m of masters) {
      if (m.legacy_key) {
        masterByBranchAndLegacy.set(`${m.branch_id}:${m.legacy_key}`, m);
      }
    }

    const reports = await query(`
      SELECT id, branch_id,
             ayam_dioven_ekor, ayam_dioven_potong,
             ayam_dijual_ekor, ayam_dijual_potong,
             ayam_reject_ekor, ayam_reject_potong,
             kambing_presto_ekor, kambing_presto_potong,
             kambing_dijual_ekor, kambing_dijual_potong,
             kambing_kecil_ekor, kambing_kecil_potong
      FROM cashier_daily_reports
    `);

    for (const rep of reports) {
      const existingRows = await query(
        `SELECT COUNT(*) as cnt FROM cashier_report_sold_items WHERE report_id = ?`,
        [rep.id]
      );
      if (Number(existingRows[0]?.cnt || 0) > 0) continue;

      const legacyPairs = [
        { legacy_key: 'ayam_dioven', q1: rep.ayam_dioven_ekor, q2: rep.ayam_dioven_potong },
        { legacy_key: 'ayam_dijual', q1: rep.ayam_dijual_ekor, q2: rep.ayam_dijual_potong },
        { legacy_key: 'ayam_reject', q1: rep.ayam_reject_ekor, q2: rep.ayam_reject_potong },
        { legacy_key: 'kambing_presto', q1: rep.kambing_presto_ekor, q2: rep.kambing_presto_potong },
        { legacy_key: 'kambing_dijual', q1: rep.kambing_dijual_ekor, q2: rep.kambing_dijual_potong },
        { legacy_key: 'kambing_kecil', q1: rep.kambing_kecil_ekor, q2: rep.kambing_kecil_potong }
      ];

      for (let i = 0; i < DEFAULT_SOLD_ITEMS.length; i++) {
        const def = DEFAULT_SOLD_ITEMS[i];
        const pair = legacyPairs[i];
        const m = masterByBranchAndLegacy.get(`${rep.branch_id}:${def.legacy_key}`);
        await query(
          `INSERT INTO cashier_report_sold_items
           (report_id, sold_item_id, item_name, unit1_label, unit2_label, qty1, qty2, sort_order)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            rep.id,
            m ? m.id : null,
            m ? m.name : def.name,
            m ? m.unit1_label : def.unit1_label,
            m ? m.unit2_label : def.unit2_label,
            Number(pair.q1 || 0),
            Number(pair.q2 || 0),
            def.sort_order
          ]
        );
      }
    }
    console.log(`  Seeded cashier_sold_items for ${branches.length} branches & backfilled ${reports.length} reports`);
  },

  down: async ({ query }) => {
    await query(`DROP TABLE IF EXISTS cashier_report_sold_items;`);
    console.log('  Dropped cashier_report_sold_items table');
    await query(`DROP TABLE IF EXISTS cashier_sold_items;`);
    console.log('  Dropped cashier_sold_items table');
  }
};
