const { Pool } = require('pg');

const pool = new Pool({
  user: 'camilovelasquez', // Tu usuario
  host: 'localhost',
  port: 5432,
  database: 'postgres' // Conectamos a la base de datos por defecto para listar las otras
});

pool.query('SELECT datname FROM pg_database', (err, res) => {
  if (err) {
    console.error('Error al consultar:', err.message);
  } else {
    console.log('Bases de datos que ve Node.js:', res.rows.map(r => r.datname));
  }
  pool.end();
});