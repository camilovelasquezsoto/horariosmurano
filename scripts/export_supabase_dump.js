const fs = require('fs');
const pool = require('../src/config/db');

function sqlEscape(val) {
    if (val === null || val === undefined) return 'NULL';
    if (typeof val === 'number') return val;
    if (typeof val === 'boolean') return val ? 'TRUE' : 'FALSE';
    if (val instanceof Date) return `'${val.toISOString()}'`;
    if (typeof val === 'object') return `'${JSON.stringify(val).replace(/'/g, "''")}'`;
    const s = val.toString().replace(/'/g, "''");
    return `'${s}'`;
}

async function exportDump() {
    console.log('📦 Generando script de migración para Supabase...');

    let sql = `-- ==========================================================
-- SCRIPT DE MIGRACIÓN COMPLETA PARA SUPABASE
-- CLUB DEPORTIVO MURANO VOLEY PUERTO MONTT
-- Generado automáticamente con estructura y datos
-- ==========================================================

-- 1. TABLAS PRINCIPALES
CREATE TABLE IF NOT EXISTS gyms (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    address VARCHAR(255),
    courts_count INTEGER DEFAULT 1,
    image_url VARCHAR(500),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS categories (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    description TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS trainings (
    id SERIAL PRIMARY KEY,
    gym_id INTEGER REFERENCES gyms(id) ON DELETE CASCADE,
    category_id INTEGER REFERENCES categories(id) ON DELETE CASCADE,
    court_number INTEGER DEFAULT 1,
    day_of_week VARCHAR(50) NOT NULL,
    start_time TIME NOT NULL,
    end_time TIME NOT NULL,
    trainer VARCHAR(255),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    username VARCHAR(100) UNIQUE,
    role VARCHAR(50) DEFAULT 'user',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS favorites (
    id SERIAL PRIMARY KEY,
    user_id VARCHAR(100) NOT NULL,
    training_id INTEGER REFERENCES trainings(id) ON DELETE CASCADE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS athletes (
    id SERIAL PRIMARY KEY,
    first_name VARCHAR(100) NOT NULL,
    last_name VARCHAR(100) NOT NULL,
    category VARCHAR(100) NOT NULL,
    fee_type VARCHAR(50) DEFAULT 'REGULAR',
    monthly_fee NUMERIC(10, 2) DEFAULT 50000,
    status VARCHAR(50) DEFAULT 'ACTIVO',
    notes TEXT,
    phone VARCHAR(50),
    agrupacion VARCHAR(255),
    email VARCHAR(255),
    rut VARCHAR(50),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS athlete_payer_ruts (
    id SERIAL PRIMARY KEY,
    athlete_id INTEGER REFERENCES athletes(id) ON DELETE CASCADE,
    payer_rut VARCHAR(50) NOT NULL,
    payer_name VARCHAR(255),
    relationship VARCHAR(50) DEFAULT 'Apoderado',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS bank_movements (
    id SERIAL PRIMARY KEY,
    date DATE,
    period VARCHAR(50),
    transfer_type VARCHAR(100) DEFAULT 'TRANSFERENCIA',
    account_dest VARCHAR(100),
    payer_rut VARCHAR(50),
    payer_name VARCHAR(255),
    bank_origin VARCHAR(100),
    account_origin VARCHAR(100),
    amount NUMERIC(12, 2) NOT NULL,
    concept TEXT,
    category_concept VARCHAR(100) DEFAULT 'MENSUALIDAD',
    athlete_id INTEGER REFERENCES athletes(id) ON DELETE SET NULL,
    status VARCHAR(50) DEFAULT 'PENDIENTE',
    notes TEXT,
    raw_data JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS club_expenses (
    id SERIAL PRIMARY KEY,
    date DATE NOT NULL,
    period VARCHAR(50) NOT NULL,
    category VARCHAR(100) NOT NULL,
    beneficiary VARCHAR(255) NOT NULL,
    amount NUMERIC(12, 2) NOT NULL,
    payment_method VARCHAR(50) DEFAULT 'TRANSFERENCIA',
    receipt_number VARCHAR(100),
    notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 2. ÍNDICES DE RENDIMIENTO PARA SUPABASE
CREATE INDEX IF NOT EXISTS idx_movements_period ON bank_movements(period);
CREATE INDEX IF NOT EXISTS idx_movements_status ON bank_movements(status);
CREATE INDEX IF NOT EXISTS idx_movements_athlete ON bank_movements(athlete_id);
CREATE INDEX IF NOT EXISTS idx_movements_concept ON bank_movements(category_concept);
CREATE INDEX IF NOT EXISTS idx_movements_rut ON bank_movements(payer_rut);
CREATE INDEX IF NOT EXISTS idx_payer_ruts_rut ON athlete_payer_ruts(payer_rut);
CREATE INDEX IF NOT EXISTS idx_payer_ruts_athlete ON athlete_payer_ruts(athlete_id);
CREATE INDEX IF NOT EXISTS idx_athletes_category ON athletes(category);
CREATE INDEX IF NOT EXISTS idx_athletes_agrupacion ON athletes(agrupacion);
CREATE INDEX IF NOT EXISTS idx_expenses_period ON club_expenses(period);

-- 3. DATOS INICIALES Y REGISTROS
`;

    const tables = [
        'gyms',
        'categories',
        'trainings',
        'users',
        'favorites',
        'athletes',
        'athlete_payer_ruts',
        'bank_movements',
        'club_expenses'
    ];

    for (const table of tables) {
        console.log(`Exportando tabla ${table}...`);
        const rowsRes = await pool.query(`SELECT * FROM ${table} ORDER BY id ASC`);
        const rows = rowsRes.rows;

        if (rows.length === 0) continue;

        sql += `\n-- Datos de ${table} (${rows.length} registros)\n`;
        const cols = Object.keys(rows[0]);
        const colList = cols.map(c => `"${c}"`).join(', ');

        for (const row of rows) {
            const vals = cols.map(c => sqlEscape(row[c])).join(', ');
            sql += `INSERT INTO ${table} (${colList}) VALUES (${vals}) ON CONFLICT (id) DO NOTHING;\n`;
        }

        // Reset sequence
        sql += `SELECT setval(pg_get_serial_sequence('${table}', 'id'), COALESCE((SELECT MAX(id) FROM ${table}), 1));\n`;
    }

    const outputPath = './supabase_schema_and_data.sql';
    fs.writeFileSync(outputPath, sql, 'utf8');
    const stats = fs.statSync(outputPath);
    console.log(`\n🎉 Archivo de migración generado exitosamente en: ${outputPath} (${(stats.size / 1024).toFixed(2)} KB)`);
    process.exit(0);
}

exportDump().catch(err => {
    console.error('Error generando dump:', err);
    process.exit(1);
});
