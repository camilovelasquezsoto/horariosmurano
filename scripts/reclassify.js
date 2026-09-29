const pool = require('../src/config/db');

async function reclassify() {
    console.log('Iniciando reclasificación de movimientos...');
    const movsRes = await pool.query(`
        SELECT m.id, m.amount, m.notes, m.athlete_id,
               a.monthly_fee, a.category
        FROM bank_movements m
        LEFT JOIN athletes a ON m.athlete_id = a.id
        WHERE m.period = 'SEPTIEMBRE-2026'
        ORDER BY m.date ASC, m.id ASC
    `);

    const paidMensualidadAthletes = new Set();
    let countMensualidad = 0;
    let countExtra = 0;

    for (const m of movsRes.rows) {
        if (!m.athlete_id) continue;
        const amt = parseFloat(m.amount);
        const fee = parseFloat(m.monthly_fee);

        if (amt === fee && !paidMensualidadAthletes.has(m.athlete_id)) {
            await pool.query('UPDATE bank_movements SET category_concept = $1 WHERE id = $2', ['MENSUALIDAD', m.id]);
            paidMensualidadAthletes.add(m.athlete_id);
            countMensualidad++;
        } else {
            let concept = 'EXTRA';
            const n = (m.notes || '').toLowerCase();
            if (n.includes('matr')) concept = 'MATRICULA';
            else if (n.includes('camp') || n.includes('torn')) concept = 'CAMPEONATO';
            else if (n.includes('ropa') || n.includes('polera')) concept = 'ROPA';
            else if (n.includes('taller')) concept = 'TALLER';
            else if (n.includes('pase')) concept = 'PASES';

            await pool.query('UPDATE bank_movements SET category_concept = $1 WHERE id = $2', [concept, m.id]);
            countExtra++;
        }
    }

    console.log(`✅ Finalizado: ${countMensualidad} mensualidades exactas, ${countExtra} extras.`);
}

reclassify()
    .then(() => process.exit(0))
    .catch(err => {
        console.error(err);
        process.exit(1);
    });
