/**
 * CONTROLADOR DE FINANZAS Y PAGOS - MURANO VOLEY
 * 
 * Gestiona el registro de deportistas, vinculación de RUTs de apoderados,
 * conciliación automática de transferencias bancarias y reportes de cobranza.
 */

const pool = require('../config/db');
const xlsx = require('xlsx');

// Utilidades para normalización de RUT chileno
function cleanRut(rut) {
    if (!rut) return '';
    return rut.toString().trim().toUpperCase().replace(/[^0-9K]/g, '');
}

function formatRut(rut) {
    const clean = cleanRut(rut);
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

function cleanStr(s) {
    if (!s) return '';
    let res = s.toString().toLowerCase().trim();
    const map = { 'á': 'a', 'é': 'e', 'í': 'i', 'ó': 'o', 'ú': 'u', 'ñ': 'n' };
    res = res.replace(/[áéíóúñ]/g, m => map[m] || m);
    return res.replace(/\s+/g, ' ');
}

function cleanAmount(val) {
    if (!val && val !== 0) return 0;
    if (typeof val === 'number') return Math.round(val);
    let str = val.toString().trim().replace(/[$\s]/g, '');
    if (str.includes(',')) str = str.split(',')[0];
    str = str.replace(/\./g, '');
    return parseInt(str, 10) || 0;
}

// 1. Obtener lista de deportistas con sus RUTs asociados y estado de pago del mes
exports.getAthletes = async (req, res) => {
    try {
        const { period, category, agrupacion, search, status, semaforo } = req.query;
        const currentPeriod = period || 'SEPTIEMBRE-2026';

        let query = `
            SELECT 
                a.id,
                a.first_name,
                a.last_name,
                (a.first_name || ' ' || a.last_name) as full_name,
                a.category,
                COALESCE(a.agrupacion, 'Sin Agrupación') as agrupacion,
                a.phone,
                a.apoderado_phone,
                a.join_date,
                a.rut,
                a.email,
                a.fee_type,
                a.monthly_fee,
                a.status,
                a.notes,
                a.created_at,
                COALESCE(ruts_agg.payer_ruts, '[]') as payer_ruts,
                COALESCE(movs_agg.amount_paid, 0) as amount_paid,
                COALESCE(movs_agg.extras_paid, 0) as extras_paid,
                COALESCE(movs_agg.payments_count, 0) as payments_count
            FROM athletes a
            LEFT JOIN (
                SELECT 
                    athlete_id,
                    json_agg(
                        json_build_object(
                            'id', id,
                            'payer_rut', payer_rut,
                            'payer_name', payer_name,
                            'relationship', relationship
                        )
                    ) as payer_ruts
                FROM athlete_payer_ruts
                GROUP BY athlete_id
            ) ruts_agg ON a.id = ruts_agg.athlete_id
            LEFT JOIN (
                SELECT 
                    athlete_id,
                    COALESCE(SUM(amount) FILTER (WHERE category_concept = 'MENSUALIDAD' AND category_concept != 'ANULADO'), 0) as amount_paid,
                    COALESCE(SUM(amount) FILTER (WHERE category_concept != 'MENSUALIDAD' AND category_concept != 'ANULADO'), 0) as extras_paid,
                    COUNT(id) FILTER (WHERE category_concept != 'ANULADO') as payments_count
                FROM bank_movements
                WHERE status = 'CONCILIADO' AND (period = $1 OR ($1 = '' AND period IS NOT NULL))
                GROUP BY athlete_id
            ) movs_agg ON a.id = movs_agg.athlete_id
            WHERE 1=1
        `;
        const params = [currentPeriod];
        let pIdx = 2;

        if (category && category !== 'TODAS') {
            query += ` AND a.category = $${pIdx++}`;
            params.push(category);
        }

        if (agrupacion && agrupacion !== 'TODAS') {
            query += ` AND a.agrupacion = $${pIdx++}`;
            params.push(agrupacion);
        }

        if (status === 'INACTIVO' || status === 'RETIRADO') {
            query += ` AND a.status IN ('INACTIVO', 'RETIRADO')`;
        } else if (status && status !== 'TODOS') {
            query += ` AND a.status = $${pIdx++}`;
            params.push(status);
        } else if (!status || status !== 'TODOS') {
            // Por defecto, ocultar alumnos inactivos o retirados de la nómina y cuotas
            query += ` AND a.status NOT IN ('INACTIVO', 'RETIRADO')`;
        }

        if (search) {
            const words = search.trim().split(/\s+/).filter(Boolean);
            words.forEach(w => {
                query += ` AND (
                    LOWER(a.first_name || ' ' || a.last_name) LIKE $${pIdx} 
                    OR LOWER(a.category) LIKE $${pIdx}
                    OR LOWER(COALESCE(a.agrupacion, '')) LIKE $${pIdx}
                    OR EXISTS (
                        SELECT 1 FROM athlete_payer_ruts pr 
                        WHERE pr.athlete_id = a.id AND (pr.payer_rut LIKE $${pIdx} OR LOWER(pr.payer_name) LIKE $${pIdx})
                    )
                )`;
                params.push(`%${w.toLowerCase()}%`);
                pIdx++;
            });
        }

        query += `
            ORDER BY a.category ASC, a.last_name ASC, a.first_name ASC
        `;

        const result = await pool.query(query, params);

        // Consultar historial de pagos para calcular el Semáforo de Deuda histórico
        const historyRes = await pool.query(`
            SELECT athlete_id, period, COALESCE(SUM(amount), 0) as paid
            FROM bank_movements
            WHERE status = 'CONCILIADO' AND category_concept = 'MENSUALIDAD'
            GROUP BY athlete_id, period
        `);
        const historyMap = {};
        historyRes.rows.forEach(r => {
            historyMap[`${r.athlete_id}_${r.period}`] = parseFloat(r.paid);
        });

        const periodDates = {
            'JULIO-2026': '2026-07-01',
            'AGOSTO-2026': '2026-08-01',
            'SEPTIEMBRE-2026': '2026-09-01',
            'OCTUBRE-2026': '2026-10-01',
            'NOVIEMBRE-2026': '2026-11-01',
            'DICIEMBRE-2026': '2026-12-01'
        };
        const orderedPeriods = ['JULIO-2026', 'AGOSTO-2026', 'SEPTIEMBRE-2026', 'OCTUBRE-2026', 'NOVIEMBRE-2026', 'DICIEMBRE-2026'];
        const curIdx = orderedPeriods.indexOf(currentPeriod) >= 0 ? orderedPeriods.indexOf(currentPeriod) : 2;

        // Procesar estado de pago dinámico y Semáforo de Deuda
        let athletes = result.rows.map(row => {
            const fee = parseFloat(row.monthly_fee) || 0;
            const paid = parseFloat(row.amount_paid) || 0;
            const extras = parseFloat(row.extras_paid) || 0;
            let payment_status = 'PENDIENTE';
            let debt_semaforo = 'AMARILLO';
            let unpaid_months = 0;

            const isInactive = row.status === 'INACTIVO' || row.status === 'RETIRADO';

            if (isInactive) {
                payment_status = row.status;
                debt_semaforo = 'INACTIVO';
                unpaid_months = 0;
            } else if (row.status === 'BECADO' || row.fee_type === 'BECADO' || row.fee_type === 'BECA_COMPLETA' || fee === 0) {
                payment_status = 'BECADO';
                debt_semaforo = 'BECADO';
                unpaid_months = 0;
            } else if (paid >= fee) {
                payment_status = 'PAGADO';
                debt_semaforo = 'AL_DIA';
                unpaid_months = 0;
            } else {
                // Formato ISO para join_date (fallback a enero 2026 para deportistas preexistentes)
                const athleteJoinDate = row.join_date ? new Date(row.join_date).toISOString().slice(0, 10) : '2026-01-01';
                const curPDate = periodDates[currentPeriod] || '2026-09-01';

                // Si el alumno ingresó en un periodo futuro al actual (ej: ingresó en Octubre y estamos viendo Septiembre)
                if (athleteJoinDate.slice(0, 7) > curPDate.slice(0, 7)) {
                    payment_status = 'NO_INGRESADO';
                    debt_semaforo = 'AL_DIA';
                    unpaid_months = 0;
                } else {
                    if (paid > 0) payment_status = 'PARCIAL';
                    unpaid_months = 1;

                    // Revisar meses previos consecutivos impagos SOLO si el alumno ya pertenecía al club en ese periodo
                    for (let i = curIdx - 1; i >= 0; i--) {
                        const prevP = orderedPeriods[i];
                        const prevPDate = periodDates[prevP];
                        
                        // Si el periodo previo es anterior al mes de ingreso del deportista, NO genera deuda
                        if (prevPDate.slice(0, 7) < athleteJoinDate.slice(0, 7)) {
                            break;
                        }

                        const prevPaid = historyMap[`${row.id}_${prevP}`] || 0;
                        if (prevPaid < fee) {
                            unpaid_months++;
                        } else {
                            break;
                        }
                    }

                    if (unpaid_months === 1) debt_semaforo = 'AMARILLO';
                    else if (unpaid_months === 2) debt_semaforo = 'NARANJA';
                    else debt_semaforo = 'ROJO';
                }
            }

            return {
                ...row,
                formatted_ruts: row.payer_ruts.map(r => ({
                    ...r,
                    formatted_rut: formatRut(r.payer_rut)
                })),
                payment_status,
                debt_semaforo,
                unpaid_months,
                extras_paid: extras,
                debt_amount: (isInactive || payment_status === 'NO_INGRESADO') ? 0 : Math.max(0, fee - paid),
                debt_total_accumulated: (isInactive || payment_status === 'NO_INGRESADO') ? 0 : (unpaid_months > 0 ? (unpaid_months * fee - (paid > 0 && paid < fee ? paid : 0)) : 0)
            };
        });

        // Filtro por semáforo si se solicita
        if (semaforo && semaforo !== 'TODOS') {
            athletes = athletes.filter(a => a.debt_semaforo === semaforo);
        }

        res.json({
            period: currentPeriod,
            total: athletes.length,
            athletes
        });
    } catch (err) {
        console.error('Error al obtener deportistas:', err);
        res.status(500).json({ error: 'Error al consultar deportistas', details: err.message });
    }
};

// 2. Crear nuevo deportista
exports.createAthlete = async (req, res) => {
    try {
        const { first_name, last_name, category, agrupacion, fee_type, monthly_fee, status, notes, initial_rut, payer_name, phone, apoderado_phone, join_date } = req.body;
        
        let calculatedFee = monthly_fee;
        if (calculatedFee === undefined || calculatedFee === null || calculatedFee === '') {
            const cat = (category || '').toLowerCase();
            if (fee_type === 'BECADO' || status === 'BECADO') calculatedFee = 0;
            else if (cat.includes('master') || cat.includes('máster')) calculatedFee = 36000;
            else if (cat.includes('tc') || cat.includes('adult')) calculatedFee = 35000;
            else if (cat.includes('mini') || /\bu(6|7|8|9|10|11)\b/.test(cat)) calculatedFee = 36000;
            else calculatedFee = 50000;
        }

        const validJoinDate = join_date ? join_date : '2026-09-01';

        const insertAthlete = await pool.query(
            `INSERT INTO athletes (first_name, last_name, category, agrupacion, fee_type, monthly_fee, status, phone, apoderado_phone, join_date, notes)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *`,
            [first_name.trim(), last_name.trim(), (category || 'Sin Categoría').trim(), (agrupacion || '').trim(), fee_type || 'REGULAR', calculatedFee, status || 'ACTIVO', phone || '', apoderado_phone || '', validJoinDate, notes || '']
        );
        const athlete = insertAthlete.rows[0];

        // Si se proporcionó un RUT inicial, vincularlo
        if (initial_rut) {
            const cRut = cleanRut(initial_rut);
            await pool.query(
                `INSERT INTO athlete_payer_ruts (athlete_id, payer_rut, payer_name, relationship)
                 VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`,
                [athlete.id, cRut, payer_name || 'Apoderado', 'Apoderado']
            );
        }

        res.status(201).json(athlete);
    } catch (err) {
        console.error('Error al crear deportista:', err);
        res.status(500).json({ error: 'No se pudo crear el deportista', details: err.message });
    }
};

// 3. Actualizar deportista
exports.updateAthlete = async (req, res) => {
    try {
        const { id } = req.params;
        const { first_name, last_name, category, agrupacion, fee_type, monthly_fee, status, phone, apoderado_phone, join_date, notes } = req.body;

        const curRes = await pool.query('SELECT * FROM athletes WHERE id = $1', [id]);
        if (curRes.rows.length === 0) {
            return res.status(404).json({ error: 'Deportista no encontrado' });
        }
        const cur = curRes.rows[0];

        const newFirst = first_name !== undefined ? first_name.trim() : cur.first_name;
        const newLast = last_name !== undefined ? last_name.trim() : cur.last_name;
        const newCat = category !== undefined ? category.trim() : cur.category;
        const newAgrup = agrupacion !== undefined ? agrupacion.trim() : cur.agrupacion;
        const newFeeType = fee_type !== undefined ? fee_type : cur.fee_type;
        const newFee = monthly_fee !== undefined ? parseFloat(monthly_fee) : cur.monthly_fee;
        const newStatus = status !== undefined ? status : cur.status;
        const newPhone = phone !== undefined ? phone.trim() : cur.phone;
        const newApodPhone = apoderado_phone !== undefined ? apoderado_phone.trim() : cur.apoderado_phone;
        const newJoinDate = join_date !== undefined ? join_date : (cur.join_date ? new Date(cur.join_date).toISOString().slice(0, 10) : '2026-09-01');
        const newNotes = notes !== undefined ? notes : cur.notes;

        const result = await pool.query(
            `UPDATE athletes 
             SET first_name = $1, last_name = $2, category = $3, agrupacion = $4, fee_type = $5, 
                 monthly_fee = $6, status = $7, phone = $8, apoderado_phone = $9, join_date = $10, notes = $11
             WHERE id = $12 RETURNING *`,
            [newFirst, newLast, newCat, newAgrup, newFeeType, newFee, newStatus, newPhone, newApodPhone, newJoinDate, newNotes, id]
        );

        res.json(result.rows[0]);
    } catch (err) {
        console.error('Error al actualizar deportista:', err);
        res.status(500).json({ error: 'Error al actualizar', details: err.message });
    }
};

// 4. Eliminar deportista
exports.deleteAthlete = async (req, res) => {
    try {
        const { id } = req.params;
        await pool.query('DELETE FROM athletes WHERE id = $1', [id]);
        res.json({ message: 'Deportista eliminado correctamente' });
    } catch (err) {
        console.error('Error al eliminar deportista:', err);
        res.status(500).json({ error: 'Error al eliminar', details: err.message });
    }
};

// 5. Vincular RUT pagador a deportista
exports.addPayerRut = async (req, res) => {
    try {
        const { athlete_id, payer_rut, payer_name, relationship } = req.body;
        const cRut = cleanRut(payer_rut);

        if (!cRut) {
            return res.status(400).json({ error: 'RUT inválido' });
        }

        const result = await pool.query(
            `INSERT INTO athlete_payer_ruts (athlete_id, payer_rut, payer_name, relationship)
             VALUES ($1, $2, $3, $4)
             ON CONFLICT (athlete_id, payer_rut) 
             DO UPDATE SET payer_name = EXCLUDED.payer_name, relationship = EXCLUDED.relationship
             RETURNING *`,
            [athlete_id, cRut, (payer_name || '').trim(), (relationship || 'Apoderado').trim()]
        );

        // Si existen movimientos bancarios previos con este RUT sin asignar, conciliarlos retroactivamente
        await pool.query(
            `UPDATE bank_movements 
             SET athlete_id = $1, status = 'CONCILIADO'
             WHERE payer_rut = $2 AND athlete_id IS NULL`,
            [athlete_id, cRut]
        );

        res.status(201).json(result.rows[0]);
    } catch (err) {
        console.error('Error al vincular RUT:', err);
        res.status(500).json({ error: 'Error al vincular RUT', details: err.message });
    }
};

// 6. Desvincular RUT
exports.removePayerRut = async (req, res) => {
    try {
        const { id } = req.params;
        await pool.query('DELETE FROM athlete_payer_ruts WHERE id = $1', [id]);
        res.json({ message: 'RUT desvinculado' });
    } catch (err) {
        console.error('Error al desvincular RUT:', err);
        res.status(500).json({ error: 'Error al desvincular', details: err.message });
    }
};

// Helper para parsear XML de Scotiabank (typeDesc)
function parseScotiabankXML(xmlString) {
    const regex = /<movimiento>(.*?)<\/movimiento>/gs;
    let match;
    const movements = [];

    while ((match = regex.exec(xmlString)) !== null) {
        const movXml = match[1];
        const getTag = (tag) => {
            const m = movXml.match(new RegExp('<' + tag + '>(.*?)</' + tag + '>'));
            return m ? m[1].trim() : '';
        };

        const monto = parseFloat(getTag('monto')) || 0;
        const abono = parseFloat(getTag('abono')) || 0;
        const amt = abono || monto;
        if (amt <= 0) continue; // Descartar egresos y cargos negativos

        const fecha = getTag('fecha_movimiento'); // DD-MM-YYYY
        const desc = getTag('descripcion');
        const doc = getTag('documento_numero');
        const sucursal = getTag('sucursal');

        let payerRut = '';
        let payerName = desc;
        const tefMatch = desc.match(/TEF\s+([0-9Kk.-]+)\s*(.*)/i);
        if (tefMatch) {
            payerRut = cleanRut(tefMatch[1]);
            payerName = tefMatch[2].trim() || desc;
        } else if (desc.toUpperCase().startsWith('TRANSF. DE ')) {
            payerName = desc.substring(10).trim();
        }

        movements.push({
            date: fecha,
            transfer_type: 'TRANSFERENCIA',
            account_dest: '',
            payer_rut: payerRut,
            payer_name: payerName,
            bank_origin: sucursal ? `Scotiabank (${sucursal})` : 'Scotiabank',
            account_origin: (doc || '').trim(),
            amount: Math.round(amt),
            concept: desc
        });
    }
    return movements;
}

// 7. Procesar y conciliar Cartola Bancaria / Últimos Movimientos (desde archivo Excel, XML o array JSON)
exports.processCartola = async (req, res) => {
    try {
        let movements = [];
        const { period } = req.body;
        const currentPeriod = period || 'SEPTIEMBRE-2026';

        if (req.file) {
            const fileStr = req.file.buffer.toString('utf8');
            if (fileStr.includes('<cartola') && fileStr.includes('<movimiento>')) {
                // Archivo XML Scotiabank (typeDesc)
                movements = parseScotiabankXML(fileStr);
            } else {
                // Se subió un archivo Excel o CSV
                const workbook = xlsx.read(req.file.buffer, { type: 'buffer' });
                let sheetName = workbook.SheetNames[0];
                if (currentPeriod) {
                    const pUpper = currentPeriod.toUpperCase();
                    const matchedSheet = workbook.SheetNames.find(s => pUpper.includes(s.toUpperCase()) || s.toUpperCase().includes(pUpper.split('-')[0]));
                    if (matchedSheet) sheetName = matchedSheet;
                }
                const rows = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1 });

                // Buscar fila encabezado
                let headerIdx = -1;
                for (let r = 0; r < Math.min(rows.length, 15); r++) {
                    if (rows[r] && (rows[r][0] === 'Fecha' || rows[r][3] === 'Rut Origen')) {
                        headerIdx = r;
                        break;
                    }
                }

                const startIdx = headerIdx !== -1 ? headerIdx + 1 : 0;
                for (let r = startIdx; r < rows.length; r++) {
                    const row = rows[r];
                    if (!row || !row[0]) continue;

                    let dateVal = row[0];
                    let rutRaw = row[3];
                    let payerName = row[4];
                    let amountRaw = row[7] || 0;
                    let conceptRaw = row[8] || '';

                    const clAmt = cleanAmount(amountRaw);
                    if (clAmt <= 0) continue; // Descartar salidas

                    movements.push({
                        date: dateVal,
                        transfer_type: (row[1] || 'TRANSFERENCIA').toString().trim(),
                        account_dest: (row[2] || '').toString().trim(),
                        payer_rut: cleanRut(rutRaw),
                        payer_name: (payerName || '').toString().trim(),
                        bank_origin: (row[5] || '').toString().trim(),
                        account_origin: (row[6] || '').toString().trim(),
                        amount: clAmt,
                        concept: (conceptRaw || '').toString().trim()
                    });
                }
            }
        } else if (Array.isArray(req.body.movements)) {
            movements = req.body.movements
                .filter(m => cleanAmount(m.amount) > 0)
                .map(m => ({
                    date: m.date,
                    transfer_type: m.transfer_type || 'TRANSFERENCIA',
                    account_dest: m.account_dest || '',
                    payer_rut: cleanRut(m.payer_rut),
                    payer_name: (m.payer_name || '').trim(),
                    bank_origin: m.bank_origin || '',
                    account_origin: (m.account_origin || '').trim(),
                    amount: cleanAmount(m.amount),
                    concept: m.concept || ''
                }));
        } else {
            return res.status(400).json({ error: 'No se enviaron movimientos ni archivo' });
        }

        // Obtener todos los RUTs vinculados en memoria con categorías y aranceles para match instantáneo
        const rutsRes = await pool.query(`
            SELECT r.payer_rut, r.athlete_id, a.first_name, a.last_name, a.category, a.monthly_fee
            FROM athlete_payer_ruts r
            JOIN athletes a ON r.athlete_id = a.id
        `);
        const rutLookup = new Map();
        rutsRes.rows.forEach(r => {
            if (!rutLookup.has(r.payer_rut)) rutLookup.set(r.payer_rut, []);
            rutLookup.get(r.payer_rut).push(r);
        });

        const athletesRes = await pool.query(`SELECT id, first_name, last_name, category, monthly_fee FROM athletes`);
        const allAthletes = athletesRes.rows;

        // Prefetch de movimientos existentes para deduplicación ultra rápida en memoria (sin N+1 queries)
        const existingRes = await pool.query(`
            SELECT id, TO_CHAR(date, 'YYYY-MM-DD') as date_str, amount, payer_rut, 
                   LOWER(TRIM(COALESCE(payer_name, ''))) as payer_name, 
                   TRIM(COALESCE(account_origin, '')) as account_origin, 
                   LOWER(COALESCE(notes, '')) as notes_lower 
            FROM bank_movements
        `);
        const existingMovements = existingRes.rows;

        // Contadores y lista de nuevos registros a insertar
        let totalProcessed = 0;
        let matchedCount = 0;
        let pendingCount = 0;
        let duplicateCount = 0;
        const newRecordsToInsert = [];

        for (const mov of movements) {
            const amt = Math.round(cleanAmount(mov.amount));
            if (!amt || amt <= 0) continue;

            // Normalizar fecha si viene en string dd-mm-aaaa o dd/mm/aaaa
            let parsedDate = mov.date;
            if (typeof mov.date === 'string') {
                const cleanDate = mov.date.trim();
                if (cleanDate.includes('-')) {
                    const parts = cleanDate.split('-');
                    if (parts.length === 3 && parts[0].length <= 2) {
                        parsedDate = `${parts[2]}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}`;
                    }
                } else if (cleanDate.includes('/')) {
                    const parts = cleanDate.split('/');
                    if (parts.length === 3 && parts[0].length <= 2) {
                        parsedDate = `${parts[2]}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}`;
                    }
                }
            }

            const doc = (mov.account_origin || '').trim();
            const rut = cleanRut(mov.payer_rut);
            const payerNameClean = (mov.payer_name || '').trim().toLowerCase();

            // ── DEDUPLICACIÓN INTELIGENTE EN MEMORIA ──
            let isDuplicate = false;

            // 1. Por documento/ref y monto (Scotiabank transaction doc / TEF ref)
            if (doc && doc !== '') {
                const docLower = doc.toLowerCase();
                if (existingMovements.some(em => 
                    Math.round(em.amount) === amt && (
                        (em.account_origin && em.account_origin === doc) || 
                        (em.notes_lower && em.notes_lower.includes(docLower))
                    )
                )) {
                    isDuplicate = true;
                }
            }

            // 2. Por fecha, monto y RUT del pagador
            if (!isDuplicate && rut && rut !== '') {
                if (existingMovements.some(em => 
                    Math.round(em.amount) === amt && 
                    em.date_str === parsedDate && 
                    em.payer_rut === rut
                )) {
                    isDuplicate = true;
                }
            }

            // 3. Por fecha, monto y nombre del pagador (útil para transferencias internas 'TRANSF. DE ...')
            if (!isDuplicate && payerNameClean && payerNameClean.length > 3) {
                if (existingMovements.some(em => 
                    Math.round(em.amount) === amt && 
                    em.date_str === parsedDate && (
                        (em.payer_name && (em.payer_name.includes(payerNameClean) || payerNameClean.includes(em.payer_name))) ||
                        (em.notes_lower && em.notes_lower.includes(payerNameClean))
                    )
                )) {
                    isDuplicate = true;
                }
            }

            if (isDuplicate) {
                duplicateCount++;
                continue;
            }

            // Detección inicial de concepto por texto
            let categoryConcept = 'POR_DEFINIR';
            const cLow = ((mov.concept || '') + ' ' + (mov.payer_name || '')).toLowerCase();
            if (cLow.includes('anula') || cLow.includes('devuel') || cLow.includes('errone') || cLow.includes('reversa')) categoryConcept = 'ANULADO';
            else if (cLow.includes('cancha')) categoryConcept = 'ARRIENDO_CANCHA';
            else if (cLow.includes('visita') && (cLow.includes('camp') || cLow.includes('torneo'))) categoryConcept = 'INSCRIPCION_CAMPEONATO_VISITA';
            else if (cLow.includes('local') && (cLow.includes('camp') || cLow.includes('torneo'))) categoryConcept = 'PAGO_CAMPEONATO_LOCAL';
            else if (cLow.includes('camp') || cLow.includes('torneo') || cLow.includes('campeonato')) categoryConcept = 'CAMPEONATO';
            else if (cLow.includes('matr')) categoryConcept = 'MATRICULA';
            else if (cLow.includes('ropa') || cLow.includes('polera') || cLow.includes('indumentaria') || cLow.includes('short')) categoryConcept = 'ROPA';
            else if (cLow.includes('taller') || cLow.includes('clinica')) categoryConcept = 'TALLERES';
            else if (cLow.includes('pase')) categoryConcept = 'PASES';
            else if (cLow.includes('clase') || cLow.includes('personaliz')) categoryConcept = 'CLASES_PERSONALIZADAS';
            else if (cLow.includes('arriendo') || cLow.includes('gym') || cLow.includes('gimnasio')) categoryConcept = 'ARRIENDO_GYM';
            else if (cLow.includes('debe')) categoryConcept = 'DEBE';
            else if (cLow.includes('otro') || cLow.includes('varios')) categoryConcept = 'OTROS';

            // Match por RUT
            const matchedAthletes = rut ? (rutLookup.get(rut) || []) : [];
            let athleteId = null;
            let status = 'PENDIENTE';
            let movementNotes = mov.concept || '';

            // Regla estricta del club: Solo montos exactos de arancel (35.000, 36.000 o 50.000) son auto-mensualidad
            const isStrictFeeAmount = (amt === 35000 || amt === 36000 || amt === 50000);

            if (matchedAthletes.length === 1) {
                const ath = matchedAthletes[0];
                athleteId = ath.athlete_id;
                status = 'CONCILIADO';
                matchedCount++;

                const fee = parseFloat(ath.monthly_fee) || 0;
                if (categoryConcept === 'POR_DEFINIR' && isStrictFeeAmount && Math.abs(amt - fee) < 1) {
                    categoryConcept = 'MENSUALIDAD';
                }
            } else if (matchedAthletes.length > 1) {
                const exactMatch = matchedAthletes.find(a => isStrictFeeAmount && Math.abs(parseFloat(a.monthly_fee) - amt) < 1);
                if (exactMatch) {
                    athleteId = exactMatch.athlete_id;
                    status = 'CONCILIADO';
                    matchedCount++;
                    if (categoryConcept === 'POR_DEFINIR') {
                        categoryConcept = 'MENSUALIDAD';
                    }
                    const noteAdd = `Mensualidad de ${exactMatch.first_name} ${exactMatch.last_name} (${exactMatch.category})`;
                    movementNotes = movementNotes ? `${movementNotes} | ${noteAdd}` : noteAdd;
                } else {
                    athleteId = matchedAthletes[0].athlete_id;
                    status = 'CONCILIADO';
                    matchedCount++;
                    const kidsNames = matchedAthletes.map(k => `${k.first_name} (${k.category} $${k.monthly_fee})`).join(' y ');
                    movementNotes = movementNotes ? `${movementNotes} | Apoderado de: ${kidsNames}. Usa "Dividir Pago" si es pago conjunto.` : `Apoderado de: ${kidsNames}. Usa "Dividir Pago" si es pago conjunto.`;
                }
            } else {
                // Si no hubo match por RUT, intentar match por nombre ULTRA ESTRICTO (solo coincidencias exactas de apellido + nombre)
                const STOPWORDS = new Set(['de', 'del', 'la', 'las', 'los', 'san', 'santa', 'y', 'e', 'spa', 'ltda', 'sa', 'eirl']);
                if (mov.payer_name && mov.payer_name.length > 5) {
                    const normPayer = cleanStr(mov.payer_name);
                    const payerTokens = normPayer.split(/\s+/).filter(w => w.length >= 4 && !STOPWORDS.has(w));
                    
                    if (payerTokens.length >= 2) {
                        const nameMatches = allAthletes.filter(a => {
                            const athFirstTokens = cleanStr(a.first_name).split(/\s+/).filter(w => w.length >= 4 && !STOPWORDS.has(w));
                            const athLastTokens = cleanStr(a.last_name).split(/\s+/).filter(w => w.length >= 4 && !STOPWORDS.has(w));
                            
                            // EXIGENCIA 1: Debe coincidir obligatoriamente al menos un apellido completo (exact word match)
                            const surnameMatch = athLastTokens.some(alt => payerTokens.includes(alt));
                            if (!surnameMatch) return false;

                            // EXIGENCIA 2: Debe coincidir al menos un nombre o segundo apellido completo (exact word match)
                            const firstNameOrSecondSurnameMatch = athFirstTokens.some(aft => payerTokens.includes(aft)) || 
                                (athLastTokens.filter(alt => payerTokens.includes(alt)).length >= 2);
                            
                            return firstNameOrSecondSurnameMatch;
                        });

                        if (nameMatches.length === 1) {
                            const ath = nameMatches[0];
                            athleteId = ath.id;
                            status = 'CONCILIADO';
                            matchedCount++;
                            const fee = parseFloat(ath.monthly_fee) || 0;
                            if (categoryConcept === 'POR_DEFINIR' && isStrictFeeAmount && Math.abs(amt - fee) < 1) {
                                categoryConcept = 'MENSUALIDAD';
                            }
                            movementNotes = movementNotes ? `${movementNotes} | Asignado automáticamente por coincidencia estricta de nombre: ${ath.first_name} ${ath.last_name}` : `Asignado automáticamente por coincidencia estricta de nombre: ${ath.first_name} ${ath.last_name}`;
                        } else {
                            pendingCount++;
                        }
                    } else {
                        pendingCount++;
                    }
                } else {
                    pendingCount++;
                }
            }

            // Guardar para inserción por lotes
            newRecordsToInsert.push({
                date: parsedDate,
                transfer_type: mov.transfer_type || 'TRANSFERENCIA',
                account_dest: mov.account_dest || '',
                payer_rut: rut,
                payer_name: (mov.payer_name || '').trim(),
                bank_origin: mov.bank_origin || '',
                account_origin: doc,
                amount: amt,
                athlete_id: athleteId,
                period: currentPeriod,
                category_concept: categoryConcept,
                status: status,
                notes: movementNotes
            });

            // Registrar en memoria para que no duplique registros del mismo lote
            existingMovements.push({
                date_str: parsedDate,
                amount: amt,
                payer_rut: rut,
                payer_name: payerNameClean,
                account_origin: doc,
                notes_lower: (movementNotes || '').toLowerCase()
            });

            totalProcessed++;
        }

        // Inserción por lotes (Batch Insert ultra rápido)
        const CHUNK_SIZE = 50;
        for (let i = 0; i < newRecordsToInsert.length; i += CHUNK_SIZE) {
            const chunk = newRecordsToInsert.slice(i, i + CHUNK_SIZE);
            const valuePlaceholders = [];
            const queryParams = [];
            let pIdx = 1;

            for (const rec of chunk) {
                valuePlaceholders.push(`($${pIdx}, $${pIdx+1}, $${pIdx+2}, $${pIdx+3}, $${pIdx+4}, $${pIdx+5}, $${pIdx+6}, $${pIdx+7}, $${pIdx+8}, $${pIdx+9}, $${pIdx+10}, $${pIdx+11}, $${pIdx+12})`);
                queryParams.push(
                    rec.date, rec.transfer_type, rec.account_dest, rec.payer_rut, rec.payer_name,
                    rec.bank_origin, rec.account_origin, rec.amount, rec.athlete_id, rec.period,
                    rec.category_concept, rec.status, rec.notes
                );
                pIdx += 13;
            }

            await pool.query(
                `INSERT INTO bank_movements 
                 (date, transfer_type, account_dest, payer_rut, payer_name, bank_origin, account_origin, amount, athlete_id, period, category_concept, status, notes)
                 VALUES ${valuePlaceholders.join(', ')}`,
                queryParams
            );
        }

        res.json({
            message: 'Movimientos procesados con éxito',
            period: currentPeriod,
            total_leidos: movements.length,
            insertados: totalProcessed,
            conciliados_automaticamente: matchedCount,
            pendientes_por_asignar: pendingCount,
            duplicados_omitidos: duplicateCount
        });
    } catch (err) {
        console.error('Error al procesar cartola:', err);
        res.status(500).json({ error: 'Error al procesar cartola', details: err.message });
    }
};

// 8. Obtener movimientos bancarios (con filtros: pendientes, conciliados, por período)
exports.getMovements = async (req, res) => {
    try {
        const { period, status, athlete_id } = req.query;
        let query = `
            SELECT 
                m.id,
                TO_CHAR(m.date, 'YYYY-MM-DD') as date,
                m.transfer_type,
                m.payer_rut,
                m.payer_name,
                m.bank_origin,
                m.account_origin,
                m.amount,
                m.athlete_id,
                m.period,
                m.category_concept,
                m.status,
                m.notes,
                a.first_name,
                a.last_name,
                (a.first_name || ' ' || a.last_name) as athlete_name,
                a.category as athlete_category
            FROM bank_movements m
            LEFT JOIN athletes a ON m.athlete_id = a.id
            WHERE 1=1
        `;
        const params = [];
        let pIdx = 1;

        if (req.query.id) {
            query += ` AND m.id = $${pIdx++}`;
            params.push(req.query.id);
        }
        if (period) {
            query += ` AND m.period = $${pIdx++}`;
            params.push(period);
        }
        if (status) {
            query += ` AND m.status = $${pIdx++}`;
            params.push(status);
        }
        if (athlete_id) {
            query += ` AND m.athlete_id = $${pIdx++}`;
            params.push(athlete_id);
        }
        if (req.query.concept && req.query.concept !== 'TODOS') {
            query += ` AND m.category_concept = $${pIdx++}`;
            params.push(req.query.concept);
        }
        if (req.query.only_extras === 'true') {
            query += ` AND m.category_concept != 'MENSUALIDAD'`;
        }

        query += ` ORDER BY m.date DESC, m.id DESC`;

        const result = await pool.query(query, params);
        const movements = result.rows.map(m => ({
            ...m,
            formatted_rut: formatRut(m.payer_rut)
        }));

        res.json(movements);
    } catch (err) {
        console.error('Error al obtener movimientos:', err);
        res.status(500).json({ error: 'Error al obtener movimientos', details: err.message });
    }
};

// 9. Asignar movimiento pendiente a un deportista (y opcionalmente aprender el RUT)
exports.assignMovement = async (req, res) => {
    try {
        const { movement_id, athlete_id, remember_rut, period, concept, notes } = req.body;

        // Obtener el movimiento
        const movRes = await pool.query('SELECT * FROM bank_movements WHERE id = $1', [movement_id]);
        if (movRes.rows.length === 0) {
            return res.status(404).json({ error: 'Movimiento no encontrado' });
        }
        const mov = movRes.rows[0];

        const athId = athlete_id ? parseInt(athlete_id, 10) : null;
        const newConcept = concept || mov.category_concept || 'POR_DEFINIR';
        const newNotes = notes !== undefined ? notes : mov.notes;

        // Actualizar movimiento
        const updated = await pool.query(
            `UPDATE bank_movements 
             SET athlete_id = $1, status = 'CONCILIADO', 
                 period = COALESCE($2, period),
                 category_concept = $3,
                 notes = $4
             WHERE id = $5 RETURNING *`,
            [athId, period || mov.period, newConcept, newNotes, movement_id]
        );

        // Si se pide recordar el RUT y hay alumno vinculado
        if (remember_rut && athId && mov.payer_rut) {
            await pool.query(
                `INSERT INTO athlete_payer_ruts (athlete_id, payer_rut, payer_name, relationship)
                 VALUES ($1, $2, $3, $4)
                 ON CONFLICT (athlete_id, payer_rut) DO NOTHING`,
                [athId, mov.payer_rut, mov.payer_name || 'Apoderado', 'Apoderado']
            );
        }

        res.json({
            message: 'Movimiento asignado exitosamente',
            movement: updated.rows[0]
        });
    } catch (err) {
        console.error('Error al asignar movimiento:', err);
        res.status(500).json({ error: 'Error al asignar', details: err.message });
    }
};

// 10. Resumen financiero mensual (KPIs)
exports.getSummary = async (req, res) => {
    try {
        const { period } = req.query;
        const currentPeriod = period || 'SEPTIEMBRE-2026';

        // 1. Total deportistas y arancel esperado (excluyendo inactivos y retirados)
        const athletesRes = await pool.query(`
            SELECT 
                COUNT(*) FILTER (WHERE status NOT IN ('INACTIVO', 'RETIRADO')) as total_athletes,
                COUNT(*) FILTER (WHERE (status = 'BECADO' OR fee_type = 'BECADO') AND status NOT IN ('INACTIVO', 'RETIRADO')) as total_becados,
                COUNT(*) FILTER (WHERE status = 'ACTIVO' AND fee_type != 'BECADO') as total_activos_cobro,
                COALESCE(SUM(monthly_fee) FILTER (WHERE status = 'ACTIVO' AND fee_type != 'BECADO'), 0) as total_esperado,
                COUNT(*) FILTER (WHERE status IN ('INACTIVO', 'RETIRADO')) as total_inactivos
            FROM athletes
        `);

        // 2. Total recaudado por mensualidades
        const mensualidadesRes = await pool.query(`
            SELECT 
                COALESCE(SUM(amount), 0) as total_mensualidades,
                COUNT(DISTINCT athlete_id) as total_alumnos_pagaron,
                COUNT(*) as count_mensualidades
            FROM bank_movements
            WHERE period = $1 AND status = 'CONCILIADO' AND category_concept = 'MENSUALIDAD'
        `, [currentPeriod]);

        // 3. Total recaudado por pagos extras y otros ingresos
        const extrasRes = await pool.query(`
            SELECT 
                COALESCE(SUM(amount), 0) as total_extras,
                COUNT(*) as count_extras
            FROM bank_movements
            WHERE period = $1 AND status = 'CONCILIADO' AND category_concept != 'MENSUALIDAD' AND category_concept != 'ANULADO'
        `, [currentPeriod]);

        // 4. Desglose detallado de pagos extras por concepto
        const extrasDesgloseRes = await pool.query(`
            SELECT 
                category_concept,
                COUNT(*) as count,
                COALESCE(SUM(amount), 0) as total
            FROM bank_movements
            WHERE period = $1 AND status = 'CONCILIADO' AND category_concept != 'MENSUALIDAD' AND category_concept != 'ANULADO'
            GROUP BY category_concept
            ORDER BY total DESC
        `, [currentPeriod]);

        // 5. Total movimientos pendientes de asignar
        const pendingRes = await pool.query(`
            SELECT 
                COUNT(*) as count_pendientes,
                COALESCE(SUM(amount), 0) as total_monto_pendiente
            FROM bank_movements
            WHERE period = $1 AND status = 'PENDIENTE'
        `, [currentPeriod]);

        // 6. Desglose por categoría (solo alumnos activos, sin producto cartesiano)
        const categoryRes = await pool.query(`
            WITH ath_movs AS (
                SELECT 
                    athlete_id,
                    COALESCE(SUM(amount) FILTER (WHERE category_concept = 'MENSUALIDAD'), 0) as rec_mensualidad,
                    COALESCE(SUM(amount) FILTER (WHERE category_concept != 'MENSUALIDAD' AND category_concept != 'ANULADO'), 0) as rec_extras,
                    COALESCE(SUM(amount) FILTER (WHERE category_concept != 'ANULADO'), 0) as rec_total
                FROM bank_movements
                WHERE period = $1 AND status = 'CONCILIADO'
                GROUP BY athlete_id
            )
            SELECT 
                a.category,
                COUNT(a.id) as total_alumnos,
                COALESCE(SUM(a.monthly_fee) FILTER (WHERE a.fee_type != 'BECADO' AND a.fee_type != 'BECA_COMPLETA'), 0) as esperado,
                COALESCE(SUM(m.rec_mensualidad), 0) as recaudado_mensualidad,
                COALESCE(SUM(m.rec_extras), 0) as recaudado_extras,
                COALESCE(SUM(m.rec_total), 0) as recaudado_total,
                COALESCE(SUM(m.rec_total), 0) as recaudado
            FROM athletes a
            LEFT JOIN ath_movs m ON a.id = m.athlete_id
            WHERE a.status NOT IN ('INACTIVO', 'RETIRADO')
            GROUP BY a.category
            ORDER BY a.category ASC
        `, [currentPeriod]);

        // 7. Desglose por agrupación (Equipos Bayes - solo alumnos activos, sin producto cartesiano)
        const agrupacionesRes = await pool.query(`
            WITH ath_movs AS (
                SELECT 
                    athlete_id,
                    COALESCE(SUM(amount) FILTER (WHERE category_concept = 'MENSUALIDAD'), 0) as rec_mensualidad,
                    COALESCE(SUM(amount) FILTER (WHERE category_concept != 'MENSUALIDAD' AND category_concept != 'ANULADO'), 0) as rec_extras,
                    COALESCE(SUM(amount) FILTER (WHERE category_concept != 'ANULADO'), 0) as rec_total
                FROM bank_movements
                WHERE period = $1 AND status = 'CONCILIADO'
                GROUP BY athlete_id
            )
            SELECT 
                COALESCE(NULLIF(a.agrupacion, ''), 'Sin Agrupación') as agrupacion,
                COUNT(a.id) as total_alumnos,
                COALESCE(SUM(a.monthly_fee) FILTER (WHERE a.fee_type != 'BECADO' AND a.fee_type != 'BECA_COMPLETA'), 0) as esperado,
                COALESCE(SUM(m.rec_mensualidad), 0) as recaudado_mensualidad,
                COALESCE(SUM(m.rec_extras), 0) as recaudado_extras,
                COALESCE(SUM(m.rec_total), 0) as recaudado_total,
                COALESCE(SUM(m.rec_total), 0) as recaudado
            FROM athletes a
            LEFT JOIN ath_movs m ON a.id = m.athlete_id
            WHERE a.status NOT IN ('INACTIVO', 'RETIRADO')
            GROUP BY COALESCE(NULLIF(a.agrupacion, ''), 'Sin Agrupación')
            ORDER BY agrupacion ASC
        `, [currentPeriod]);

        // 8. Resumen de Egresos y Gastos del período
        const egresosRes = await pool.query(`
            SELECT 
                COALESCE(SUM(amount), 0) as total_egresos,
                COUNT(*) as count_egresos
            FROM club_expenses
            WHERE period = $1
        `, [currentPeriod]);

        const egresosDesgloseRes = await pool.query(`
            SELECT 
                category,
                COUNT(*) as count,
                COALESCE(SUM(amount), 0) as total
            FROM club_expenses
            WHERE period = $1
            GROUP BY category
            ORDER BY total DESC
        `, [currentPeriod]);

        const totalMens = parseFloat(mensualidadesRes.rows[0].total_mensualidades) || 0;
        const totalExt = parseFloat(extrasRes.rows[0].total_extras) || 0;
        const totalRecaudado = totalMens + totalExt;
        const totalEgresos = parseFloat(egresosRes.rows[0].total_egresos) || 0;
        const countEgresos = parseInt(egresosRes.rows[0].count_egresos, 10) || 0;

        res.json({
            period: currentPeriod,
            esperado: parseFloat(athletesRes.rows[0].total_esperado),
            total_mensualidades: totalMens,
            total_extras: totalExt,
            recaudado: totalRecaudado,
            total_egresos: totalEgresos,
            count_egresos: countEgresos,
            saldo_neto: totalRecaudado - totalEgresos,
            alumnos_pagaron: parseInt(mensualidadesRes.rows[0].total_alumnos_pagaron, 10),
            total_activos: parseInt(athletesRes.rows[0].total_activos_cobro, 10),
            total_becados: parseInt(athletesRes.rows[0].total_becados, 10),
            total_inactivos: parseInt(athletesRes.rows[0].total_inactivos, 10),
            pendientes_asignar: {
                cantidad: parseInt(pendingRes.rows[0].count_pendientes, 10),
                monto: parseFloat(pendingRes.rows[0].total_monto_pendiente)
            },
            desglose_extras: extrasDesgloseRes.rows,
            desglose_egresos: egresosDesgloseRes.rows,
            categorias: categoryRes.rows,
            agrupaciones: agrupacionesRes.rows
        });
    } catch (err) {
        console.error('Error al generar resumen financiero:', err);
        res.status(500).json({ error: 'Error al generar resumen', details: err.message });
    }
};

// 11. Registrar pago manual (efectivo, transferencia directa, ajuste)
exports.registerManualPayment = async (req, res) => {
    try {
        const { athlete_id, amount, period, concept, date, notes, method } = req.body;
        const cleanAmt = cleanAmount(amount);

        if (!athlete_id || cleanAmt <= 0) {
            return res.status(400).json({ error: 'Datos de pago inválidos' });
        }

        const athleteRes = await pool.query('SELECT first_name, last_name FROM athletes WHERE id = $1', [athlete_id]);
        if (athleteRes.rows.length === 0) {
            return res.status(404).json({ error: 'Deportista no encontrado' });
        }
        const ath = athleteRes.rows[0];

        const today = new Date().toISOString().split('T')[0];
        const payDate = date || today;
        const payConcept = concept || 'MENSUALIDAD';
        const payPeriod = period || 'SEPTIEMBRE-2026';
        const payMethod = method || 'EFECTIVO';

        const result = await pool.query(
            `INSERT INTO bank_movements 
             (date, transfer_type, account_dest, payer_rut, payer_name, bank_origin, account_origin, amount, athlete_id, period, category_concept, status, notes)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) RETURNING *`,
            [
                payDate, payMethod, 'CAJA_CLUB', 'MANUAL', `${ath.first_name} ${ath.last_name} (${payMethod})`,
                'PAGO MANUAL', '', cleanAmt, athlete_id, payPeriod,
                payConcept, 'CONCILIADO', notes || `Pago manual registrado en ${payMethod}`
            ]
        );

        res.status(201).json({
            message: 'Pago manual registrado con éxito',
            payment: result.rows[0]
        });
    } catch (err) {
        console.error('Error al registrar pago manual:', err);
        res.status(500).json({ error: 'Error al registrar pago manual', details: err.message });
    }
};

// 12. Actualizar movimiento bancario (concepto, alumno asignado, notas)
exports.updateMovement = async (req, res) => {
    try {
        const { id } = req.params;
        const { category_concept, athlete_id, notes, amount, period } = req.body;

        const updateFields = [];
        const params = [];
        let pIdx = 1;

        if (category_concept !== undefined) {
            updateFields.push(`category_concept = $${pIdx++}`);
            params.push(category_concept);
        }
        if (athlete_id !== undefined) {
            const athId = athlete_id ? parseInt(athlete_id, 10) : null;
            updateFields.push(`athlete_id = $${pIdx++}`);
            params.push(athId);
            if (athId) {
                updateFields.push(`status = 'CONCILIADO'`);
            }
        }
        if (notes !== undefined) {
            updateFields.push(`notes = $${pIdx++}`);
            params.push(notes);
        }
        if (amount !== undefined) {
            updateFields.push(`amount = $${pIdx++}`);
            params.push(cleanAmount(amount));
        }
        if (period !== undefined) {
            updateFields.push(`period = $${pIdx++}`);
            params.push(period);
        }

        if (updateFields.length === 0) {
            return res.status(400).json({ error: 'No se enviaron campos para actualizar' });
        }

        params.push(id);
        const query = `UPDATE bank_movements SET ${updateFields.join(', ')} WHERE id = $${pIdx} RETURNING *`;
        const result = await pool.query(query, params);

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Movimiento no encontrado' });
        }

        res.json({
            message: 'Movimiento actualizado correctamente',
            movement: result.rows[0]
        });
    } catch (err) {
        console.error('Error al actualizar movimiento:', err);
        res.status(500).json({ error: 'Error al actualizar movimiento', details: err.message });
    }
};

// 13. Dividir / Desglosar un movimiento bancario (ej. un pago de $100.000 para 2 hijos)
exports.splitMovement = async (req, res) => {
    try {
        const { movement_id, splits } = req.body;

        if (!movement_id || !Array.isArray(splits) || splits.length < 2) {
            return res.status(400).json({ error: 'Debes proporcionar al menos 2 partes para dividir el pago' });
        }

        const origRes = await pool.query('SELECT * FROM bank_movements WHERE id = $1', [movement_id]);
        if (origRes.rows.length === 0) {
            return res.status(404).json({ error: 'Movimiento original no encontrado' });
        }
        const orig = origRes.rows[0];
        const origAmount = parseFloat(orig.amount);

        const totalSplitAmount = splits.reduce((sum, s) => sum + cleanAmount(s.amount), 0);
        if (Math.abs(totalSplitAmount - origAmount) > 1) {
            return res.status(400).json({ 
                error: `La suma de las partes ($${totalSplitAmount}) debe coincidir con el monto original ($${origAmount})` 
            });
        }

        const createdSplits = [];
        for (const s of splits) {
            const insRes = await pool.query(
                `INSERT INTO bank_movements 
                 (date, transfer_type, account_dest, payer_rut, payer_name, bank_origin, account_origin, amount, athlete_id, period, category_concept, status, notes)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) RETURNING *`,
                [
                    orig.date, orig.transfer_type, orig.account_dest, orig.payer_rut, orig.payer_name,
                    orig.bank_origin, orig.account_origin, cleanAmount(s.amount),
                    s.athlete_id ? parseInt(s.athlete_id, 10) : null,
                    s.period || orig.period,
                    s.concept || 'MENSUALIDAD',
                    s.athlete_id ? 'CONCILIADO' : 'PENDIENTE',
                    s.notes || `Desglose de movimiento #${orig.id}`
                ]
            );
            createdSplits.push(insRes.rows[0]);
        }

        // Eliminar el movimiento original para no duplicar el total
        await pool.query('DELETE FROM bank_movements WHERE id = $1', [movement_id]);

        res.json({
            message: 'Pago desglosado con éxito en varias partes',
            splits: createdSplits
        });
    } catch (err) {
        console.error('Error al dividir pago:', err);
        res.status(500).json({ error: 'Error al dividir pago', details: err.message });
    }
};

// 11. Registrar pago manual (efectivo, transferencia directa, ajuste)
exports.registerManualPayment = async (req, res) => {
    try {
        const { athlete_id, amount, period, concept, date, notes, method } = req.body;
        const cleanAmt = cleanAmount(amount);

        if (!athlete_id || cleanAmt <= 0) {
            return res.status(400).json({ error: 'Datos de pago inválidos' });
        }

        const athleteRes = await pool.query('SELECT first_name, last_name FROM athletes WHERE id = $1', [athlete_id]);
        if (athleteRes.rows.length === 0) {
            return res.status(404).json({ error: 'Deportista no encontrado' });
        }
        const ath = athleteRes.rows[0];

        const today = new Date().toISOString().split('T')[0];
        const payDate = date || today;
        const payConcept = concept || 'MENSUALIDAD';
        const payPeriod = period || 'SEPTIEMBRE-2026';
        const payMethod = method || 'EFECTIVO';

        const result = await pool.query(
            `INSERT INTO bank_movements 
             (date, transfer_type, account_dest, payer_rut, payer_name, bank_origin, account_origin, amount, athlete_id, period, category_concept, status, notes)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) RETURNING *`,
            [
                payDate, payMethod, 'CAJA_CLUB', 'MANUAL', `${ath.first_name} ${ath.last_name} (${payMethod})`,
                'PAGO MANUAL', '', cleanAmt, athlete_id, payPeriod,
                payConcept, 'CONCILIADO', notes || `Pago manual registrado en ${payMethod}`
            ]
        );

        res.status(201).json({
            message: 'Pago manual registrado con éxito',
            payment: result.rows[0]
        });
    } catch (err) {
        console.error('Error al registrar pago manual:', err);
        res.status(500).json({ error: 'Error al registrar pago manual', details: err.message });
    }
};

// 12. Exportar respaldo completo de un mes para guardarlo en disco
exports.exportMonthlyArchive = async (req, res) => {
    try {
        const { period } = req.query;
        if (!period) return res.status(400).json({ error: 'Debes indicar el período a exportar' });

        // Movimientos del período
        const movsRes = await pool.query(`
            SELECT 
                m.id, 
                TO_CHAR(m.date, 'YYYY-MM-DD') as date, 
                m.transfer_type, 
                m.payer_rut, 
                m.payer_name, 
                m.bank_origin, 
                m.account_origin, 
                m.amount, 
                m.athlete_id, 
                m.period, 
                m.category_concept, 
                m.status, 
                m.notes,
                (a.first_name || ' ' || a.last_name) as athlete_name,
                a.category as athlete_category
            FROM bank_movements m
            LEFT JOIN athletes a ON m.athlete_id = a.id
            WHERE m.period = $1
            ORDER BY m.date ASC, m.id ASC
        `, [period]);

        // Resumen de deportistas para este período
        const athRes = await pool.query(`
            SELECT 
                a.id,
                a.first_name,
                a.last_name,
                (a.first_name || ' ' || a.last_name) as full_name,
                a.category,
                a.fee_type,
                a.monthly_fee,
                a.status,
                COALESCE(SUM(m.amount) FILTER (WHERE m.category_concept = 'MENSUALIDAD'), 0) as mensualidad_pagada,
                COALESCE(SUM(m.amount) FILTER (WHERE m.category_concept != 'MENSUALIDAD'), 0) as extras_pagados
            FROM athletes a
            LEFT JOIN bank_movements m ON a.id = m.athlete_id AND m.period = $1 AND m.status = 'CONCILIADO'
            GROUP BY a.id
            ORDER BY a.category ASC, a.last_name ASC
        `, [period]);

        const athletesPayroll = athRes.rows.map(row => {
            const fee = parseFloat(row.monthly_fee) || 0;
            const paid = parseFloat(row.mensualidad_pagada) || 0;
            let status = 'PENDIENTE';
            if (row.status === 'BECADO' || row.fee_type === 'BECADO' || fee === 0) status = 'BECADO';
            else if (paid >= fee) status = 'PAGADO';
            else if (paid > 0) status = 'PARCIAL';

            return {
                ...row,
                debt: Math.max(0, fee - paid),
                payment_status: status
            };
        });

        const archiveData = {
            app: 'Murano Voley - Sistema de Finanzas',
            period: period,
            exported_at: new Date().toISOString(),
            total_movements: movsRes.rows.length,
            total_athletes: athletesPayroll.length,
            movements: movsRes.rows,
            athletes_payroll: athletesPayroll
        };

        res.json(archiveData);
    } catch (err) {
        console.error('Error al exportar respaldo mensual:', err);
        res.status(500).json({ error: 'Error al exportar respaldo', details: err.message });
    }
};

// 13. Purgar / Archivar mes de la BD para liberar espacio
exports.purgeMonthlyMovements = async (req, res) => {
    try {
        const { period, confirmation } = req.body;
        if (!period) return res.status(400).json({ error: 'Debes indicar el período a archivar' });
        if (confirmation !== 'ARCHIVAR') {
            return res.status(400).json({ error: 'Debes escribir ARCHIVAR para confirmar la liberación de espacio' });
        }

        const deleteRes = await pool.query('DELETE FROM bank_movements WHERE period = $1', [period]);

        res.json({
            message: `Período ${period} archivado exitosamente. Se eliminaron ${deleteRes.rowCount} movimientos de la base de datos activa para optimizar espacio.`,
            deleted_count: deleteRes.rowCount,
            period: period
        });
    } catch (err) {
        console.error('Error al archivar mes:', err);
        res.status(500).json({ error: 'Error al archivar mes', details: err.message });
    }
};

// 14. Restaurar respaldo de un mes previamente guardado en disco
exports.restoreMonthlyArchive = async (req, res) => {
    try {
        const { period, movements } = req.body;
        if (!Array.isArray(movements) || movements.length === 0) {
            return res.status(400).json({ error: 'El archivo de respaldo no contiene movimientos válidos' });
        }

        const targetPeriod = period || (movements[0] && movements[0].period) || 'RESTAURADO';

        // Evitar duplicados contra lo que haya actualmente
        const existing = await pool.query('SELECT date, amount, payer_rut, period, account_origin FROM bank_movements WHERE period = $1', [targetPeriod]);
        const existSet = new Set(existing.rows.map(r => `${r.date}_${r.amount}_${r.payer_rut}_${r.account_origin || ''}`));

        const toInsert = [];
        for (const m of movements) {
            const dateStr = m.date;
            const amt = Math.round(cleanAmount(m.amount));
            const rut = cleanRut(m.payer_rut);
            const doc = (m.account_origin || '').trim();
            const key = `${dateStr}_${amt}_${rut}_${doc}`;

            if (existSet.has(key)) continue;
            existSet.add(key);

            toInsert.push({
                date: dateStr,
                transfer_type: m.transfer_type || 'TRANSFERENCIA',
                account_dest: m.account_dest || '',
                payer_rut: rut,
                payer_name: (m.payer_name || '').trim(),
                bank_origin: m.bank_origin || '',
                account_origin: doc,
                amount: amt,
                athlete_id: m.athlete_id || null,
                period: targetPeriod,
                category_concept: m.category_concept || 'POR_DEFINIR',
                status: m.status || 'CONCILIADO',
                notes: m.notes || ''
            });
        }

        // Batch insert
        const CHUNK_SIZE = 50;
        for (let i = 0; i < toInsert.length; i += CHUNK_SIZE) {
            const chunk = toInsert.slice(i, i + CHUNK_SIZE);
            const valuePlaceholders = [];
            const queryParams = [];
            let pIdx = 1;

            for (const rec of chunk) {
                valuePlaceholders.push(`($${pIdx}, $${pIdx+1}, $${pIdx+2}, $${pIdx+3}, $${pIdx+4}, $${pIdx+5}, $${pIdx+6}, $${pIdx+7}, $${pIdx+8}, $${pIdx+9}, $${pIdx+10}, $${pIdx+11}, $${pIdx+12})`);
                queryParams.push(
                    rec.date, rec.transfer_type, rec.account_dest, rec.payer_rut, rec.payer_name,
                    rec.bank_origin, rec.account_origin, rec.amount, rec.athlete_id, rec.period,
                    rec.category_concept, rec.status, rec.notes
                );
                pIdx += 13;
            }

            await pool.query(
                `INSERT INTO bank_movements 
                 (date, transfer_type, account_dest, payer_rut, payer_name, bank_origin, account_origin, amount, athlete_id, period, category_concept, status, notes)
                 VALUES ${valuePlaceholders.join(', ')}`,
                queryParams
            );
        }

        res.json({
            message: `Respaldo restaurado con éxito. Se insertaron ${toInsert.length} movimientos en el período ${targetPeriod}.`,
            restored_count: toInsert.length,
            period: targetPeriod
        });
    } catch (err) {
        console.error('Error al restaurar respaldo:', err);
        res.status(500).json({ error: 'Error al restaurar respaldo', details: err.message });
    }
};

// 15. Estadísticas de almacenamiento y salud de la base de datos
exports.getArchiveStats = async (req, res) => {
    try {
        const periodsRes = await pool.query(`
            SELECT 
                period, 
                COUNT(*) as total_movements, 
                COALESCE(SUM(amount), 0) as total_amount,
                COUNT(*) FILTER (WHERE status = 'CONCILIADO') as conciliados,
                COUNT(*) FILTER (WHERE status = 'PENDIENTE') as pendientes,
                MIN(date) as oldest_date,
                MAX(date) as newest_date
            FROM bank_movements
            GROUP BY period
            ORDER BY period DESC
        `);

        const totalMovements = await pool.query('SELECT COUNT(*) as count FROM bank_movements');
        const totalAthletes = await pool.query('SELECT COUNT(*) as count FROM athletes');

        res.json({
            total_records: parseInt(totalMovements.rows[0].count, 10),
            total_athletes: parseInt(totalAthletes.rows[0].count, 10),
            periods: periodsRes.rows,
            health_status: 'OPTIMAL',
            storage_engine: 'PostgreSQL Supabase (Cloud)'
        });
    } catch (err) {
        console.error('Error al obtener estadísticas de archivo:', err);
        res.status(500).json({ error: 'Error al obtener estadísticas', details: err.message });
    }
};

// ── GESTIÓN DE EGRESOS Y GASTOS OPERATIVOS DEL CLUB ──

exports.getExpenses = async (req, res) => {
    try {
        const { period, category, search } = req.query;
        const currentPeriod = period || 'SEPTIEMBRE-2026';
        let query = `SELECT id, TO_CHAR(date, 'YYYY-MM-DD') as date, period, category, beneficiary, amount, payment_method, receipt_number, notes, created_at FROM club_expenses WHERE 1=1`;
        const params = [];
        let pIdx = 1;

        if (currentPeriod && currentPeriod !== 'TODOS') {
            query += ` AND period = $${pIdx++}`;
            params.push(currentPeriod);
        }
        if (category && category !== 'TODOS') {
            query += ` AND category = $${pIdx++}`;
            params.push(category);
        }
        if (search) {
            query += ` AND (LOWER(beneficiary) LIKE $${pIdx} OR LOWER(COALESCE(receipt_number, '')) LIKE $${pIdx} OR LOWER(COALESCE(notes, '')) LIKE $${pIdx})`;
            params.push(`%${search.toLowerCase().trim()}%`);
            pIdx++;
        }
        query += ` ORDER BY date DESC, id DESC`;

        const result = await pool.query(query, params);
        const totalAmount = result.rows.reduce((sum, r) => sum + parseFloat(r.amount), 0);

        res.json({
            period: currentPeriod,
            total_egresos: totalAmount,
            count: result.rows.length,
            expenses: result.rows
        });
    } catch (err) {
        console.error('Error al consultar egresos:', err);
        res.status(500).json({ error: 'Error al consultar egresos', details: err.message });
    }
};

exports.createExpense = async (req, res) => {
    try {
        const { date, period, category, beneficiary, amount, payment_method, receipt_number, notes } = req.body;
        const cleanAmt = cleanAmount(amount);
        if (!beneficiary || cleanAmt <= 0) {
            return res.status(400).json({ error: 'Beneficiario y monto válido son requeridos' });
        }
        const result = await pool.query(
            `INSERT INTO club_expenses (date, period, category, beneficiary, amount, payment_method, receipt_number, notes)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id, TO_CHAR(date, 'YYYY-MM-DD') as date, period, category, beneficiary, amount, payment_method, receipt_number, notes`,
            [date || new Date(), period || 'SEPTIEMBRE-2026', category || 'OTROS', beneficiary.trim(), cleanAmt, payment_method || 'TRANSFERENCIA', receipt_number || '', notes || '']
        );
        res.status(201).json(result.rows[0]);
    } catch (err) {
        console.error('Error al registrar egreso:', err);
        res.status(500).json({ error: 'Error al registrar egreso', details: err.message });
    }
};

exports.updateExpense = async (req, res) => {
    try {
        const { id } = req.params;
        const { date, period, category, beneficiary, amount, payment_method, receipt_number, notes } = req.body;
        const cleanAmt = cleanAmount(amount);
        const result = await pool.query(
            `UPDATE club_expenses 
             SET date = COALESCE($1, date),
                 period = COALESCE($2, period),
                 category = COALESCE($3, category),
                 beneficiary = COALESCE($4, beneficiary),
                 amount = COALESCE($5, amount),
                 payment_method = COALESCE($6, payment_method),
                 receipt_number = COALESCE($7, receipt_number),
                 notes = COALESCE($8, notes)
             WHERE id = $9 RETURNING id, TO_CHAR(date, 'YYYY-MM-DD') as date, period, category, beneficiary, amount, payment_method, receipt_number, notes`,
            [date || null, period || null, category || null, beneficiary ? beneficiary.trim() : null, cleanAmt > 0 ? cleanAmt : null, payment_method || null, receipt_number !== undefined ? receipt_number : null, notes !== undefined ? notes : null, id]
        );
        if (result.rows.length === 0) return res.status(404).json({ error: 'Egreso no encontrado' });
        res.json(result.rows[0]);
    } catch (err) {
        console.error('Error al actualizar egreso:', err);
        res.status(500).json({ error: 'Error al actualizar egreso', details: err.message });
    }
};

exports.deleteExpense = async (req, res) => {
    try {
        const { id } = req.params;
        await pool.query('DELETE FROM club_expenses WHERE id = $1', [id]);
        res.json({ message: 'Egreso eliminado correctamente' });
    } catch (err) {
        console.error('Error al eliminar egreso:', err);
        res.status(500).json({ error: 'Error al eliminar egreso', details: err.message });
    }
};

// ── IMPORTACIÓN Y SINCRONIZACIÓN DE DATOS DE BAYES ──

exports.importBayesData = async (req, res) => {
    try {
        const { items } = req.body; // Array de { name, rut, category, agrupacion, phone }
        if (!Array.isArray(items) || items.length === 0) {
            return res.status(400).json({ error: 'Lista de deportistas vacía o inválida' });
        }

        let updatedCount = 0;
        let notFound = [];

        for (const item of items) {
            const name = (item.name || '').trim();
            const agrup = (item.agrupacion || '').trim();
            const cat = (item.category || '').trim();
            const phone = (item.phone || '').trim();

            if (!name) continue;

            // Buscar por coincidencia exacta o normalizada
            let athRes = await pool.query(
                `SELECT id FROM athletes WHERE LOWER(first_name || ' ' || last_name) = LOWER($1) LIMIT 1`,
                [name]
            );

            if (athRes.rows.length === 0) {
                const parts = name.split(/\s+/).filter(Boolean);
                if (parts.length >= 2) {
                    athRes = await pool.query(
                        `SELECT id FROM athletes WHERE LOWER(first_name) LIKE $1 AND LOWER(last_name) LIKE $2 LIMIT 1`,
                        [`%${parts[0].toLowerCase()}%`, `%${parts[parts.length - 1].toLowerCase()}%`]
                    );
                }
            }

            if (athRes.rows.length > 0) {
                const athId = athRes.rows[0].id;
                await pool.query(
                    `UPDATE athletes 
                     SET agrupacion = COALESCE(NULLIF($1, ''), agrupacion),
                         category = COALESCE(NULLIF($2, ''), category),
                         phone = COALESCE(NULLIF($3, ''), phone)
                     WHERE id = $4`,
                    [agrup, cat, phone, athId]
                );
                updatedCount++;
            } else {
                notFound.push(name);
            }
        }

        res.json({
            message: 'Importación de Bayes procesada con éxito',
            total_recibidos: items.length,
            actualizados: updatedCount,
            no_encontrados: notFound
        });
    } catch (err) {
        console.error('Error al importar datos de Bayes:', err);
        res.status(500).json({ error: 'Error al importar datos de Bayes', details: err.message });
    }
};

// ── ACTUALIZADOR / SINCRONIZADOR DE DEPORTISTAS DESDE EXCEL ──
exports.syncAthletesExcel = async (req, res) => {
    try {
        const { items, preview_only } = req.body;
        if (!Array.isArray(items) || items.length === 0) {
            return res.status(400).json({ error: 'No se enviaron datos de deportistas' });
        }

        // Cargar todos los deportistas existentes en base de datos
        const dbAthletesRes = await pool.query(`
            SELECT id, first_name, last_name, rut, category, agrupacion, fee_type, monthly_fee, 
                   phone, apoderado_phone, join_date, email, status
            FROM athletes
        `);
        const dbAthletes = dbAthletesRes.rows;

        function normalizeName(str) {
            return (str || '').toLowerCase()
                .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
                .replace(/[^a-z0-9\s]/g, '')
                .replace(/\s+/g, ' ')
                .trim();
        }

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

        function cleanAgrupacion(agrup) {
            if (!agrup) return '';
            const parts = agrup.split('/').map(s => s.trim());
            const cleanParts = parts.filter(p => !p.match(/^PF\b/i) && !p.match(/\bPF\b/i) && p.length > 0);
            const unique = Array.from(new Set(cleanParts));
            return unique.join(' / ') || agrup;
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

        const nuevos = [];
        const actualizados = [];
        const sin_cambios = [];

        for (const raw of items) {
            const rawRut = cleanRut(raw.rut || raw['RUT Deportista'] || raw.RUT);
            let fName = (raw.first_name || raw['Ambos nombres deportista'] || raw.nombres || raw.nombre || '').trim();
            let lName = (raw.last_name || raw['Apellidos Deportista'] || raw.apellidos || raw.apellido || '').trim();

            if (!lName && fName) {
                const parts = fName.split(/\s+/);
                if (parts.length >= 3) {
                    fName = parts.slice(0, -2).join(' ');
                    lName = parts.slice(-2).join(' ');
                } else if (parts.length === 2) {
                    fName = parts[0];
                    lName = parts[1];
                }
            }

            const fullNameNorm = normalizeName(fName + ' ' + lName);
            if (!fullNameNorm && !rawRut) continue;

            const depPhone = cleanPhone(raw.phone || raw['Teléfono deportista'] || raw.telefono);
            const papaPhone = cleanPhone(raw['Telefóno apoderado (papá)'] || raw['Telefono Papa']);
            const mamaPhone = cleanPhone(raw['Teléfono Apoderada (Mamá)'] || raw['Telefono Mama']);
            const apodPhone = cleanPhone(raw.apoderado_phone || raw['Telefono Apoderado']) || papaPhone || mamaPhone || null;

            let cat = (raw.category || raw['Categoría a la que ingresa'] || raw.categoria || '').trim();
            let agrup = cleanAgrupacion(raw.agrupacion || raw.agrupacion_equipo || cat);
            if (!cat && agrup) cat = agrup.split('/')[0].trim();
            if (!agrup && cat) agrup = cat;

            let fee = parseFloat(raw.monthly_fee || raw.arancel || raw.cuota);
            let feeType = raw.fee_type || 'REGULAR';
            if (!fee || isNaN(fee)) {
                const lowerCat = (cat + ' ' + agrup).toLowerCase();
                if (lowerCat.includes('mini')) {
                    fee = 36000;
                    feeType = 'MINIVOLEY';
                } else if (lowerCat.includes('tc') || lowerCat.includes('adulta')) {
                    fee = 35000;
                    feeType = 'ADULTO';
                } else if (lowerCat.includes('master')) {
                    fee = 36000;
                    feeType = 'MASTER';
                } else {
                    fee = 50000;
                    feeType = 'REGULAR';
                }
            }

            const email = (raw.email || raw['Correo'] || raw['Email'] || '').trim();
            const joinDate = excelDateToJS(raw.join_date || raw['Fecha de ingreso al club']) || (typeof raw.join_date === 'string' ? raw.join_date : null);

            let matched = null;
            if (rawRut && rawRut.length >= 7) {
                matched = dbAthletes.find(a => cleanRut(a.rut) === rawRut || cleanRut(a.rut).slice(0, 7) === rawRut.slice(0, 7));
            }
            if (!matched && fullNameNorm.length >= 5) {
                matched = dbAthletes.find(a => {
                    const dbNorm = normalizeName((a.first_name || '') + ' ' + (a.last_name || ''));
                    return dbNorm === fullNameNorm || (dbNorm.includes(fullNameNorm) && fullNameNorm.length > 8) || (fullNameNorm.includes(dbNorm) && dbNorm.length > 8);
                });
            }

            if (matched) {
                const changes = {};
                if (apodPhone && matched.apoderado_phone !== apodPhone) changes.apoderado_phone = apodPhone;
                if (depPhone && !matched.phone) changes.phone = depPhone;
                if (email && !matched.email) changes.email = email;
                if (joinDate && !matched.join_date) changes.join_date = joinDate;
                if (agrup && agrup !== matched.agrupacion && !matched.agrupacion) changes.agrupacion = agrup;

                if (Object.keys(changes).length > 0) {
                    actualizados.push({
                        id: matched.id,
                        name: `${matched.first_name} ${matched.last_name}`,
                        rut: matched.rut || rawRut,
                        current: {
                            phone: matched.phone,
                            apoderado_phone: matched.apoderado_phone,
                            agrupacion: matched.agrupacion,
                            join_date: matched.join_date
                        },
                        changes: changes
                    });
                } else {
                    sin_cambios.push({ id: matched.id, name: `${matched.first_name} ${matched.last_name}` });
                }
            } else {
                nuevos.push({
                    first_name: fName,
                    last_name: lName,
                    rut: rawRut,
                    category: cat || 'Sin Categoría',
                    agrupacion: agrup || 'Sin Agrupación',
                    fee_type: feeType,
                    monthly_fee: fee,
                    phone: depPhone || apodPhone || '',
                    apoderado_phone: apodPhone || '',
                    join_date: joinDate || new Date().toISOString().slice(0, 10),
                    email: email || '',
                    status: 'ACTIVO'
                });
            }
        }

        if (preview_only) {
            return res.json({
                preview: true,
                total_procesados: items.length,
                nuevos_count: nuevos.length,
                actualizados_count: actualizados.length,
                sin_cambios_count: sin_cambios.length,
                nuevos: nuevos,
                actualizados: actualizados
            });
        }

        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            let insertadosCount = 0;
            let actualizadosCount = 0;

            for (const n of nuevos) {
                const insRes = await client.query(`
                    INSERT INTO athletes (first_name, last_name, rut, category, agrupacion, fee_type, monthly_fee, phone, apoderado_phone, join_date, email, status)
                    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
                    RETURNING id
                `, [n.first_name, n.last_name, n.rut, n.category, n.agrupacion, n.fee_type, n.monthly_fee, n.phone, n.apoderado_phone, n.join_date, n.email, n.status]);
                
                if (n.rut) {
                    await client.query(`
                        INSERT INTO athlete_payer_ruts (athlete_id, payer_rut, payer_name, relationship)
                        VALUES ($1, $2, $3, 'Deportista')
                        ON CONFLICT DO NOTHING
                    `, [insRes.rows[0].id, n.rut, `${n.first_name} ${n.last_name}`]);
                }
                insertadosCount++;
            }

            for (const a of actualizados) {
                const fields = [];
                const vals = [];
                let idx = 1;
                for (const [k, v] of Object.entries(a.changes)) {
                    fields.push(`${k} = $${idx++}`);
                    vals.push(v);
                }
                vals.push(a.id);
                await client.query(`
                    UPDATE athletes SET ${fields.join(', ')} WHERE id = $${idx}
                `, vals);
                actualizadosCount++;
            }

            await client.query('COMMIT');

            res.json({
                success: true,
                message: `Sincronización completada: ${insertadosCount} nuevos deportistas incorporados, ${actualizadosCount} actualizados.`,
                insertados_count: insertadosCount,
                actualizados_count: actualizadosCount
            });
        } catch (err) {
            await client.query('ROLLBACK');
            throw err;
        } finally {
            client.release();
        }
    } catch (err) {
        console.error('Error al sincronizar deportistas:', err);
        res.status(500).json({ error: 'Error al sincronizar deportistas desde Excel', details: err.message });
    }
};

// 25. Ajuste integral de categorías U11 a U12 y cuotas de minivoley
exports.adjustU11AndMiniCategories = async (req, res) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // 1. Actualizar U11 Damas F a U12 Damas F con arancel REGULAR de $50.000
        const u11FRes = await client.query(`
            UPDATE athletes 
            SET category = 'U12 Damas F', fee_type = 'REGULAR', monthly_fee = 50000.00 
            WHERE category = 'U11 Damas F'
            RETURNING id
        `);

        // 2. Actualizar U11 masculino M a U12 Varones M con arancel REGULAR de $50.000
        const u11MRes = await client.query(`
            UPDATE athletes 
            SET category = 'U12 Varones M', fee_type = 'REGULAR', monthly_fee = 50000.00 
            WHERE category = 'U11 masculino M'
            RETURNING id
        `);

        // 3. Anastasia Toledo (id 18): nacida 2015 (11 años), gemela de Josefina, va a U12 Damas F, U12 G1 Damas, $50.000
        await client.query(`
            UPDATE athletes 
            SET category = 'U12 Damas F', agrupacion = 'U12 G1 Damas', fee_type = 'REGULAR', monthly_fee = 50000.00 
            WHERE id = 18
        `);

        // 4. Isabella Aguilera (id 100): nacida 2013 (13 años), va a U13 Damas F, $50.000
        await client.query(`
            UPDATE athletes 
            SET category = 'U13 Damas F', fee_type = 'REGULAR', monthly_fee = 50000.00 
            WHERE id = 100
        `);

        // 5. Josefa Antonia Uribe Gallardo (id 251): nacida 2012 (14 años), va a U14 Damas F, $50.000
        await client.query(`
            UPDATE athletes 
            SET category = 'U14 Damas F', fee_type = 'REGULAR', monthly_fee = 50000.00 
            WHERE id = 251
        `);

        // 6. María Valentina Ulloa Ulloa (id 252): nacida 2009 (17 años), va a U17 Damas F, $50.000
        await client.query(`
            UPDATE athletes 
            SET category = 'U17 Damas F', fee_type = 'REGULAR', monthly_fee = 50000.00 
            WHERE id = 252
        `);

        // 7. Unificar nombre 'Minivoley' a 'Mini Voley'
        await client.query(`
            UPDATE athletes 
            SET category = 'Mini Voley' 
            WHERE category = 'Minivoley'
        `);

        // 8. Corregir pagos bancarios pendientes que tenían concepto MENSUALIDAD por defecto sin deportista
        const movsRes = await client.query(`
            UPDATE bank_movements 
            SET category_concept = 'POR_DEFINIR' 
            WHERE status = 'PENDIENTE' AND athlete_id IS NULL AND category_concept = 'MENSUALIDAD'
            RETURNING id
        `);

        // 9. Reclasificar pagos obvios de campeonato (ej. Club Volley Valdivia 140.000 y pagos de 140.000)
        await client.query(`
            UPDATE bank_movements
            SET category_concept = 'INSCRIPCION_CAMPEONATO_VISITA'
            WHERE (payer_name ILIKE '%VOLLEY VALDIVIA%' OR notes ILIKE '%VOLLEY VALDIVIA%') AND status = 'PENDIENTE'
        `);
        await client.query(`
            UPDATE bank_movements
            SET category_concept = 'CAMPEONATO'
            WHERE amount = 140000.00 AND status = 'PENDIENTE' AND category_concept = 'POR_DEFINIR'
        `);

        await client.query('COMMIT');

        res.json({
            success: true,
            message: 'Categorías y cuotas ajustadas con éxito',
            u11_damas_actualizadas: u11FRes.rowCount,
            u11_varones_actualizados: u11MRes.rowCount,
            movimientos_pendientes_reset: movsRes.rowCount
        });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Error al ajustar categorías:', err);
        res.status(500).json({ error: 'Error al ajustar categorías', details: err.message });
    } finally {
        client.release();
    }
};

// 30. Ejecutar migración y auditoría profunda de conceptos bancarios y fechas de ingreso
exports.migrateMovementsAndJoinDates = async (req, res) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        let payload = req.body;
        if (!payload || !payload.movements || !payload.movements.length) {
            try {
                payload = require('../data/migration_payload.json');
            } catch (e) {
                payload = { movements: [], athletes: [] };
            }
        }

        const movements = payload.movements || [];
        const athletes = payload.athletes || [];

        let movementsUpdated = 0;
        for (const m of movements) {
            const upd = await client.query(
                `UPDATE bank_movements SET category_concept = $1 WHERE id = $2 RETURNING id`,
                [m.concept, m.id]
            );
            if (upd.rowCount > 0) movementsUpdated += upd.rowCount;
        }

        let athletesUpdated = 0;
        for (const a of athletes) {
            const upd = await client.query(
                `UPDATE athletes SET join_date = $1 WHERE id = $2 RETURNING id`,
                [a.join_date, a.id]
            );
            if (upd.rowCount > 0) athletesUpdated += upd.rowCount;
        }

        // Casos explícitos y seguros
        // Maite Cano (id 146):
        await client.query(`
            UPDATE bank_movements 
            SET category_concept = 'CAMPEONATO' 
            WHERE athlete_id = 146 AND id IN (53, 72, 220, 282, 874, 971, 973, 1126, 1181, 339, 702, 714)
        `);
        await client.query(`
            UPDATE bank_movements 
            SET category_concept = 'ROPA' 
            WHERE athlete_id = 146 AND id IN (1069, 621)
        `);
        await client.query(`
            UPDATE bank_movements 
            SET category_concept = 'TALLERES' 
            WHERE athlete_id = 146 AND id = 624
        `);

        // Alumnos con deuda previa documentada
        await client.query(`UPDATE athletes SET join_date = '2026-07-01' WHERE id = 79`); // Francisca Perez Webar
        await client.query(`UPDATE athletes SET join_date = '2026-05-01' WHERE id = 70`); // Fernanda Maier
        await client.query(`UPDATE athletes SET join_date = '2026-05-01' WHERE id = 249`); // Wilton Díaz
        await client.query(`UPDATE athletes SET join_date = '2026-06-01' WHERE id = 34`); // Carolina Fuentes
        await client.query(`UPDATE athletes SET join_date = '2026-06-01' WHERE id = 35`); // Catalina Barrientos
        await client.query(`UPDATE athletes SET join_date = '2026-05-01' WHERE id = 119`); // Juan Jose Barria
        await client.query(`UPDATE athletes SET join_date = '2026-05-01' WHERE id = 120`); // Julian Carrasco
        await client.query(`UPDATE athletes SET join_date = '2026-06-01' WHERE id = 246`); // Vicente Navarro
        await client.query(`UPDATE athletes SET join_date = '2026-07-01' WHERE id = 221`); // Sofia Chavez

        await client.query('COMMIT');

        res.json({
            success: true,
            message: 'Migración y auditoría de conceptos y fechas ejecutada con éxito',
            movements_updated: movementsUpdated,
            athletes_updated: athletesUpdated
        });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Error en migración:', err);
        res.status(500).json({ error: 'Error al ejecutar migración', details: err.message });
    } finally {
        client.release();
    }
};

