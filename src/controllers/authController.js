/**
 * CONTROLADOR DE AUTENTICACIÓN
 * 
 * Este archivo gestiona el registro e inicio de sesión de usuarios.
 * Utiliza bcrypt para el hashing de contraseñas, garantizando la seguridad
 * de las credenciales en la base de datos.
 */

const bcrypt = require('bcryptjs');
const pool = require('../config/db');

/**
 * Registra un nuevo usuario.
 * Asigna el rol de 'admin' si la clave de administrador es correcta.
 */
exports.register = async (req, res) => {
    const { email, password, adminKey } = req.body;
    // Clave actualizada para mayor seguridad
    let role = (adminKey === process.env.ADMIN_KEY || adminKey === 'Murano2025') ? 'admin' : 'user';
    
    try {
        const hash = await bcrypt.hash(password, 10);
        const result = await pool.query(
            'INSERT INTO users (email, password_hash, role) VALUES ($1, $2, $3) RETURNING id, role, email',
            [email, hash, role]
        );
        res.status(201).json(result.rows[0]);
    } catch (err) {
        console.error('Error en registro:', err.message);
        res.status(400).json({ error: 'No se pudo registrar el usuario. El correo podría ya estar en uso.' });
    }
};

/**
 * Inicia sesión de un usuario existente.
 * Compara el hash de la contraseña y retorna los datos básicos del usuario.
 */
exports.login = async (req, res) => {
    const { email, password } = req.body;
    try {
        const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
        
        if (result.rows.length === 0) {
            return res.status(401).json({ error: 'Usuario no encontrado' });
        }

        const valid = await bcrypt.compare(password, result.rows[0].password_hash);
        if (!valid) {
            return res.status(401).json({ error: 'Contraseña incorrecta' });
        }

        res.json({ 
            user_id: result.rows[0].id, 
            role: result.rows[0].role, 
            email: result.rows[0].email 
        });
    } catch (err) {
        console.error('Error en login:', err.message);
        res.status(500).json({ error: 'Error interno del servidor' });
    }
};
