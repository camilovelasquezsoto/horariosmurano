const { Pool } = require('pg');
require('dotenv').config();
const dns = require('dns');

// Esto fuerza la conexión por IPv4 y soluciona el error ENETUNREACH
dns.setDefaultResultOrder('ipv4first');

console.log("Intentando conectar a la base de datos...");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

pool.on('error', (err) => {
  console.error('Error inesperado en el pool de Postgres:', err);
});

// Prueba de conexión
pool.query('SELECT NOW()', (err, res) => {
  if (err) {
    console.error("¡ERROR FATAL AL CONECTAR CON DB!:", err.message);
  } else {
    console.log("¡Conexión a la base de datos exitosa!");
  }
});

module.exports = pool;