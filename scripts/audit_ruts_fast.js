const pool = require('../src/config/db');
const xlsx = require('xlsx');

async function checkAll() {
  const wb = xlsx.readFile('/Users/camilovelasquez/Downloads/Formulario ingreso a Murano (respuestas).xlsx');
  const formRows = xlsx.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]);

  console.log('Fetching data from DB in parallel...');
  const [aprRes, athRes, bmRes] = await Promise.all([
    pool.query(`
      SELECT apr.id, apr.athlete_id, apr.payer_rut, apr.payer_name, apr.relationship,
             a.first_name, a.last_name, a.rut as athlete_rut, a.agrupacion
      FROM athlete_payer_ruts apr
      JOIN athletes a ON a.id = apr.athlete_id
      ORDER BY apr.id
    `),
    pool.query('SELECT id, first_name, last_name, rut, agrupacion, monthly_fee FROM athletes'),
    pool.query('SELECT id, date, amount, payer_rut, payer_name, notes, athlete_id, category_concept FROM bank_movements')
  ]);

  console.log(`Loaded: ${aprRes.rows.length} athlete_payer_ruts, ${athRes.rows.length} athletes, ${bmRes.rows.length} bank_movements.`);

  function norm(s) {
    return (s || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]/g, ' ')
      .trim();
  }

  function cleanRut(r) {
    return (r || '').toString().replace(/[^0-9kK]/g, '').toUpperCase();
  }

  // Index movements by payer_rut
  const bmByRut = {};
  for (const m of bmRes.rows) {
    const cRut = cleanRut(m.payer_rut);
    if (!cRut) continue;
    if (!bmByRut[cRut]) bmByRut[cRut] = [];
    bmByRut[cRut].push(m);
  }

  const suspicious = [];

  for (const row of aprRes.rows) {
    const aFullName = norm(row.first_name + ' ' + row.last_name);
    const aTokens = aFullName.split(/\s+/).filter(t => t.length >= 4);
    const pTokens = norm(row.payer_name).split(/\s+/).filter(t => t.length >= 4);

    const cPayerRut = cleanRut(row.payer_rut);
    const cAthRut = cleanRut(row.athlete_rut);

    // 1. RUT match?
    const isDirectRutMatch = cPayerRut && cAthRut && (cPayerRut === cAthRut || cPayerRut.slice(0, 7) === cAthRut.slice(0, 7));

    // 2. Token / surname match?
    const matchesAthleteName = pTokens.some(pt => aTokens.some(at => at === pt || (at.length >= 5 && pt.length >= 5 && (at.includes(pt) || pt.includes(at)))));

    // 3. Form entry parent match?
    let matchesFormParent = false;
    let formParentName = '';
    const formEntry = formRows.find(f => {
      const fRut = cleanRut(f['RUT Deportista']);
      return fRut && cAthRut && fRut.slice(0, 7) === cAthRut.slice(0, 7);
    });

    if (formEntry) {
      const papa = norm(formEntry['Nombre y apellido Apoderado (Papá)']);
      const mama = norm(formEntry['Nombre y apellido Apoderada (Mamá)']);
      formParentName = `Papá: ${formEntry['Nombre y apellido Apoderado (Papá)'] || '-'}, Mamá: ${formEntry['Nombre y apellido Apoderada (Mamá)'] || '-'}`;
      if (pTokens.some(pt => papa.includes(pt) || mama.includes(pt))) {
        matchesFormParent = true;
      }
    }

    // 4. Notes in bank movements?
    const movements = bmByRut[cPayerRut] || [];
    const notesStr = norm(movements.map(b => b.notes).join(' '));
    const matchesNotes = aTokens.some(at => at.length >= 4 && notesStr.includes(at));

    if (!isDirectRutMatch && !matchesAthleteName && !matchesFormParent && !matchesNotes) {
      suspicious.push({
        apr_id: row.id,
        athlete_id: row.athlete_id,
        athlete: row.first_name + ' ' + row.last_name,
        athlete_rut: row.athlete_rut,
        payer_rut: row.payer_rut,
        payer_name: row.payer_name,
        formParent: formParentName,
        movCount: movements.length,
        notesSample: movements.map(b => b.notes).filter(Boolean).slice(0, 3).join(' | ')
      });
    }
  }

  console.log(`\n==================================================`);
  console.log(`SUSPICIOUS ATHLETE_PAYER_RUTS: ${suspicious.length}`);
  console.log(`==================================================`);
  suspicious.forEach((s, idx) => {
    console.log(`[${idx + 1}] ID ${s.apr_id} -> Athlete ${s.athlete_id} (${s.athlete}, RUT ${s.athlete_rut})`);
    console.log(`    Payer: "${s.payer_name}" (RUT ${s.payer_rut})`);
    if (s.formParent) console.log(`    Form Parents: ${s.formParent}`);
    console.log(`    Movements count: ${s.movCount}, Notes: "${s.notesSample}"`);
  });

  await pool.end();
}

checkAll().catch(e => {
  console.error(e);
  process.exit(1);
});
