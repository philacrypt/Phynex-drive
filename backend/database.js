const fs = require('node:fs');
const path = require('node:path');
const { Pool } = require('pg');

const pool = new Pool({
    ...(process.env.DATABASE_URL ? { connectionString: process.env.DATABASE_URL } : {}),
    ssl: process.env.PGSSL === 'true' ? { rejectUnauthorized: true } : undefined,
    max: Number(process.env.PG_POOL_SIZE) || 20,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000
});

pool.on('error', (error) => {
    console.error('Unexpected PostgreSQL pool error:', error);
});

async function initializeDatabase() {
    if (!process.env.DATABASE_URL) {
        throw new Error('DATABASE_URL is not set. Add your PostgreSQL connection string to .env.');
    }
    const schema = fs.readFileSync(path.join(__dirname, '..', 'database', 'schema.sql'), 'utf8');
    await pool.query(schema);
}

module.exports = { initializeDatabase, pool };
