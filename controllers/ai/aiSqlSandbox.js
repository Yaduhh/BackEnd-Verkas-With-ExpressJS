// SQL Sandboxing and Sanitization logic to ensure secure, read-only, branch-isolated queries

// Helper to replace a table name in SQL with a sandboxed subquery
function replaceTableWithSandbox(sql, tableName, subquery) {
  const regex = new RegExp(`\\b${tableName}\\b(?!\\s*\\.)(?:\\s+(?:AS\\s+)?([a-z0-9_]+))?`, 'gi');

  return sql.replace(regex, (match, alias) => {
    const keywords = ['JOIN', 'LEFT', 'RIGHT', 'INNER', 'OUTER', 'CROSS', 'WHERE', 'ON', 'GROUP', 'ORDER', 'LIMIT', 'UNION', 'AND', 'OR', 'USING', 'SET', 'VALUES', 'AS', 'FROM'];
    if (alias && !keywords.includes(alias.toUpperCase())) {
      return `${subquery} AS ${alias}`;
    }

    const suffix = alias ? match.slice(match.toLowerCase().lastIndexOf(alias.toLowerCase())) : '';
    return `${subquery} AS ${tableName} ${suffix}`;
  });
}

// Sanitize and sandbox query
function sanitizeAndSandboxSQL(sql, branchId) {
  let cleanSql = sql.replace(/`/g, '').trim();
  cleanSql = cleanSql.replace(/^SELECTDISTINCT\b/i, 'SELECT DISTINCT');
  cleanSql = cleanSql.replace(/^SELECT\s*DISTINCT/i, 'SELECT DISTINCT');
  const upper = cleanSql.toUpperCase();

  if (!upper.startsWith('SELECT')) {
    throw new Error('Kueri tidak diizinkan: Hanya SELECT kueri yang diperbolehkan.');
  }

  const forbiddenKeywords = ['INSERT', 'UPDATE', 'DELETE', 'DROP', 'ALTER', 'CREATE', 'RENAME', 'REPLACE', 'TRUNCATE', 'GRANT', 'REVOKE', 'LOAD_FILE', 'OUTFILE'];
  for (const keyword of forbiddenKeywords) {
    const regex = new RegExp(`\\b${keyword}\\b`, 'i');
    if (regex.test(cleanSql)) {
      throw new Error(`Kueri tidak diizinkan: Mengandung keyword terlarang ${keyword}.`);
    }
  }

  // Securing branch data isolation
  cleanSql = replaceTableWithSandbox(cleanSql, 'transactions',
    `(SELECT * FROM transactions WHERE branch_id = ${branchId} AND status_deleted = 0)`
  );

  cleanSql = replaceTableWithSandbox(cleanSql, 'categories',
    `(SELECT * FROM categories WHERE (branch_id = ${branchId} OR branch_id IS NULL) AND status_deleted = 0)`
  );

  cleanSql = replaceTableWithSandbox(cleanSql, 'mitra_piutang',
    `(SELECT * FROM mitra_piutang WHERE branch_id = ${branchId} AND deleted_at IS NULL)`
  );

  cleanSql = replaceTableWithSandbox(cleanSql, 'transaction_mitra_details',
    `(SELECT tmd.* FROM transaction_mitra_details tmd JOIN transactions t ON tmd.transaction_id = t.id WHERE t.branch_id = ${branchId} AND t.status_deleted = 0)`
  );

  cleanSql = replaceTableWithSandbox(cleanSql, 'transaction_income_details',
    `(SELECT tid.* FROM transaction_income_details tid JOIN transactions t ON tid.transaction_id = t.id WHERE t.branch_id = ${branchId} AND t.status_deleted = 0)`
  );

  cleanSql = replaceTableWithSandbox(cleanSql, 'payment_methods',
    `(SELECT * FROM payment_methods WHERE (branch_id = ${branchId} OR branch_id IS NULL))`
  );

  cleanSql = replaceTableWithSandbox(cleanSql, 'bank_accounts',
    `(SELECT * FROM bank_accounts WHERE branch_id = ${branchId} AND is_active = 1)`
  );

  cleanSql = replaceTableWithSandbox(cleanSql, 'savings_account_allocations',
    `(SELECT saa.* FROM savings_account_allocations saa JOIN bank_accounts ba ON saa.bank_account_id = ba.id WHERE ba.branch_id = ${branchId})`
  );

  cleanSql = replaceTableWithSandbox(cleanSql, 'branch_reports',
    `(SELECT * FROM branch_reports WHERE branch_id = ${branchId})`
  );

  cleanSql = replaceTableWithSandbox(cleanSql, 'subscriptions',
    `(SELECT * FROM subscriptions WHERE user_id = (SELECT owner_id FROM branches WHERE id = ${branchId} LIMIT 1))`
  );

  return cleanSql;
}

module.exports = {
  replaceTableWithSandbox,
  sanitizeAndSandboxSQL
};
