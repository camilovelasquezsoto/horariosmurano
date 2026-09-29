const fs = require('fs');
const path = require('path');
const pool = require('../src/config/db');

function cleanStr(s) {
    if (!s) return '';
    let res = s.toString().toLowerCase().trim();
    const map = { 'á': 'a', 'é': 'e', 'í': 'i', 'ó': 'o', 'ú': 'u', 'ñ': 'n' };
    res = res.replace(/[áéíóúñ]/g, m => map[m] || m);
    return res.replace(/\s+/g, ' ');
}

function formatRut(rut) {
    if (!rut) return '';
    const clean = rut.toString().trim().toUpperCase().replace(/[^0-9K]/g, '');
    if (clean.length < 2) return clean;
    const dv = clean.slice(-1);
    const body = clean.slice(0, -1);
    let formatted = '';
    let count = 0;
    for (let i = body.length - 1; i >= 0; i--) {
        formatted = body[i] + formatted;
        count++;
        if (count % 3 === 0 && i !== 0) formatted = '.' + formatted;
    }
    return `${formatted}-${dv}`;
}

async function runSeed() {
    console.log('🚀 Iniciando inserción de Deportistas y RUTs en Supabase...');
    const raw = fs.readFileSync(path.join(__dirname, 'seed_data.json'), 'utf-8');
    const { athletes, hist_ruts } = JSON.parse(raw);
    console.log(`📋 ${athletes.length} deportistas leídos de seed_data.json`);

    // Limpiar tablas para inserción limpia
    await pool.query('TRUNCATE TABLE athlete_payer_ruts, athletes RESTART IDENTITY CASCADE');

    // 1. Insertar Athletes
    const athleteIdMap = new Map();
    for (let i = 0; i < athletes.length; i++) {
        const a = athletes[i];
        const res = await pool.query(
            `INSERT INTO athletes (first_name, last_name, category, fee_type, monthly_fee, status, notes)
             VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
            [a.first_name, a.last_name, a.category, a.fee_type, a.monthly_fee, a.status, a.notes]
        );
        athleteIdMap.set(i, res.rows[0].id);
    }
    console.log(`✅ ${athletes.length} deportistas insertados exitosamente.`);

    // 2. Asociar RUTs históricos a deportistas
    const athleteRuts = new Map();
    for (let i = 0; i < athletes.length; i++) athleteRuts.set(i, new Map());

    for (const h of hist_ruts) {
        if (!h.rut || !h.alumno) continue;
        const cAl = cleanStr(h.alumno);
        const alWords = cAl.split(' ').filter(w => w.length > 2);
        if (alWords.length === 0) continue;

        let matchIdx = -1;
        for (let i = 0; i < athletes.length; i++) {
            const a = athletes[i];
            const cFn = cleanStr(a.full_name);
            if (alWords.length >= 2 && alWords.every(w => cFn.includes(w))) {
                matchIdx = i;
                break;
            }
        }
        if (matchIdx !== -1) {
            const payerMap = athleteRuts.get(matchIdx);
            if (!payerMap.has(h.rut)) {
                payerMap.set(h.rut, h.payer_name || 'Apoderado');
            }
        }
    }

    let totalRutsInserted = 0;
    for (let i = 0; i < athletes.length; i++) {
        const athleteId = athleteIdMap.get(i);
        const payerMap = athleteRuts.get(i);
        for (const [rut, payerName] of payerMap.entries()) {
            try {
                await pool.query(
                    `INSERT INTO athlete_payer_ruts (athlete_id, payer_rut, payer_name, relationship)
                     VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`,
                    [athleteId, rut, payerName, 'Apoderado']
                );
                totalRutsInserted++;
            } catch (err) {
                console.error(`Error vinculando RUT ${rut}:`, err.message);
            }
        }
    }

    console.log(`✅ ${totalRutsInserted} vínculos RUT-Deportista insertados.`);
}

runSeed()
    .then(() => {
        console.log('🎉 Seed finalizado correctamente!');
        process.exit(0);
    })
    .catch(err => {
        console.error('❌ Error en seed:', err);
        process.exit(1);
    });
