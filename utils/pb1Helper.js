/**
 * Shared SQL fragments for standardized PB1 calculation across transaction queries
 * and branch reports.
 *
 * Priority per income transaction:
 * 1. Explicit positive per-row `tid.pb1_amount > 0` (plus 10/110 on taxable NULL rows)
 * 2. Authoritative transaction-level `t.pb1 > 0` (e.g. Cashier Report summary PB1 when tid.pb1_amount are 0/NULL)
 * 3. Fallback 10/110 on taxable NULL `tid` rows (or `0` when all `tid.pb1_amount` are explicitly 0 and `t.pb1` is 0/NULL)
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

const getOuterAggPb1SelectSql = (tAlias = 't', tidAggAlias = 'tid_agg') => `CASE
  WHEN ${tAlias}.type = 'income' THEN
    CASE
      WHEN ${tidAggAlias}.has_positive_pb1 = 1 THEN ${tidAggAlias}.calculated_pb1
      WHEN ${tAlias}.pb1 > 0 THEN ${tAlias}.pb1
      ELSE COALESCE(${tidAggAlias}.calculated_pb1, ${tAlias}.pb1, 0)
    END
  ELSE 0
END as pb1`;

const getTransactionPb1SubquerySql = (tAlias = 't') => {
  const amt = tidEffectiveAmountSql('tid');
  return `CASE
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
  getOuterAggPb1SelectSql,
  getTransactionPb1SubquerySql,
  getTransactionTaxableAmountSubquerySql
};
