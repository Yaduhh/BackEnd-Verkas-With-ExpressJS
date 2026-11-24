/**
 * Shared SQL fragments for standardized PB1 calculation across transaction queries,
 * sales channel reports, and branch reports.
 *
 * When a transaction has rows in `transaction_sales_channels` (`tsc_agg`), PB1 is resolved
 * using the exact same channel-grouped rule as `salesChannelController.js` & `salesChannelHelper.js`:
 * 1. If any `tsc.pb1_amount` is non-null: sum `ROUND(SUM(channel_pb1))` grouped per `sales_channel_id`.
 * 2. Else compute `ROUND(taxable_gross * 10 / 110)` per `sales_channel_id`, reconciling <= Rp 5 diffs
 *    to the payment-method/header PB1 (`effective_tx_pb1`).
 * 3. Otherwise fall back to `transaction_income_details` (`tid`) -> `t.pb1` -> `10/110` on taxable `tid` rows.
 */

const tidEffectiveAmountSql = (tidAlias = 'tid') =>
  `(CASE WHEN ${tidAlias}.amount_app > 0 THEN ${tidAlias}.amount_app ELSE ${tidAlias}.amount_cashier END)`;

const getTidAggPb1SelectSql = (tidAlias = 'tid', pmAlias = 'pm') => {
  const amt = tidEffectiveAmountSql(tidAlias);
  return `MAX(CASE WHEN ${tidAlias}.pb1_amount > 0 THEN 1 ELSE 0 END) as has_positive_pb1,
               CASE
                 WHEN COUNT(CASE WHEN ${pmAlias}.is_taxable = 1 OR ${tidAlias}.pb1_amount IS NOT NULL THEN 1 END) = 0 THEN NULL
                 WHEN COUNT(CASE WHEN ${tidAlias}.pb1_amount > 0 THEN 1 END) > 0 THEN
                   ROUND(SUM(CASE WHEN ${pmAlias}.is_taxable = 1 OR ${tidAlias}.pb1_amount IS NOT NULL THEN COALESCE(${tidAlias}.pb1_amount, CASE WHEN ${pmAlias}.is_taxable = 1 THEN ROUND(${amt} * 10 / 110) ELSE 0 END) ELSE 0 END))
                 WHEN COUNT(CASE WHEN ${pmAlias}.is_taxable = 1 AND ${tidAlias}.pb1_amount IS NULL THEN 1 END) > 0 THEN
                   ROUND(SUM(CASE WHEN ${pmAlias}.is_taxable = 1 THEN ${amt} ELSE 0 END) * 10 / 110)
                 WHEN COUNT(${tidAlias}.pb1_amount) > 0 THEN
                   0
                 ELSE
                   ROUND(SUM(CASE WHEN ${pmAlias}.is_taxable = 1 THEN ${amt} ELSE 0 END) * 10 / 110)
               END as calculated_pb1`;
};

const getTscAggJoinSql = (tscAggAlias = 'tsc_agg', scopeWhereSql = '1=1', tAlias = 't') => `
      LEFT JOIN (
        SELECT
          sc_grp.transaction_id,
          MAX(sc_grp.has_exact_pb1) AS has_exact_pb1,
          SUM(sc_grp.ch_exact_pb1) AS tsc_exact_sum,
          SUM(CASE WHEN sc_grp.taxable_gross > 0 THEN ROUND((sc_grp.taxable_gross * 10) / 110) ELSE 0 END) AS tsc_formula_sum,
          SUM(sc_grp.taxable_gross) AS tsc_taxable_gross
        FROM (
          SELECT
            tsc.transaction_id,
            tsc.sales_channel_id,
            MAX(CASE WHEN tsc.pb1_amount IS NOT NULL THEN 1 ELSE 0 END) AS has_exact_pb1,
            ROUND(SUM(
              CASE
                WHEN tsc.pb1_amount IS NOT NULL THEN tsc.pb1_amount
                WHEN COALESCE(pm.is_taxable, 0) = 1 THEN ROUND((tsc.amount * 10) / 110)
                ELSE 0
              END
            )) AS ch_exact_pb1,
            SUM(
              CASE
                WHEN (tsc.pb1_amount IS NOT NULL AND tsc.pb1_amount > 0) OR COALESCE(pm.is_taxable, 0) = 1
                THEN tsc.amount
                ELSE 0
              END
            ) AS taxable_gross
          FROM transaction_sales_channels tsc
          JOIN transactions t_sub ON t_sub.id = tsc.transaction_id
          LEFT JOIN transaction_income_details tid_direct ON tsc.transaction_income_detail_id = tid_direct.id
          LEFT JOIN (
            SELECT tid_s.transaction_id,
                   CASE WHEN COUNT(*) = 1 THEN MAX(tid_s.payment_method_id) ELSE NULL END AS single_pm_id
            FROM transaction_income_details tid_s
            JOIN transactions t_sub ON t_sub.id = tid_s.transaction_id
            WHERE ${scopeWhereSql}
            GROUP BY tid_s.transaction_id
          ) tid_single ON tid_single.transaction_id = tsc.transaction_id
          LEFT JOIN payment_methods pm ON COALESCE(tid_direct.payment_method_id, tsc.payment_method_id, tid_single.single_pm_id) = pm.id
          WHERE ${scopeWhereSql}
          GROUP BY tsc.transaction_id, tsc.sales_channel_id
        ) sc_grp
        GROUP BY sc_grp.transaction_id
      ) ${tscAggAlias} ON ${tAlias}.id = ${tscAggAlias}.transaction_id
`;

const getTscAggParams = (scopeParams = []) => [...scopeParams, ...scopeParams];

const wrapWithTscPriority = (fallbackPb1Sql, tscAggAlias = null) => {
  if (!tscAggAlias) return fallbackPb1Sql;
  return `CASE
    WHEN ${tscAggAlias}.transaction_id IS NOT NULL AND ${tscAggAlias}.has_exact_pb1 = 1 THEN
      ${tscAggAlias}.tsc_exact_sum
    WHEN ${tscAggAlias}.transaction_id IS NOT NULL THEN
      CASE
        WHEN (${fallbackPb1Sql}) > 0
             AND ABS((${fallbackPb1Sql}) - ${tscAggAlias}.tsc_formula_sum) BETWEEN 1 AND 5
             AND ${tscAggAlias}.tsc_taxable_gross > 0
        THEN (${fallbackPb1Sql})
        ELSE ${tscAggAlias}.tsc_formula_sum
      END
    ELSE (${fallbackPb1Sql})
  END`;
};

const getOuterAggPb1SelectSql = (tAlias = 't', tidAggAlias = 'tid_agg', tscAggAlias = null) => {
  const tidOrTxPb1 = `CASE
      WHEN ${tidAggAlias}.has_positive_pb1 = 1 THEN ${tidAggAlias}.calculated_pb1
      WHEN ${tAlias}.pb1 > 0 THEN ${tAlias}.pb1
      ELSE COALESCE(${tidAggAlias}.calculated_pb1, ${tAlias}.pb1, 0)
    END`;
  const resolved = wrapWithTscPriority(tidOrTxPb1, tscAggAlias);
  return `CASE
  WHEN ${tAlias}.type = 'income' THEN
    ${resolved}
  ELSE 0
END as pb1`;
};

const getTransactionPb1SubquerySql = (tAlias = 't', tscAggAlias = null) => {
  const amt = tidEffectiveAmountSql('tid');
  const fallbackPb1 = `CASE
    WHEN EXISTS (
      SELECT 1 FROM transaction_income_details tid_pos
      WHERE tid_pos.transaction_id = ${tAlias}.id AND tid_pos.pb1_amount > 0
    ) THEN COALESCE((
      SELECT ROUND(SUM(
        CASE
          WHEN pm.is_taxable = 1 OR tid.pb1_amount IS NOT NULL THEN
            COALESCE(tid.pb1_amount, CASE WHEN pm.is_taxable = 1 THEN ROUND(${amt} * 10 / 110) ELSE 0 END)
          ELSE 0
        END
      ))
      FROM transaction_income_details tid
      JOIN payment_methods pm ON tid.payment_method_id = pm.id
      WHERE tid.transaction_id = ${tAlias}.id AND (pm.is_taxable = 1 OR tid.pb1_amount IS NOT NULL)
    ), ${tAlias}.pb1, 0)
    WHEN ${tAlias}.pb1 > 0 THEN ${tAlias}.pb1
    ELSE COALESCE((
      SELECT CASE
        WHEN COUNT(CASE WHEN pm.is_taxable = 1 AND tid.pb1_amount IS NULL THEN 1 END) > 0 THEN
          ROUND(SUM(CASE WHEN pm.is_taxable = 1 THEN ${amt} ELSE 0 END) * 10 / 110)
        WHEN COUNT(tid.pb1_amount) > 0 THEN 0
        ELSE ROUND(SUM(CASE WHEN pm.is_taxable = 1 THEN ${amt} ELSE 0 END) * 10 / 110)
      END
      FROM transaction_income_details tid
      JOIN payment_methods pm ON tid.payment_method_id = pm.id
      WHERE tid.transaction_id = ${tAlias}.id AND (pm.is_taxable = 1 OR tid.pb1_amount IS NOT NULL)
    ), ${tAlias}.pb1, 0)
  END`;
  return wrapWithTscPriority(fallbackPb1, tscAggAlias);
};

const getTransactionTaxableAmountSubquerySql = (tAlias = 't') => `(
  SELECT SUM(${tidEffectiveAmountSql('tid')})
  FROM transaction_income_details tid
  JOIN payment_methods pm ON tid.payment_method_id = pm.id
  WHERE tid.transaction_id = ${tAlias}.id AND pm.is_taxable = 1
)`;

module.exports = {
  tidEffectiveAmountSql,
  getTidAggPb1SelectSql,
  getTscAggJoinSql,
  getTscAggParams,
  getOuterAggPb1SelectSql,
  getTransactionPb1SubquerySql,
  getTransactionTaxableAmountSubquerySql
};
