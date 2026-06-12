/**
 * SERVIDOR PRINCIPAL - MURANO VOLEY
 * 
 * Este archivo inicializa el servidor Express, configura los middlewares
 * globales y conecta las rutas de la API. También permite la exportación
 * como una función serverless para despliegues en Netlify o Vercel.
 */

const express = require('express');
const serverless = require('serverless-http');
const cors = require('cors');
require('dotenv').config();

// Inicialización de la App
const app = express();

/**
 * MIDDLEWARES
 * - CORS: Permite peticiones desde el frontend.
 * - JSON: Permite leer cuerpos de peticiones en formato JSON.
 */
app.use(cors());
app.use(express.json());

/**
 * RUTAS
 * Usamos una configuración flexible para que funcione tanto localmente (/api)
 * como en Netlify Functions (donde el prefijo puede variar).
 */
const pool = require('./src/config/db');
const apiRoutes = require('./src/routes/api');

// Endpoint de salud con diagnóstico de Base de Datos
const healthCheck = async (req, res) => {
    try {
        const dbRes = await pool.query('SELECT NOW()');
        res.json({ 
            status: 'OK', 
            message: 'Servidor y Base de Datos funcionando correctamente',
            db_time: dbRes.rows[0].now,
            timestamp: new Date().toISOString()
        });
    } catch (err) {
        res.status(500).json({
            status: 'ERROR',
            message: 'Servidor OK, pero falló la conexión a Supabase',
            error: err.message
        });
    }
};

app.get('/api/health', healthCheck);
app.get('/health', healthCheck);

// Montamos las rutas. El comodín en serverless puede variar, así que cubrimos ambos.
// Algunos entornos quitan el /api, otros lo mantienen.
app.use('/api', apiRoutes);
app.use('/', apiRoutes);
app.use('/.netlify/functions/api', apiRoutes);

/**
 * MIDDLEWARE DE MANEJO DE ERRORES GLOBAL
 * Captura cualquier error no manejado en las rutas y evita que el servidor se caiga.
 */
app.use((err, req, res, next) => {
    console.error('❌ Error detectado:', err.stack);
    res.status(err.status || 500).json({
        error: 'Algo salió mal en el servidor',
        message: process.env.NODE_ENV === 'development' ? err.message : 'Error interno'
    });
});

/**
 * EXPORTACIÓN
 * - Para desarrollo local: app.listen
 * - Para producción (Serverless): module.exports.handler
 */
if (process.env.NODE_ENV !== 'production') {
    const PORT = process.env.PORT || 3000;
    app.listen(PORT, () => {
        console.log(`🚀 Servidor corriendo localmente en http://localhost:${PORT}`);
    });
}

module.exports = app;
module.exports.handler = serverless(app);
