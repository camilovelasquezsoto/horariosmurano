const { Pool } = require('pg');
require('dotenv').config();

console.log("Intentando conectar a: postgres con usuario:", process.env.DB_USER);

const pool = new Pool({
    user: process.env.DB_USER,
    host: process.env.DB_HOST,
    database: process.env.DB_NAME,
    password: process.env.DB_PASSWORD,
    port: process.env.DB_PORT,
});

// ESTO ES LO QUE FALTA PROBABLEMENTE
pool.on('error', (err) => {
    console.error('Error inesperado en el pool de Postgres:', err);
});

// Prueba la conexión apenas inicia
pool.query('SELECT NOW()', (err, res) => {
    if (err) {
        console.error("¡ERROR FATAL AL CONECTAR CON DB!:", err.message);
    } else {
        console.log("¡Conexión a la base de datos exitosa!");
    }
});

module.exports = pool;