const fs = require('fs');
const pool = require('../src/config/db');

function cleanRut(rut) {
    if (!rut) return '';
    return rut.toString().replace(/[^0-9Kk]/g, '').toUpperCase();
}

function normalizeStr(str) {
    if (!str) return '';
    return str.toString().toLowerCase().trim()
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9 ]/g, ' ')
        .replace(/\s+/g, ' ');
}

async function runSync() {
    console.log('🔄 Iniciando sincronización masiva con Bayes...');
    
    // 1. Agregar columnas email y rut a athletes si no existen
    await pool.query(`
        ALTER TABLE athletes ADD COLUMN IF NOT EXISTS email VARCHAR(255);
        ALTER TABLE athletes ADD COLUMN IF NOT EXISTS rut VARCHAR(50);
        ALTER TABLE athletes ADD COLUMN IF NOT EXISTS phone VARCHAR(50);
        ALTER TABLE athletes ADD COLUMN IF NOT EXISTS agrupacion VARCHAR(100);
    `);

    // 2. Leer archivo JSON descargado
    const filePath = '/Users/camilovelasquez/Downloads/deportistas_bayes_250.json';
    if (!fs.existsSync(filePath)) {
        console.error('❌ Archivo no encontrado en:', filePath);
        process.exit(1);
    }

    const bayesData = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    console.log(`📋 Total deportistas leídos desde Bayes: ${bayesData.length}`);

    // 3. Obtener todos los deportistas existentes en la base de datos
    const allAthRes = await pool.query(`SELECT id, first_name, last_name, category, agrupacion, phone, notes FROM athletes`);
    const athletes = allAthRes.rows.map(a => ({
        ...a,
        fullName: `${a.first_name || ''} ${a.last_name || ''}`.trim(),
        normName: normalizeStr(`${a.first_name || ''} ${a.last_name || ''}`)
    }));

    // 4. Obtener todos los RUTs existentes
    const allRutsRes = await pool.query(`SELECT athlete_id, payer_rut FROM athlete_payer_ruts`);
    const rutsMap = new Map();
    allRutsRes.rows.forEach(r => {
        const clean = cleanRut(r.payer_rut);
        if (clean) rutsMap.set(clean, r.athlete_id);
    });

    let updatedCount = 0;
    let newAthletesInserted = 0;
    let rutsLinked = 0;
    const notMatched = [];

    for (const b of bayesData) {
        const cleanR = cleanRut(b.rut);
        const normBName = normalizeStr(b.name);
        const phone = (b.phone || '').trim();
        const agrupacion = (b.agrupacion || '').trim();
        const email = (b.email || '').trim();

        let matchedAthleteId = null;

        // A. Match por RUT existente en athlete_payer_ruts
        if (cleanR && rutsMap.has(cleanR)) {
            matchedAthleteId = rutsMap.get(cleanR);
        }

        // B. Match por nombre exacto normalizado
        if (!matchedAthleteId) {
            const foundExact = athletes.find(a => a.normName === normBName);
            if (foundExact) matchedAthleteId = foundExact.id;
        }

        // C. Match por inclusión de tokens (nombre y apellidos)
        if (!matchedAthleteId) {
            const bTokens = normBName.split(' ').filter(t => t.length > 2);
            const foundFuzzy = athletes.find(a => {
                const aTokens = a.normName.split(' ').filter(t => t.length > 2);
                const matches = bTokens.filter(bt => aTokens.includes(bt));
                return matches.length >= 2 && matches.length >= Math.min(bTokens.length, 2);
            });
            if (foundFuzzy) matchedAthleteId = foundFuzzy.id;
        }

        if (matchedAthleteId) {
            // Actualizar datos del deportista
            await pool.query(
                `UPDATE athletes 
                 SET agrupacion = COALESCE(NULLIF($1, ''), agrupacion),
                     phone = COALESCE(NULLIF($2, ''), phone),
                     email = COALESCE(NULLIF($3, ''), email),
                     rut = COALESCE(NULLIF($4, ''), rut)
                 WHERE id = $5`,
                [agrupacion, phone, email, cleanR, matchedAthleteId]
            );
            updatedCount++;

            // Vincular RUT del alumno a la tabla de RUTs si no existe
            if (cleanR && !rutsMap.has(cleanR)) {
                await pool.query(
                    `INSERT INTO athlete_payer_ruts (athlete_id, payer_rut, payer_name, relationship)
                     VALUES ($1, $2, $3, 'Alumno')
                     ON CONFLICT DO NOTHING`,
                    [matchedAthleteId, cleanR, b.name]
                );
                rutsMap.set(cleanR, matchedAthleteId);
                rutsLinked++;
            }
        } else {
            notMatched.push(b);
        }
    }

    console.log('\n=========================================');
    console.log(`✅ Deportistas actualizados con éxito: ${updatedCount} de ${bayesData.length}`);
    console.log(`🔗 Nuevos RUTs de alumnos vinculados: ${rutsLinked}`);
    if (notMatched.length > 0) {
        console.log(`⚠️ No encontrados en nómina inicial (${notMatched.length}):`);
        notMatched.forEach(nm => console.log(`   - ${nm.name} (${nm.rut}) -> ${nm.agrupacion}`));
    }
    console.log('=========================================\n');

    process.exit(0);
}

runSync().catch(err => {
    console.error('Error durante la sincronización:', err);
    process.exit(1);
});
