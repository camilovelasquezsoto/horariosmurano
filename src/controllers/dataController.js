/**
 * CONTROLADOR DE DATOS (Gimnasios, Categorías, Profesores)
 * 
 * Gestiona la lógica de negocio para las entidades principales del club.
 * Incluye operaciones CRUD y consultas filtradas por relaciones.
 */

const pool = require('../config/db');

// --- GIMNASIOS ---

exports.getAllGyms = async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM gyms ORDER BY name ASC');
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

exports.createGym = async (req, res) => {
    try {
        const { name, address, image_url } = req.body;
        await pool.query('INSERT INTO gyms (name, address, image_url) VALUES ($1, $2, $3)', [name, address, image_url]);
        res.status(201).send('Gimnasio guardado');
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

exports.updateGym = async (req, res) => {
    try {
        const { name, address, image_url } = req.body;
        await pool.query('UPDATE gyms SET name = $1, address = $2, image_url = $3 WHERE id = $4', [name, address, image_url, req.params.id]);
        res.status(200).send('Gimnasio actualizado');
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

exports.deleteGym = async (req, res) => {
    try {
        await pool.query('DELETE FROM gyms WHERE id = $1', [req.params.id]);
        res.status(200).send('Eliminado');
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

// --- CATEGORÍAS ---

exports.getAllCategories = async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM categories ORDER BY name ASC');
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

exports.createCategory = async (req, res) => {
    try {
        const { name, trainer_name, image_url, trainer_image_url } = req.body;
        await pool.query('INSERT INTO categories (name, trainer_name, image_url, trainer_image_url) VALUES ($1, $2, $3, $4)',
            [name, trainer_name, image_url, trainer_image_url]);
        res.status(201).send('Categoría guardada');
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

exports.updateCategory = async (req, res) => {
    try {
        const { name, trainer_name, image_url, trainer_image_url } = req.body;
        await pool.query('UPDATE categories SET name = $1, trainer_name = $2, image_url = $3, trainer_image_url = $4 WHERE id = $5',
            [name, trainer_name, image_url, trainer_image_url, req.params.id]);
        res.status(200).send('Categoría actualizada');
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

exports.deleteCategory = async (req, res) => {
    try {
        await pool.query('DELETE FROM categories WHERE id = $1', [req.params.id]);
        res.status(200).send('Eliminado');
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

// --- ENTRENADORES ---

exports.getAllTrainers = async (req, res) => {
    try {
        const query = `
            SELECT DISTINCT ON (trainer_name)
                trainer_name as name,
                trainer_image_url as image_url
            FROM categories
            WHERE trainer_name IS NOT NULL
            ORDER BY trainer_name, trainer_image_url DESC NULLS LAST
        `;
        const result = await pool.query(query);
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

exports.unlinkTrainer = async (req, res) => {
    try {
        await pool.query('UPDATE categories SET trainer_name = NULL, trainer_image_url = NULL WHERE trainer_name = $1', [decodeURIComponent(req.params.name)]);
        res.status(200).send('Entrenador desvinculado');
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};
