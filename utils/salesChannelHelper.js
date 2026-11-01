const { query } = require('../config/database');

/**
 * Menghitung agregasi Sales Channel (Gross, PB1, dan Net) untuk suatu cabang & periode
 * dengan logika Single Source of Truth per transaksi:
 * 1. Mengelompokkan item transaction_sales_channels per sales_channel_id di dalam tiap transaksi
 *    sehingga PB1 (10/110) dihitung per channel per transaksi (bukan per pecahan metode bayar).
 * 2. Merekonsiliasi selisih pembulatan PB1 antar channel terhadap total PB1 transaksi (effective_tx_pb1)
 *    dengan memprioritaskan channel yang memiliki pecahan desimal PB1.
 */
async function computeBranchSystemSalesChannels(branchId, startDate, endDate) {
  const startDateTime = startDate.includes(':') ? startDate : `${startDate} 00:00:00`;
  const endDateTime = endDate.includes(':') ? endDate : `${endDate} 23:59:59`;

  const tscRows = await query(
    `SELECT 
        tsc.id,
        tsc.transaction_id,
        tsc.sales_channel_id,
        sc.name AS sales_channel_name,
        tsc.amount AS gross_amount,
        COALESCE(pm.is_taxable, 0) AS is_taxable,
        t.pb1 AS tx_pb1,
        COALESCE((
            SELECT ROUND(SUM(tid.amount_app) * 10 / 110)
            FROM transaction_income_details tid
            JOIN payment_methods pm_tid ON tid.payment_method_id = pm_tid.id
            WHERE tid.transaction_id = t.id AND pm_tid.is_taxable = 1
        ), t.pb1, 0) AS effective_tx_pb1
     FROM transaction_sales_channels tsc
     JOIN sales_channels sc ON tsc.sales_channel_id = sc.id
     JOIN transactions t ON tsc.transaction_id = t.id
     LEFT JOIN categories c ON t.category_id = c.id
     LEFT JOIN transaction_income_details tid_direct ON tsc.transaction_income_detail_id = tid_direct.id
     LEFT JOIN payment_methods pm ON COALESCE(
         tid_direct.payment_method_id,
         tsc.payment_method_id,
         CASE
             WHEN (SELECT COUNT(*) FROM transaction_income_details tid_c WHERE tid_c.transaction_id = t.id) = 1
             THEN (SELECT tid.payment_method_id FROM transaction_income_details tid WHERE tid.transaction_id = t.id LIMIT 1)
             ELSE NULL
         END
     ) = pm.id
     WHERE t.branch_id = ?
       AND t.transaction_date BETWEEN ? AND ?
       AND t.status_deleted = false AND (t.is_draft = false OR t.is_draft IS NULL)
       AND t.is_umum = true
       AND t.type = 'income'
       AND (c.name NOT LIKE '%Kas Simpanan%' OR c.name IS NULL)`,
    [branchId, startDateTime, endDateTime]
  );

  // Group rows by transaction_id first
  const byTx = new Map();
  for (const row of tscRows) {
    if (!byTx.has(row.transaction_id)) {
      byTx.set(row.transaction_id, {
        effective_tx_pb1: parseFloat(row.effective_tx_pb1) || 0,
        rows: []
      });
    }
    byTx.get(row.transaction_id).rows.push(row);
  }

  // Aggregate per channel across the period
  const channelTotalsMap = new Map();

  for (const [, txData] of byTx.entries()) {
    const groupedMap = new Map();

    for (const scd of txData.rows) {
      const chId = scd.sales_channel_id;
      const gross = parseFloat(scd.gross_amount) || 0;
      const isTax = scd.is_taxable == 1 || scd.is_taxable === true;

      if (!groupedMap.has(chId)) {
        groupedMap.set(chId, {
          sales_channel_id: chId,
          name: scd.sales_channel_name,
          gross_amount: 0,
          taxable_gross: 0,
          pb1_amount: 0,
          net_amount: 0
        });
      }

      const group = groupedMap.get(chId);
      group.gross_amount += gross;
      if (isTax) {
        group.taxable_gross += gross;
      }
    }

    const groupedChannels = Array.from(groupedMap.values());
    groupedChannels.forEach((g) => {
      g.pb1_amount = g.taxable_gross > 0 ? Math.round((g.taxable_gross * 10) / 110) : 0;
      g.net_amount = g.gross_amount - g.pb1_amount;
    });

    // Reconcile channel PB1 sum with authoritative transaction PB1
    const effectiveTxPb1 = txData.effective_tx_pb1;
    const scPb1Sum = groupedChannels.reduce((sum, g) => sum + g.pb1_amount, 0);
    const taxableGroups = groupedChannels.filter((g) => g.taxable_gross > 0);

    if (
      effectiveTxPb1 > 0 &&
      Math.abs(effectiveTxPb1 - scPb1Sum) > 0 &&
      Math.abs(effectiveTxPb1 - scPb1Sum) <= 5 &&
      taxableGroups.length > 0
    ) {
      const diff = effectiveTxPb1 - scPb1Sum;
      taxableGroups.sort((a, b) => {
        const fracA = ((a.taxable_gross * 10) / 110 - a.pb1_amount) * Math.sign(diff);
        const fracB = ((b.taxable_gross * 10) / 110 - b.pb1_amount) * Math.sign(diff);
        if (Math.abs(fracB - fracA) > 0.0001) return fracB - fracA;
        return b.taxable_gross - a.taxable_gross;
      });
      taxableGroups[0].pb1_amount += diff;
      taxableGroups[0].net_amount = taxableGroups[0].gross_amount - taxableGroups[0].pb1_amount;
    }

    for (const g of groupedChannels) {
      if (!channelTotalsMap.has(g.sales_channel_id)) {
        channelTotalsMap.set(g.sales_channel_id, {
          sales_channel_id: g.sales_channel_id,
          name: g.name,
          gross_amount: 0,
          pb1_amount: 0,
          amount: 0
        });
      }
      const stat = channelTotalsMap.get(g.sales_channel_id);
      stat.gross_amount += g.gross_amount;
      stat.pb1_amount += g.pb1_amount;
      stat.amount += g.net_amount;
    }
  }

  return Array.from(channelTotalsMap.values())
    .filter((s) => s.amount > 0 || s.gross_amount > 0)
    .sort((a, b) => {
      if (b.amount !== a.amount) return b.amount - a.amount;
      return (a.name || '').localeCompare(b.name || '');
    });
}

module.exports = {
  computeBranchSystemSalesChannels
};

