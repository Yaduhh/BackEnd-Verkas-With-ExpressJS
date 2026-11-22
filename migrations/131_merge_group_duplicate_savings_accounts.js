const { transaction: dbTransaction } = require('../config/database');

module.exports = {
  up: async ({ query }) => {
    await query(`
      INSERT IGNORE INTO bank_account_branches (bank_account_id, branch_id)
      SELECT id, branch_id
      FROM bank_accounts
      WHERE branch_id IS NOT NULL AND is_active = 1
    `);

    const duplicateGroups = await query(`
      SELECT b.group_name, TRIM(ba.account_number) as acct_no,
             GROUP_CONCAT(ba.id ORDER BY ba.id ASC SEPARATOR ',') as ids
      FROM bank_accounts ba
      JOIN branches b ON ba.branch_id = b.id
      WHERE ba.is_active = 1
        AND ba.type = 'savings'
        AND b.group_name IS NOT NULL
        AND TRIM(b.group_name) != ''
        AND ba.account_number IS NOT NULL
        AND TRIM(ba.account_number) != ''
      GROUP BY b.group_name, TRIM(ba.account_number)
      HAVING COUNT(*) > 1
    `);

    if (duplicateGroups.length > 0) {
      await dbTransaction(async (conn) => {
        for (const grp of duplicateGroups) {
          const idList = String(grp.ids)
            .split(',')
            .map((v) => parseInt(v, 10))
            .filter((v) => Number.isFinite(v) && v > 0);
          if (idList.length < 2) continue;

          const masterId = idList[0];
          const dupIds = idList.slice(1);

          const [allRows] = await conn.execute(
            `SELECT id, branch_id FROM bank_accounts WHERE id IN (${idList.map(() => '?').join(',')}) ORDER BY id ASC`,
            idList
          );

          for (const row of allRows) {
            if (row.branch_id) {
              await conn.execute(
                `INSERT IGNORE INTO bank_account_branches (bank_account_id, branch_id) VALUES (?, ?)`,
                [masterId, row.branch_id]
              );
            }
          }

          for (const dupId of dupIds) {
            // Preserve any existing shared branch mappings on duplicate
            const [dupBranchRows] = await conn.execute(
              `SELECT branch_id FROM bank_account_branches WHERE bank_account_id = ?`,
              [dupId]
            );
            for (const dbr of dupBranchRows) {
              if (dbr.branch_id) {
                await conn.execute(
                  `INSERT IGNORE INTO bank_account_branches (bank_account_id, branch_id) VALUES (?, ?)`,
                  [masterId, dbr.branch_id]
                );
              }
            }

            // Safely merge savings_account_allocations (respecting UNIQUE(category_id, bank_account_id))
            const [allocRows] = await conn.execute(
              `SELECT category_id, allocated_amount FROM savings_account_allocations WHERE bank_account_id = ?`,
              [dupId]
            );
            for (const ar of allocRows) {
              await conn.execute(
                `INSERT INTO savings_account_allocations (category_id, bank_account_id, allocated_amount)
                 VALUES (?, ?, ?)
                 ON DUPLICATE KEY UPDATE allocated_amount = allocated_amount + VALUES(allocated_amount)`,
                [ar.category_id, masterId, ar.allocated_amount]
              );
            }
            await conn.execute(
              `DELETE FROM savings_account_allocations WHERE bank_account_id = ?`,
              [dupId]
            );

            // Re-point any transaction / transfer / cashier references to masterId
            await conn.execute(`UPDATE transactions SET bank_account_id = ? WHERE bank_account_id = ?`, [masterId, dupId]);
            await conn.execute(`UPDATE transaction_income_details SET bank_account_id = ? WHERE bank_account_id = ?`, [masterId, dupId]);
            await conn.execute(`UPDATE fund_transfers SET from_bank_account_id = ? WHERE from_bank_account_id = ?`, [masterId, dupId]);
            await conn.execute(`UPDATE fund_transfers SET to_bank_account_id = ? WHERE to_bank_account_id = ?`, [masterId, dupId]);
            await conn.execute(`UPDATE petty_cashes SET bank_account_id = ? WHERE bank_account_id = ?`, [masterId, dupId]);
            await conn.execute(`UPDATE petty_cash_transactions SET bank_account_id = ? WHERE bank_account_id = ?`, [masterId, dupId]);
            await conn.execute(`UPDATE payment_methods SET default_bank_account_id = ? WHERE default_bank_account_id = ?`, [masterId, dupId]);
            await conn.execute(`UPDATE cashier_report_omzet_items SET bank_account_id = ? WHERE bank_account_id = ?`, [masterId, dupId]);
            await conn.execute(`UPDATE cashier_report_orders SET bank_account_id = ? WHERE bank_account_id = ?`, [masterId, dupId]);
            await conn.execute(`UPDATE cashier_report_orders SET settlement_bank_account_id = ? WHERE settlement_bank_account_id = ?`, [masterId, dupId]);
            await conn.execute(`UPDATE cashier_report_piutang_items SET bank_account_id = ? WHERE bank_account_id = ?`, [masterId, dupId]);

            await conn.execute(`DELETE FROM bank_account_branches WHERE bank_account_id = ?`, [dupId]);
            await conn.execute(`UPDATE bank_accounts SET is_active = 0 WHERE id = ?`, [dupId]);
          }

          console.log(`  Merged savings group "${grp.group_name}" account ${grp.acct_no}: [${dupIds.join(', ')}] -> #${masterId}`);
        }
      });
    } else {
      console.log('  No duplicate savings accounts found to merge');
    }
  },

  down: async () => {
    console.log('  No-op rollback for savings account merge migration');
  }
};
