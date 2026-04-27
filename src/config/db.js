const { Pool } = require('pg');
require('dotenv').config();
const dns = require('dns');

// Forzamos IPv4 para evitar el error ENETUNREACH
dns.setDefaultResultOrder('ipv4first');

const pool = new Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  password: process.env.DB_PASSWORD,
  port: process.env.DB_PORT,
  ssl: {
    rejectUnauthorized: false
  }
});

// Prueba de conexión inmediata
pool.connect((err, client, release) => {
  if (err) {
    return console.error('Error FATAL al conectar con la DB:', err.stack);
  }
  console.log('¡Conexión a la base de datos exitosa!');
  release();
});

module.exports = pool;