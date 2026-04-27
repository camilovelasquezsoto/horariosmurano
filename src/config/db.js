const { Pool } = require('pg');
require('dotenv').config();

console.log("Intentando conectar a la base de datos...");
console.log("DATABASE_URL:", process.env.DATABASE_URL); // 👈 AQUÍ

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

pool.on('error', (err) => {
  console.error('Error inesperado en el pool de Postgres:', err);
});

pool.query('SELECT NOW()', (err, res) => {
  if (err) {
    console.error("¡ERROR FATAL AL CONECTAR CON DB!:", err.message);
  } else {
    console.log("¡Conexión a la base de datos exitosa!");
  }
});

module.exports = pool;