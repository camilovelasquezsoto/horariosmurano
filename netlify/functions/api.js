/**
 * NETLIFY FUNCTION ENTRY POINT
 * 
 * Este archivo sirve como el puente entre Netlify Functions y nuestra
 * aplicación modular de Express. Importa la App configurada en la raíz
 * y la exporta como un handler compatible con Netlify.
 */

const serverless = require('serverless-http');
const app = require('../../app');

// Exportamos el handler serverless
module.exports.handler = serverless(app);
