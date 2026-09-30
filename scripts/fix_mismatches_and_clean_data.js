require('dotenv').config();
const pool = require('../src/config/db');
const xlsx = require('xlsx');

function cleanRut(r) {
  if (!r) return '';
  return String(r).replace(/[^0-9kK]/g, '').toUpperCase();
}

function cleanPhone(p) {
  if (!p) return null;
  let s = String(p).replace(/[^0-9]/g, '');
  if (s.startsWith('569') && s.length === 11) s = s.slice(2);
  else if (s.startsWith('56') && s.length === 10) s = s.slice(2);
  if (s.length === 8) s = '9' + s;
  return s.length >= 8 ? s : null;
}

function excelDateToJS(serial) {
  if (!serial) return null;
  if (typeof serial === 'string' && serial.includes('-')) return serial;
  const num = Number(serial);
  if (isNaN(num)) return null;
  const utc_days = Math.floor(num - 25569);
  const utc_value = utc_days * 86400;
  const date_info = new Date(utc_value * 1000);
  return date_info.toISOString().split('T')[0];
}

function cleanAgrupacion(agrup) {
  if (!agrup) return '';
  const parts = agrup.split('/').map(s => s.trim());
  const cleanParts = parts.filter(p => !p.match(/^PF\b/i) && !p.match(/\bPF\b/i) && p.length > 0);
  const unique = Array.from(new Set(cleanParts));
  return unique.join(' / ') || agrup;
}

function normalizeName(str) {
  return (str || '').toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

async function runMigration() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    console.log('--- 1. CLEANING AGRUPACIONES IN ATHLETES ---');
    const allAthletesRes = await client.query('SELECT id, agrupacion FROM athletes');
    let agrupCleanCount = 0;
    for (const a of allAthletesRes.rows) {
      const cleaned = cleanAgrupacion(a.agrupacion);
      if (cleaned !== a.agrupacion) {
        await client.query('UPDATE athletes SET agrupacion = $1 WHERE id = $2', [cleaned, a.id]);
        agrupCleanCount++;
      }
    }
    console.log(`Cleaned agrupacion for ${agrupCleanCount} athletes.`);

    console.log('\n--- 2. FIXING SPECIFIC WRONG ASSOCIATIONS & MOVEMENTS ---');

    // A. Separate 122007707 (Javiera López 107) and 145451272 (Alonso Vivar 10)
    await client.query("DELETE FROM athlete_payer_ruts WHERE athlete_id = 10 AND payer_rut = '122007707'");
    await client.query("DELETE FROM athlete_payer_ruts WHERE athlete_id = 107 AND payer_rut = '145451272'");
    await client.query(`
      INSERT INTO athlete_payer_ruts (athlete_id, payer_rut, payer_name, relationship)
      VALUES (107, '122007707', 'Apoderado Javiera López', 'Apoderado')
      ON CONFLICT DO NOTHING
    `);
    await client.query(`
      INSERT INTO athlete_payer_ruts (athlete_id, payer_rut, payer_name, relationship)
      VALUES (10, '145451272', 'Apoderado Alonso Vivar', 'Apoderado')
      ON CONFLICT DO NOTHING
    `);

    // Movements of 122007707 belong to Javiera López (107)
    await client.query("UPDATE bank_movements SET athlete_id = 107 WHERE payer_rut = '122007707'");
    // Movements of 145451272 belong to Alonso Vivar (10)
    await client.query("UPDATE bank_movements SET athlete_id = 10 WHERE payer_rut = '145451272'");
    console.log('Fixed Alonso Vivar / Javiera López movements and RUTs.');

    // B. Reassign movements 744 and 1212 to Luciano Alvarez Vera (132)
    await client.query('UPDATE bank_movements SET athlete_id = 132 WHERE id IN (744, 1212)');
    await client.query("DELETE FROM athlete_payer_ruts WHERE athlete_id = 33 AND payer_rut = '131227744'");
    await client.query(`
      INSERT INTO athlete_payer_ruts (athlete_id, payer_rut, payer_name, relationship)
      VALUES (132, '131227744', 'VERA LILLO SALLY YOBANI', 'Mamá')
      ON CONFLICT DO NOTHING
    `);
    console.log('Fixed Luciano Alvarez Vera movements and RUT 131227744.');

    // C. Reassign movements 615, 795, 1074 to Sofia Antonia Oyarzo Muñoz (218)
    await client.query('UPDATE bank_movements SET athlete_id = 218 WHERE id IN (615, 795, 1074)');
    await client.query('DELETE FROM athlete_payer_ruts WHERE id = 204'); // APR 204 was linking Katherine Munoz to Maximiliano Villarroel
    console.log('Fixed Sofia Antonia Oyarzo Muñoz movements (615, 795, 1074).');

    // D. Reassign movements 583 and 1052 to María Ignacia Ríos Rubilar (151)
    await client.query('UPDATE bank_movements SET athlete_id = 151 WHERE id IN (583, 1052)');
    console.log('Fixed María Ignacia Ríos Rubilar movements (583, 1052).');

    // E. Reassign movements 610 and 1175 to Renata Agustina Muñoz Valenzuela (203)
    await client.query('UPDATE bank_movements SET athlete_id = 203 WHERE id IN (610, 1175)');
    console.log('Fixed Renata Agustina Muñoz Valenzuela movements (610, 1175).');

    // F. Reassign movements 612, 664, 1090 to María Paz Zurita Rossel (153)
    await client.query('UPDATE bank_movements SET athlete_id = 153 WHERE id IN (612, 664, 1090)');
    console.log('Fixed María Paz Zurita Rossel movements (612, 664, 1090).');

    // G. Reassign movement 1101 to Thomas Ignacio Kortmann Merino (230)
    await client.query('UPDATE bank_movements SET athlete_id = 230 WHERE id = 1101');
    console.log('Fixed Thomas Ignacio Kortmann Merino movement (1101).');

    // H. Remove bogus APRs (ID 125, ID 55, ID 238)
    await client.query('DELETE FROM athlete_payer_ruts WHERE id IN (125, 55, 238)');
    console.log('Removed bogus APR IDs 125, 55, 238.');

    console.log('\n--- 3. POPULATING DATA FROM FORMULARIO INGRESO MURANO ---');
    const wb = xlsx.readFile('/Users/camilovelasquez/Downloads/Formulario ingreso a Murano (respuestas).xlsx');
    const formRows = xlsx.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]);

    const currentAthletes = (await client.query('SELECT id, first_name, last_name, rut, phone, apoderado_phone, join_date FROM athletes')).rows;

    let updatedFromForm = 0;
    const insertedAthletes = [];

    for (const row of formRows) {
      const rRut = cleanRut(row['RUT Deportista']);
      const fName = (row['Ambos nombres deportista'] || '').trim();
      const lName = (row['Apellidos Deportista'] || '').trim();
      const formFullName = normalizeName(fName + ' ' + lName);

      // Find match in current athletes
      let matched = currentAthletes.find(a => cleanRut(a.rut) === rRut && rRut.length >= 7);
      if (!matched && formFullName.length > 5) {
        matched = currentAthletes.find(a => {
          const aNorm = normalizeName((a.first_name || '') + ' ' + (a.last_name || ''));
          return aNorm === formFullName || (aNorm.includes(formFullName) && formFullName.length > 8) || (formFullName.includes(aNorm) && aNorm.length > 8);
        });
      }

      const papaPhone = cleanPhone(row['Telefóno apoderado (papá)']);
      const mamaPhone = cleanPhone(row['Teléfono Apoderada (Mamá)']);
      const depPhone = cleanPhone(row['Teléfono deportista']);
      const apodPhone = papaPhone || mamaPhone || null;
      const joinDate = excelDateToJS(row['Fecha de ingreso al club']);
      const email = (row['Correo'] || '').trim();

      if (matched) {
        // Update athlete if needed
        const newPhone = matched.phone || depPhone || apodPhone;
        const newApodPhone = matched.apoderado_phone || apodPhone;
        const newJoinDate = matched.join_date || joinDate;

        await client.query(
          `UPDATE athletes 
           SET phone = COALESCE($1, phone),
               apoderado_phone = COALESCE($2, apoderado_phone),
               join_date = COALESCE($3, join_date),
               email = COALESCE(NULLIF(email, ''), $4)
           WHERE id = $5`,
          [newPhone, newApodPhone, newJoinDate, email, matched.id]
        );
        updatedFromForm++;
      } else {
        // Insert new athlete
        const cat = (row['Categoría a la que ingresa'] || 'Minivoley').trim();
        const fee = cat.toLowerCase().includes('mini') ? 36000 : cat.toLowerCase().includes('tc') ? 35000 : 50000;
        const feeType = cat.toLowerCase().includes('mini') ? 'MINIVOLEY' : cat.toLowerCase().includes('tc') ? 'ADULTO' : 'REGULAR';

        const insRes = await client.query(
          `INSERT INTO athletes (first_name, last_name, category, agrupacion, fee_type, monthly_fee, status, phone, apoderado_phone, join_date, email, rut)
           VALUES ($1, $2, $3, $4, $5, $6, 'ACTIVO', $7, $8, $9, $10, $11)
           RETURNING id, first_name, last_name, category`,
          [fName, lName, cat, cat, feeType, fee, depPhone, apodPhone, joinDate || '2026-09-01', email, rRut]
        );
        insertedAthletes.push(insRes.rows[0]);
      }
    }
    console.log(`Updated ${updatedFromForm} existing athletes with contact info and join dates.`);
    console.log(`Inserted ${insertedAthletes.length} new athletes from Formulario:`, insertedAthletes);

    // If Matilde Catalan Diaz was inserted, link Edgardo Catalan Diaz's movement
    const matildeRes = await client.query("SELECT id FROM athletes WHERE last_name ILIKE '%Catalan Diaz%'");
    if (matildeRes.rows.length > 0) {
      const matildeId = matildeRes.rows[0].id;
      await client.query("UPDATE bank_movements SET athlete_id = $1, status = 'CONCILIADO' WHERE payer_rut = '183611097' AND athlete_id IS NULL", [matildeId]);
      await client.query(`
        INSERT INTO athlete_payer_ruts (athlete_id, payer_rut, payer_name, relationship)
        VALUES ($1, '183611097', 'CATALAN DIAZ EDGARDO ENRIQUE', 'Papá')
        ON CONFLICT DO NOTHING
      `, [matildeId]);
      console.log(`Linked movement and RUT for Matilde Catalan Diaz (Athlete ID ${matildeId}).`);
    }

    // If Elena Rivera Kohler was inserted, link Katherine Kohler's movement
    const elenaRes = await client.query("SELECT id FROM athletes WHERE last_name ILIKE '%Rivera Kohler%'");
    if (elenaRes.rows.length > 0) {
      const elenaId = elenaRes.rows[0].id;
      await client.query("UPDATE bank_movements SET athlete_id = $1, status = 'CONCILIADO' WHERE payer_rut = '152995709' AND athlete_id IS NULL", [elenaId]);
      await client.query(`
        INSERT INTO athlete_payer_ruts (athlete_id, payer_rut, payer_name, relationship)
        VALUES ($1, '152995709', 'Katherine Pamela Kohler Ibarra', 'Mamá')
        ON CONFLICT DO NOTHING
      `, [elenaId]);
      console.log(`Linked movement and RUT for Elena Rivera Kohler (Athlete ID ${elenaId}).`);
    }

    await client.query('COMMIT');
    console.log('\n✅ MIGRATION COMPLETED SUCCESSFULLY!');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ MIGRATION FAILED:', err);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

runMigration();
