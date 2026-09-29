const pool = require('../src/config/db');

async function run() {
  console.log('Running smart reconciliation on September movements...');
  
  // 1. Get all RUT mappings with athlete details
  const rutsRes = await pool.query(`
    SELECT r.payer_rut, r.athlete_id, a.first_name, a.last_name, a.category, a.monthly_fee
    FROM athlete_payer_ruts r
    JOIN athletes a ON r.athlete_id = a.id
  `);
  
  const rutMap = new Map();
  rutsRes.rows.forEach(r => {
    if (!rutMap.has(r.payer_rut)) rutMap.set(r.payer_rut, []);
    rutMap.get(r.payer_rut).push(r);
  });

  // 2. Fetch all movements of September
  const movsRes = await pool.query(`
    SELECT * FROM bank_movements WHERE period = 'SEPTIEMBRE-2026' ORDER BY date ASC, id ASC
  `);
  
  const paidAthletes = new Map();
  let fixedCount = 0;
  let reclassified = 0;

  for (const m of movsRes.rows) {
    const matched = rutMap.get(m.payer_rut) || [];
    if (matched.length === 0) continue;

    const amt = parseFloat(m.amount);
    const nLow = (m.notes || '').toLowerCase();
    const isSpecialConcept = nLow.includes('matr') || nLow.includes('ropa') || nLow.includes('polera') || nLow.includes('torneo') || nLow.includes('camp');

    if (matched.length === 1) {
      const ath = matched[0];
      const fee = parseFloat(ath.monthly_fee);
      
      if (Math.abs(amt - fee) < 1 && fee > 0 && m.category_concept === 'EXTRA' && !isSpecialConcept) {
        await pool.query(
          'UPDATE bank_movements SET category_concept = $1, athlete_id = $2, status = $3 WHERE id = $4',
          ['MENSUALIDAD', ath.athlete_id, 'CONCILIADO', m.id]
        );
        reclassified++;
      }
    } else {
      // Multiple kids linked to this RUT!
      // Try to find candidate kid whose fee matches and hasn't had their monthly fee paid yet
      let candidate = matched.find(k => Math.abs(parseFloat(k.monthly_fee) - amt) < 1 && !paidAthletes.has(k.athlete_id));
      if (!candidate) {
        candidate = matched.find(k => Math.abs(parseFloat(k.monthly_fee) - amt) < 1);
      }

      if (candidate) {
        paidAthletes.set(candidate.athlete_id, true);
        const shouldBeMensualidad = !isSpecialConcept;
        const concept = shouldBeMensualidad ? 'MENSUALIDAD' : m.category_concept;
        const noteAdd = `Mensualidad de ${candidate.first_name} ${candidate.last_name} (${candidate.category})`;

        let newNotes = m.notes || '';
        if (!newNotes.includes(candidate.first_name)) {
          newNotes = newNotes ? `${newNotes} | ${noteAdd}` : noteAdd;
        }

        await pool.query(
          'UPDATE bank_movements SET athlete_id = $1, category_concept = $2, status = $3, notes = $4 WHERE id = $5',
          [candidate.athlete_id, concept, 'CONCILIADO', newNotes, m.id]
        );
        fixedCount++;
      } else {
        // Combined sum or extra amount
        const kidsNames = matched.map(k => `${k.first_name} (${k.category})`).join(' y ');
        let newNotes = m.notes || '';
        if (!newNotes.includes('Apoderado de:')) {
          newNotes = newNotes ? `${newNotes} | Apoderado de: ${kidsNames}` : `Apoderado de: ${kidsNames}`;
          await pool.query(
            'UPDATE bank_movements SET notes = $1 WHERE id = $2',
            [newNotes, m.id]
          );
        }
      }
    }
  }

  console.log(`Smart reconciliation complete! Multiple-child transfers reallocated: ${fixedCount}, Single-child reclassified: ${reclassified}`);
  
  // Print new summary
  const summaryRes = await pool.query(`
    SELECT category_concept, count(*), sum(amount) 
    FROM bank_movements 
    WHERE period = 'SEPTIEMBRE-2026'
    GROUP BY category_concept
  `);
  console.log('September summary by concept:', summaryRes.rows);

  process.exit();
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
