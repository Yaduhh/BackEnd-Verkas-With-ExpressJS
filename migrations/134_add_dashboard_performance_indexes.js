const { PERFORMANCE_INDEXES, ensurePerformanceIndexes } = require('../utils/performanceIndexes');

module.exports = {
  up: async ({ query }) => {
    await ensurePerformanceIndexes(query);
    console.log('  Ensured dashboard performance composite indexes');
  },

  down: async ({ query }) => {
    const indexNames = PERFORMANCE_INDEXES.map((i) => i.name);
    const placeholders = indexNames.map(() => '?').join(',');
    const existingIdxRows = await query(
      `SELECT DISTINCT TABLE_NAME, INDEX_NAME
       FROM INFORMATION_SCHEMA.STATISTICS
       WHERE TABLE_SCHEMA = DATABASE()
         AND INDEX_NAME IN (${placeholders})`,
      indexNames
    );
    const existingSet = new Set(existingIdxRows.map((r) => `${r.TABLE_NAME}.${r.INDEX_NAME}`));

    for (const idx of PERFORMANCE_INDEXES) {
      if (existingSet.has(`${idx.table}.${idx.name}`)) {
        await query(`ALTER TABLE ${idx.table} DROP INDEX ${idx.name}`);
      }
    }
    console.log('  Dropped dashboard performance composite indexes');
  }
};
