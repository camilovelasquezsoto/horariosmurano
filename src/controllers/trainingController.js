/**
 * CONTROLADOR DE ENTRENAMIENTOS Y FAVORITOS
 * 
 * Gestiona la programación de clases (horarios) y la funcionalidad de 
 * marcar entrenamientos como favoritos para los usuarios.
 */

const pool = require('../config/db');

// --- ENTRENAMIENTOS ---

exports.createTraining = async (req, res) => {
    try {
        const { gym_id, category_id, day_of_week, start_time } = req.body;
        await pool.query(
            'INSERT INTO trainings (gym_id, category_id, day_of_week, start_time) VALUES ($1, $2, $3, $4)', 
            [gym_id, category_id, day_of_week, start_time]
        );
        res.status(201).send('Entrenamiento creado');
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

exports.deleteTraining = async (req, res) => {
    try {
        await pool.query('DELETE FROM trainings WHERE id = $1', [req.params.id]);
        res.status(200).send('Eliminado');
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

exports.getTrainingsByGym = async (req, res) => {
    try {
        const q = `
            SELECT t.id, t.gym_id, t.category_id, t.day_of_week, 
                   TO_CHAR(t.start_time, 'HH24:MI') as start_time, 
                   c.name as category_name, c.trainer_name,
                   g.name as gym_name
            FROM trainings t 
            JOIN categories c ON t.category_id = c.id
            JOIN gyms g ON t.gym_id = g.id
            WHERE t.gym_id = $1`;
        const result = await pool.query(q, [req.params.id]);
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

exports.getTrainingsByCategory = async (req, res) => {
    try {
        const q = `
            SELECT t.id, t.gym_id, t.category_id, t.day_of_week, 
                   TO_CHAR(t.start_time, 'HH24:MI') as start_time, 
                   g.name as gym_name, c.trainer_name 
            FROM trainings t 
            JOIN gyms g ON t.gym_id = g.id 
            JOIN categories c ON t.category_id = c.id 
            WHERE t.category_id = $1`;
        const result = await pool.query(q, [req.params.id]);
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

exports.getTrainingsByTrainer = async (req, res) => {
    try {
        const q = `
            SELECT t.id, t.gym_id, t.category_id, t.day_of_week, 
                   TO_CHAR(t.start_time, 'HH24:MI') as start_time, 
                   c.name as category_name, c.trainer_name, g.name as gym_name 
            FROM trainings t 
            JOIN categories c ON t.category_id = c.id 
            JOIN gyms g ON t.gym_id = g.id 
            WHERE c.trainer_name = $1`;
        const result = await pool.query(q, [decodeURIComponent(req.params.name)]);
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

// --- FAVORITOS ---

exports.toggleFavorite = async (req, res) => {
    const { user_id, training_id } = req.body;
    try {
        const check = await pool.query('SELECT id FROM favorites WHERE user_id = $1 AND training_id = $2', [user_id, training_id]);
        if (check.rows.length > 0) {
            await pool.query('DELETE FROM favorites WHERE id = $1', [check.rows[0].id]);
            res.json({ action: 'removed' });
        } else {
            await pool.query('INSERT INTO favorites (user_id, training_id) VALUES ($1, $2)', [user_id, training_id]);
            res.json({ action: 'added' });
        }
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

exports.getFavoritesByUser = async (req, res) => {
    try {
        const q = `
            SELECT t.id, t.gym_id, t.category_id, t.day_of_week, 
                   TO_CHAR(t.start_time, 'HH24:MI') as start_time, 
                   g.name as gym_name, c.name as category_name, c.trainer_name 
            FROM favorites f 
            JOIN trainings t ON f.training_id = t.id 
            JOIN gyms g ON t.gym_id = g.id 
            JOIN categories c ON t.category_id = c.id 
            WHERE f.user_id = $1`;
        const result = await pool.query(q, [req.params.user_id]);
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};
