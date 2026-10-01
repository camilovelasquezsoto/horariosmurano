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
const financeController = require('../controllers/financeController');
const multer = require('multer');
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

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

/**
 * --- RUTAS DE FINANZAS Y PAGOS ---
 */
router.get('/finance/athletes', financeController.getAthletes);
router.post('/finance/athletes', financeController.createAthlete);
router.post('/finance/athletes/adjust-categories', financeController.adjustU11AndMiniCategories);
router.post('/finance/migrate-audit', financeController.migrateMovementsAndJoinDates);
router.put('/finance/athletes/:id', financeController.updateAthlete);
router.delete('/finance/athletes/:id', financeController.deleteAthlete);

router.post('/finance/athletes/ruts', financeController.addPayerRut);
router.delete('/finance/athletes/ruts/:id', financeController.removePayerRut);
router.get('/finance/payer-ruts/lookup', financeController.lookupPayerRut);

router.post('/finance/cartola/upload', upload.single('cartola'), financeController.processCartola);
router.post('/finance/cartola/process', financeController.processCartola);

router.get('/finance/movements', financeController.getMovements);
router.get('/finance/movements/recent-modifications', financeController.getRecentModifications);
router.post('/finance/movements/assign', financeController.assignMovement);
router.put('/finance/movements/:id', financeController.updateMovement);
router.post('/finance/movements/split', financeController.splitMovement);

router.get('/finance/summary', financeController.getSummary);
router.post('/finance/payments/manual', financeController.registerManualPayment);

// Rutas de Auditoría Integral y Diagnóstico de Datos
router.get('/finance/audit', financeController.getAuditReport);
router.post('/finance/audit/quick-fix', financeController.quickFixAuditItem);

// Rutas de gestión histórica, respaldo y optimización de base de datos
router.get('/finance/archive/export', financeController.exportMonthlyArchive);
router.post('/finance/archive/purge', financeController.purgeMonthlyMovements);
router.post('/finance/archive/restore', financeController.restoreMonthlyArchive);
router.get('/finance/archive/stats', financeController.getArchiveStats);

// Rutas de Egresos y Gastos
router.get('/finance/expenses', financeController.getExpenses);
router.post('/finance/expenses', financeController.createExpense);
router.put('/finance/expenses/:id', financeController.updateExpense);
router.delete('/finance/expenses/:id', financeController.deleteExpense);

// Sincronización e Importación de datos desde Bayes y Excel
router.post('/finance/athletes/import-bayes', financeController.importBayesData);
router.post('/finance/bayes/import', financeController.importBayesData);
router.post('/finance/athletes/sync-excel', financeController.syncAthletesExcel);

module.exports = router;
