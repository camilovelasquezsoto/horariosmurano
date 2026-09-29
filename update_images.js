/**
 * Script de actualización de imágenes en la base de datos.
 * Ejecutar una sola vez: node update_images.js
 */

require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

async function updateImages() {
    const client = await pool.connect();
    try {
        console.log('🔗 Conectando a la base de datos...');

        // ── 1. GIMNASIOS ─────────────────────────────────────────────────────
        await client.query(`
            UPDATE gyms SET image_url = '/fotos_gym/fotogimnasio.png'
        `);
        console.log('✅ Foto del gimnasio actualizada en las 3 canchas');

        // ── 2. FOTOS DE CATEGORÍAS ────────────────────────────────────────────
        const catUpdates = [
            { name: 'Tc varones',   image_url: '/fotos_categorias/TCvarones.png' },
            { name: 'Tc damas',     image_url: '/fotos_categorias/TCdamas.png' },
            { name: 'U18 DAMAS',    image_url: '/fotos_categorias/u18damas.png' },
            { name: 'U18 VARONES',  image_url: '/fotos_categorias/u18varones.png' },
            { name: 'U16 A DAMAS',  image_url: '/fotos_categorias/u16adamas.png' },
            { name: 'U16 B DAMAS',  image_url: '/fotos_categorias/u16bdamas.png' },
            { name: 'U16 VARONES',  image_url: '/fotos_categorias/u16varones.png' },
            { name: 'U14 DAMAS',    image_url: '/fotos_categorias/u14adamas.png' },
            { name: 'U14 B DAMAS',  image_url: '/fotos_categorias/imagenpredeterminada.png' },
            { name: 'U14 VARONES',  image_url: '/fotos_categorias/imagenpredeterminada.png' },
            { name: 'U12 DAMAS',    image_url: '/fotos_categorias/u12damas.png' },
            { name: 'Mini Voley',   image_url: '/fotos_categorias/imagenpredeterminada.png' },
        ];

        for (const c of catUpdates) {
            const r = await client.query(
                'UPDATE categories SET image_url = $1 WHERE name = $2',
                [c.image_url, c.name]
            );
            console.log(`  📸 ${c.name}: ${r.rowCount > 0 ? 'actualizada' : '⚠️ no encontrada'}`);
        }

        // ── 3. FOTOS DE ENTRENADORES (trainer_image_url en categories) ────────
        const trainerUpdates = [
            { trainer: 'Francisco Beltrán',    img: '/profesores/francisco.png' },
            // Descomentar cuando el usuario confirme a quién pertenece jorge.png:
            // { trainer: 'NOMBRE_TRAINER',    img: '/profesores/jorge.png' },
        ];

        // Predeterminada para todos los trainers sin foto asignada
        await client.query(`
            UPDATE categories
            SET trainer_image_url = '/profesores/fotopredeterminadaprofe.png'
            WHERE trainer_image_url IS NULL OR trainer_image_url = ''
        `);
        console.log('✅ Foto predeterminada asignada a entrenadores sin imagen');

        for (const t of trainerUpdates) {
            const r = await client.query(
                'UPDATE categories SET trainer_image_url = $1 WHERE trainer_name = $2',
                [t.img, t.trainer]
            );
            console.log(`  👤 ${t.trainer}: ${r.rowCount > 0 ? 'actualizada' : '⚠️ no encontrada'}`);
        }

        console.log('\n🎉 Actualización completada correctamente.');
    } catch (err) {
        console.error('❌ Error:', err.message);
    } finally {
        client.release();
        pool.end();
    }
}

updateImages();
