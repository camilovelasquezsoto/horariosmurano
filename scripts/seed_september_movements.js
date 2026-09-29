const pool = require('../src/config/db');
const fs = require('fs');
const path = require('path');

function cleanRut(r) {
    if (!r) return '';
    return r.toString().trim().toUpperCase().replace(/[^0-9K]/g, '');
}

function cleanStr(s) {
    if (!s) return '';
    let res = s.toString().toLowerCase().trim();
    const map = { 'á': 'a', 'é': 'e', 'í': 'i', 'ó': 'o', 'ú': 'u', 'ñ': 'n' };
    res = res.replace(/[áéíóúñ]/g, m => map[m] || m);
    return res.replace(/\s+/g, ' ');
}

async function seedSeptember() {
    console.log('🚀 Importando movimientos bancarios reales de SEPTIEMBRE...');

    // 1. Obtener todos los deportistas
    const athletesRes = await pool.query('SELECT id, first_name, last_name, category, monthly_fee FROM athletes');
    const athletes = athletesRes.rows;

    // 2. Obtener RUTs vinculados
    const rutsRes = await pool.query('SELECT payer_rut, athlete_id FROM athlete_payer_ruts');
    const rutMap = new Map();
    rutsRes.rows.forEach(r => rutMap.set(r.payer_rut, r.athlete_id));

    // Leer movimientos desde python o JSON
    const dataRaw = fs.readFileSync(path.join(__dirname, 'september_movements.json'), 'utf-8');
    const movements = JSON.parse(dataRaw);
    console.log(`📋 Total movimientos a procesar: ${movements.length}`);

    await pool.query('TRUNCATE TABLE bank_movements RESTART IDENTITY');

    let matchedRut = 0;
    let matchedName = 0;
    let pendingCount = 0;

    for (const m of movements) {
        let athleteId = null;
        let status = 'PENDIENTE';
        let concept = 'MENSUALIDAD';

        // 1. Intentar match por RUT
        if (m.payer_rut && rutMap.has(m.payer_rut)) {
            athleteId = rutMap.get(m.payer_rut);
            status = 'CONCILIADO';
            matchedRut++;
        } 
        // 2. Intentar match por Alumno escrito en Excel
        else if (m.alumno) {
            const cAl = cleanStr(m.alumno);
            const alWords = cAl.split(' ').filter(w => w.length > 2);
            if (alWords.length >= 2) {
                const found = athletes.find(a => {
                    const cFn = cleanStr(`${a.first_name} ${a.last_name}`);
                    return alWords.every(w => cFn.includes(w));
                });
                if (found) {
                    athleteId = found.id;
                    status = 'CONCILIADO';
                    matchedName++;
                    // Registrar el RUT para siempre si existe
                    if (m.payer_rut) {
                        try {
                            await pool.query(
                                `INSERT INTO athlete_payer_ruts (athlete_id, payer_rut, payer_name, relationship)
                                 VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`,
                                [found.id, m.payer_rut, m.payer_name || 'Apoderado', 'Apoderado']
                            );
                            rutMap.set(m.payer_rut, found.id);
                        } catch (e) {}
                    }
                }
            }
        }

        if (!athleteId) {
            pendingCount++;
        }

        // Categorizar concepto
        const cDesc = (m.concept || '').toLowerCase();
        if (cDesc.includes('matr')) concept = 'MATRICULA';
        else if (cDesc.includes('camp') || cDesc.includes('torn')) concept = 'CAMPEONATO';
        else if (cDesc.includes('ropa') || cDesc.includes('polera')) concept = 'ROPA';
        else if (cDesc.includes('taller')) concept = 'TALLER';
        else if (cDesc.includes('pase')) concept = 'PASES';

        // Formato fecha YYYY-MM-DD
        let dateParts = (m.date || '').split('-');
        let parsedDate = m.date;
        if (dateParts.length === 3 && dateParts[0].length <= 2) {
            parsedDate = `${dateParts[2]}-${dateParts[1]}-${dateParts[0]}`;
        }

        await pool.query(
            `INSERT INTO bank_movements 
             (date, transfer_type, account_dest, payer_rut, payer_name, bank_origin, account_origin, amount, athlete_id, period, category_concept, status, notes)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
            [
                parsedDate, m.transfer_type, m.account_dest, m.payer_rut, m.payer_name,
                m.bank_origin, m.account_origin, m.amount, athleteId, 'SEPTIEMBRE-2026',
                concept, status, m.concept || ''
            ]
        );
    }

    console.log(`✅ Movimientos insertados:`);
    console.log(`   - Conciliados por RUT: ${matchedRut}`);
    console.log(`   - Conciliados por Nombre/Alumno: ${matchedName}`);
    console.log(`   - Pendientes por asignar: ${pendingCount}`);
}

seedSeptember()
    .then(() => {
        console.log('🎉 Movimientos de septiembre listos!');
        process.exit(0);
    })
    .catch(err => {
        console.error('❌ Error importando septiembre:', err);
        process.exit(1);
    });
