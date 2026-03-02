const { query } = require('./config/database');

async function checkSchema() {
    try {
        const results = await query('DESCRIBE transactions');
        console.log('Columns in transactions table:');
        results.forEach(row => {
            console.log(`- ${row.Field} (${row.Type})`);
        });
        process.exit(0);
    } catch (error) {
        console.error('Error:', error);
        process.exit(1);
    }
}

checkSchema();
