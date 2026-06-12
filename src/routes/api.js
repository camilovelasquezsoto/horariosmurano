/**
 * RUTAS DE LA API
 * 
 * Este archivo centraliza todas las rutas de la aplicación, conectando
 * los endpoints HTTP con sus respectivos controladores.
 */

const express = require('express');
const router = express.Router();

// Importación de controladores
const authController = require('../controllers/authController');
const dataController = require('../controllers/dataController');
const trainingController = require('../controllers/trainingController');

/**
 * --- RUTAS DE AUTENTICACIÓN ---
 */
router.post('/register', authController.register);
router.post('/login', authController.login);

/**
 * --- RUTAS DE GIMNASIOS ---
 */
router.get('/gyms', dataController.getAllGyms);
router.post('/gyms', dataController.createGym);
router.put('/gyms/:id', dataController.updateGym);
router.delete('/gyms/:id', dataController.deleteGym);

/**
 * --- RUTAS DE CATEGORÍAS ---
 */
router.get('/categories', dataController.getAllCategories);
router.post('/categories', dataController.createCategory);
router.put('/categories/:id', dataController.updateCategory);
router.delete('/categories/:id', dataController.deleteCategory);

/**
 * --- RUTAS DE ENTRENADORES ---
 */
router.get('/trainers', dataController.getAllTrainers);
router.delete('/trainers/:name', dataController.unlinkTrainer);

/**
 * --- RUTAS DE ENTRENAMIENTOS (HORARIOS) ---
 */
router.post('/trainings', trainingController.createTraining);
router.delete('/trainings/:id', trainingController.deleteTraining);
router.get('/trainings/by-gym/:id', trainingController.getTrainingsByGym);
router.get('/trainings/by-cat/:id', trainingController.getTrainingsByCategory);
router.get('/trainings/by-trainer/:name', trainingController.getTrainingsByTrainer);

/**
 * --- RUTAS DE FAVORITOS ---
 */
router.post('/toggle-favorite', trainingController.toggleFavorite);
router.get('/favorites/:user_id', trainingController.getFavoritesByUser);

module.exports = router;
