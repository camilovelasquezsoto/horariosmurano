const express = require('express');
const serverless = require('serverless-http');
const cors = require('cors');
const pool = require('../../src/config/db');
const bcrypt = require('bcrypt');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json());

// --- AUTH ---
app.post('/register', async (req, res) => {
    const { email, password, adminKey } = req.body;
    let role = (adminKey === '1234') ? 'admin' : 'user';
    try {
        const hash = await bcrypt.hash(password, 10);
        const result = await pool.query('INSERT INTO users (email, password_hash, role) VALUES ($1, $2, $3) RETURNING id', [email, hash, role]);
        res.status(201).json({ id: result.rows[0].id, role, email });
    } catch (err) { res.status(400).send(err.message); }
});

app.post('/login', async (req, res) => {
    const { email, password } = req.body;
    try {
        const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
        if (result.rows.length === 0) return res.status(401).send('Usuario no encontrado');
        const valid = await bcrypt.compare(password, result.rows[0].password_hash);
        if (!valid) return res.status(401).send('Contraseña incorrecta');
        res.json({ user_id: result.rows[0].id, role: result.rows[0].role, email: result.rows[0].email });
    } catch (err) { res.status(500).send(err.message); }
});

// --- ADMIN: ACCIONES DE GUARDADO ---
app.post('/trainings', async (req, res) => {
    try {
        const { gym_id, category_id, day_of_week, start_time } = req.body;
        await pool.query('INSERT INTO trainings (gym_id, category_id, day_of_week, start_time) VALUES ($1, $2, $3, $4)', [gym_id, category_id, day_of_week, start_time]);
        res.status(201).send('Entrenamiento creado');
    } catch (err) { res.status(500).send(err.message); }
});

app.post('/gyms', async (req, res) => {
    try {
        await pool.query('INSERT INTO gyms (name, address, image_url) VALUES ($1, $2, $3)', [req.body.name, req.body.address, req.body.image_url]);
        res.status(201).send('Gimnasio guardado');
    } catch (err) { res.status(500).send(err.message); }
});

app.post('/categories', async (req, res) => {
    try {
        await pool.query('INSERT INTO categories (name, trainer_name, image_url, trainer_image_url) VALUES ($1, $2, $3, $4)',
        [req.body.name, req.body.trainer_name, req.body.image_url, req.body.trainer_image_url]);
        res.status(201).send('Categoría guardada');
    } catch (err) { res.status(500).send(err.message); }
});

// --- ADMIN: EDITAR Y ELIMINAR ---
app.put('/gyms/:id', async (req, res) => {
    try {
        await pool.query('UPDATE gyms SET name = $1, address = $2, image_url = $3 WHERE id = $4',
        [req.body.name, req.body.address, req.body.image_url, req.params.id]);
        res.status(200).send('Gimnasio actualizado');
    } catch (err) { res.status(500).send(err.message); }
});

app.put('/categories/:id', async (req, res) => {
    try {
        await pool.query('UPDATE categories SET name = $1, trainer_name = $2, image_url = $3, trainer_image_url = $4 WHERE id = $5',
        [req.body.name, req.body.trainer_name, req.body.image_url, req.body.trainer_image_url, req.params.id]);
        res.status(200).send('Categoría actualizada');
    } catch (err) { res.status(500).send(err.message); }
});

app.delete('/trainings/:id', async (req, res) => {
    try {
        await pool.query('DELETE FROM trainings WHERE id = $1', [req.params.id]);
        res.status(200).send('Eliminado');
    } catch (err) { res.status(500).send(err.message); }
});

app.delete('/gyms/:id', async (req, res) => {
    try {
        await pool.query('DELETE FROM gyms WHERE id = $1', [req.params.id]);
        res.status(200).send('Eliminado');
    } catch (err) { res.status(500).send(err.message); }
});

app.delete('/categories/:id', async (req, res) => {
    try {
        await pool.query('DELETE FROM categories WHERE id = $1', [req.params.id]);
        res.status(200).send('Eliminado');
    } catch (err) { res.status(500).send(err.message); }
});

app.delete('/trainers/:name', async (req, res) => {
    try {
        await pool.query('UPDATE categories SET trainer_name = NULL, trainer_image_url = NULL WHERE trainer_name = $1', [decodeURIComponent(req.params.name)]);
        res.status(200).send('Entrenador desvinculado');
    } catch (err) { res.status(500).send(err.message); }
});

// --- GETS ---
app.get('/gyms', async (req, res) => { try { res.json((await pool.query('SELECT * FROM gyms ORDER BY name ASC')).rows); } catch (err) { res.status(500).send(err.message); } });
app.get('/categories', async (req, res) => { try { res.json((await pool.query('SELECT * FROM categories ORDER BY name ASC')).rows); } catch (err) { res.status(500).send(err.message); } });

app.get('/trainers', async (req, res) => {
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
    } catch (err) { res.status(500).send(err.message); }
});

// --- QUERIES ---
app.get('/trainings/by-gym/:id', async (req, res) => {
    const q = 'SELECT t.id, t.gym_id, t.category_id, t.day_of_week, TO_CHAR(t.start_time, \'HH24:MI\') as start_time, c.name as category_name, c.trainer_name FROM trainings t JOIN categories c ON t.category_id = c.id WHERE t.gym_id = $1';
    res.json((await pool.query(q, [req.params.id])).rows);
});

app.get('/trainings/by-cat/:id', async (req, res) => {
    const q = 'SELECT t.id, t.gym_id, t.category_id, t.day_of_week, TO_CHAR(t.start_time, \'HH24:MI\') as start_time, g.name as gym_name, c.trainer_name FROM trainings t JOIN gyms g ON t.gym_id = g.id JOIN categories c ON t.category_id = c.id WHERE t.category_id = $1';
    res.json((await pool.query(q, [req.params.id])).rows);
});

app.get('/trainings/by-trainer/:name', async (req, res) => {
    const q = `SELECT t.id, t.gym_id, t.category_id, t.day_of_week, TO_CHAR(t.start_time, 'HH24:MI') as start_time, c.name as category_name, c.trainer_name, g.name as gym_name FROM trainings t JOIN categories c ON t.category_id = c.id JOIN gyms g ON t.gym_id = g.id WHERE c.trainer_name = $1`;
    res.json((await pool.query(q, [decodeURIComponent(req.params.name)])).rows);
});

// --- FAVORITOS ---
app.post('/toggle-favorite', async (req, res) => {
    const { user_id, training_id } = req.body;
    try {
        const check = await pool.query('SELECT id FROM favorites WHERE user_id = $1 AND training_id = $2', [user_id, training_id]);
        if (check.rows.length > 0) { await pool.query('DELETE FROM favorites WHERE id = $1', [check.rows[0].id]); res.json({ action: 'removed' }); }
        else { await pool.query('INSERT INTO favorites (user_id, training_id) VALUES ($1, $2)', [user_id, training_id]); res.json({ action: 'added' }); }
    } catch (err) { res.status(500).send(err.message); }
});

app.get('/favorites/:user_id', async (req, res) => {
    const q = `SELECT t.id, t.gym_id, t.category_id, t.day_of_week, TO_CHAR(t.start_time, 'HH24:MI') as start_time, g.name as gym_name, c.name as category_name, c.trainer_name FROM favorites f JOIN trainings t ON f.training_id = t.id JOIN gyms g ON t.gym_id = g.id JOIN categories c ON t.category_id = c.id WHERE f.user_id = $1`;
    res.json((await pool.query(q, [req.params.user_id])).rows);
});

// ✅ Exportar como Netlify Function — SIN app.listen()
module.exports.handler = serverless(app);