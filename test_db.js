/**
 * SUPABASE DIAGNOSTIC TOOL
 * 
 * Este script verifica:
 * 1. Conexión física a la DB.
 * 2. Existencia de tablas.
 * 3. Conteo de registros.
 */

const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function diagnose() {
  console.log("🔍 Iniciando diagnóstico de Supabase...");
  
  try {
    const start = Date.now();
    const res = await pool.query('SELECT NOW()');
    console.log("✅ Conexión exitosa. Latencia:", Date.now() - start, "ms");

    const tables = await pool.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public'
    `);
    
    console.log("📋 Tablas encontradas:", tables.rows.map(r => r.table_name).join(', '));

    const counts = {};
    for (let table of ['gyms', 'categories', 'trainings', 'users']) {
      if (tables.rows.find(r => r.table_name === table)) {
        const countRes = await pool.query(`SELECT COUNT(*) FROM ${table}`);
        counts[table] = countRes.rows[0].count;
      } else {
        counts[table] = "TABLA NO EXISTE";
      }
    }
    console.log("📊 Conteo de registros:", counts);

  } catch (err) {
    console.error("❌ ERROR CRÍTICO:", err.message);
    if (err.message.includes('password authentication failed')) {
      console.log("👉 Tip: Revisa que la contraseña en la URL sea la correcta.");
    }
    if (err.message.includes('ETIMEDOUT')) {
      console.log("👉 Tip: Revisa que Supabase no esté bloqueando la IP o que el proyecto esté activo.");
    }
  } finally {
    await pool.end();
  }
}

diagnose();
