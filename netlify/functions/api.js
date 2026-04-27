const express = require('express');
const serverless = require('serverless-http');
const app = express();

// IMPORTANTE: Aquí importas tus rutas y configs usando rutas relativas
const pool = require('../../src/config/db'); 
// Si tienes tus rutas en src/routes/..., impórtalas así:
// const routes = require('../../src/routes/tusRutas');

// Middleware
app.use(express.json());
// ... tus otros middleware (cors, etc.)

// Tus rutas (puedes importarlas o pegarlas aquí)
app.use('/api', require('../../src/routes/tusRutas')); // O tu lógica directa

module.exports.handler = serverless(app);