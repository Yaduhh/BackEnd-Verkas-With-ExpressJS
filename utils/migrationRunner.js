const fs = require('fs');
const path = require('path');
const { query, transaction } = require('../config/database');

const MIGRATIONS_DIR = path.join(__dirname, '../migrations');

// Ensure migrations table exists
async function ensureMigrationsTable() {
  await query(`
    CREATE TABLE IF NOT EXISTS migrations (
      id INT AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(255) NOT NULL UNIQUE,
      executed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      batch INT NOT NULL
    )
  `);
}

// Get executed migrations
async function getExecutedMigrations() {
  await ensureMigrationsTable();
  const results = await query('SELECT name, batch FROM migrations ORDER BY batch ASC, id ASC');
  return results;
}

// Get all migration files
function getMigrationFiles() {
  if (!fs.existsSync(MIGRATIONS_DIR)) {
    return [];
  }
  return fs.readdirSync(MIGRATIONS_DIR)
    .filter(file => file.endsWith('.js'))
    .sort();
}

// Get next batch number
async function getNextBatch() {
  const results = await query('SELECT MAX(batch) as maxBatch FROM migrations');
  return (results[0]?.maxBatch || 0) + 1;
}

// Run migration
async function runMigration(fileName) {
  const migrationPath = path.join(MIGRATIONS_DIR, fileName);
  const migration = require(migrationPath);
  
  if (!migration.up || typeof migration.up !== 'function') {
    throw new Error(`Migration ${fileName} must export an 'up' function`);
  }
  
  console.log(`  Running: ${fileName}`);
  await migration.up({ query, transaction });
  
  const batch = await getNextBatch();
  await query('INSERT INTO migrations (name, batch) VALUES (?, ?)', [fileName, batch]);
  console.log(`  ✅ Completed: ${fileName}`);
}

// Rollback migration
async function rollbackMigration(fileName) {
  const migrationPath = path.join(MIGRATIONS_DIR, fileName);
  const migration = require(migrationPath);
  
  if (!migration.down || typeof migration.down !== 'function') {
    throw new Error(`Migration ${fileName} must export a 'down' function`);
  }
  
  console.log(`  Rolling back: ${fileName}`);
  await migration.down({ query, transaction });
  
  await query('DELETE FROM migrations WHERE name = ?', [fileName]);
  console.log(`  ✅ Rolled back: ${fileName}`);
}

// Main functions
async function migrate() {
  console.log('🔄 Running migrations...\n');
  
  await ensureMigrationsTable();
  const executed = await getExecutedMigrations();
  const executedNames = new Set(executed.map(m => m.name));
  
  const files = getMigrationFiles();
  const pending = files.filter(file => !executedNames.has(file));
  
  if (pending.length === 0) {
    console.log('✅ No pending migrations\n');
    return;
  }
  
  for (const file of pending) {
    try {
      await runMigration(file);
    } catch (error) {
      console.error(`❌ Error running ${file}:`, error.message);
      throw error;
    }
  }
  
  console.log(`\n✅ Migrated ${pending.length} file(s)\n`);
}

async function rollback() {
  console.log('🔄 Rolling back last batch...\n');
  
  await ensureMigrationsTable();
  const executed = await getExecutedMigrations();
  
  if (executed.length === 0) {
    console.log('✅ No migrations to rollback\n');
    return;
  }
  
  // Get last batch
  const lastBatch = executed[executed.length - 1].batch;
  const lastBatchMigrations = executed.filter(m => m.batch === lastBatch).reverse();
  
  for (const migration of lastBatchMigrations) {
    try {
      await rollbackMigration(migration.name);
    } catch (error) {
      console.error(`❌ Error rolling back ${migration.name}:`, error.message);
      throw error;
    }
  }
  
  console.log(`\n✅ Rolled back ${lastBatchMigrations.length} migration(s)\n`);
}

async function status() {
  console.log('📊 Migration Status\n');
  
  await ensureMigrationsTable();
  const executed = await getExecutedMigrations();
  const executedNames = new Set(executed.map(m => m.name));
  
  const files = getMigrationFiles();
  
  console.log('Executed migrations:');
  if (executed.length === 0) {
    console.log('  (none)');
  } else {
    executed.forEach(m => {
      console.log(`  ✅ ${m.name} (batch ${m.batch})`);
    });
  }
  
  console.log('\nPending migrations:');
  const pending = files.filter(file => !executedNames.has(file));
  if (pending.length === 0) {
    console.log('  (none)');
  } else {
    pending.forEach(file => {
      console.log(`  ⏳ ${file}`);
    });
  }
  
  console.log('');
}

// CLI
const command = process.argv[2];

(async () => {
  try {
    switch (command) {
      case 'migrate':
        await migrate();
        break;
      case 'rollback':
        await rollback();
        break;
      case 'status':
        await status();
        break;
      default:
        console.log('Usage: node migrationRunner.js [migrate|rollback|status]');
        process.exit(1);
    }
    process.exit(0);
  } catch (error) {
    console.error('❌ Migration error:', error);
    process.exit(1);
  }
})();

