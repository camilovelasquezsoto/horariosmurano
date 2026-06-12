const { Pool } = require('pg');
require('dotenv').config();

// 1. Validación preventiva (No bloqueante en serverless para evitar crashes durante el build)
if (!process.env.DATABASE_URL) {
  console.warn("ADVERTENCIA: La variable DATABASE_URL no está configurada aún.");
}

console.log("Iniciando pool de conexión...");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || "",
  ssl: {
    rejectUnauthorized: false // Indispensable para Supabase
  },
  connectionTimeoutMillis: 10000, 
});

// 2. Manejo de errores en el pool global
pool.on('error', (err) => {
  console.error('Error inesperado en el pool de Postgres:', err.message);
});

// 3. Función async para probar la conexión de forma clara
const testConnection = async () => {
  try {
    const res = await pool.query('SELECT NOW()');
    console.log("¡Conexión a la base de datos exitosa!");
  } catch (err) {
    console.error("¡ERROR FATAL AL CONECTAR CON DB!:", err.message);
    // No usamos process.exit aquí para permitir que la app intente reconectar luego
  }
};

testConnection();

module.exports = pool;