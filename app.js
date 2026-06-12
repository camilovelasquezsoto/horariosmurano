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
 * Todas las rutas de la API estarán bajo el prefijo '/api'
 */
const apiRoutes = require('./src/routes/api');

// Ruta de prueba para verificar que el servidor está vivo
app.get('/api/health', (req, res) => {
    res.json({ status: 'OK', message: 'Servidor de Murano Voley funcionando correctamente' });
});

app.use('/api', apiRoutes);

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
