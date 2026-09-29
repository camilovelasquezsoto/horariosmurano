require('dotenv').config();
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
async function run() {
    const client = await pool.connect();
    const r = await client.query(
        `UPDATE categories 
         SET trainer_name = 'Yeison Guenchur',
             trainer_image_url = '/profesores/fotopredeterminadaprofe.png'
         WHERE name = 'U14 VARONES'`
    );
    console.log('✅ Filas actualizadas:', r.rowCount);
    const check = await client.query("SELECT name, trainer_name FROM categories WHERE name = 'U14 VARONES'");
    console.log('Resultado:', check.rows[0]);
    client.release();
    pool.end();
}
run().catch(e => { console.error('❌', e.message); pool.end(); });
