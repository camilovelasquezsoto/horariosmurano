/**
 * CONTROLADOR DE FINANZAS Y PAGOS - MURANO VOLEY
 * 
 * Gestiona el registro de deportistas, vinculación de RUTs de apoderados,
 * conciliación automática de transferencias bancarias y reportes de cobranza.
 */

const pool = require('../config/db');
const xlsx = require('xlsx');
const fs = require('fs');
const path = require('path');

// Utilidades para normalización de RUT chileno
function cleanRut(rut) {
    if (!rut) return '';
    let str = rut.toString().trim().toUpperCase();
    if (str.endsWith('.0')) str = str.slice(0, -2);
    return str.replace(/[^0-9K]/g, '');
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

function getCurrentSystemPeriod() {
    const months = ['ENERO', 'FEBRERO', 'MARZO', 'ABRIL', 'MAYO', 'JUNIO', 'JULIO', 'AGOSTO', 'SEPTIEMBRE', 'OCTUBRE', 'NOVIEMBRE', 'DICIEMBRE'];
    const now = new Date();
    return `${months[now.getMonth()]}-${now.getFullYear()}`;
}

function cleanAmount(val) {
    if (!val && val !== 0) return 0;
    if (typeof val === 'number') return Math.round(val);
    let str = val.toString().trim().replace(/[$\s]/g, '');
    if (!str) return 0;
    const isNegative = str.startsWith('-');
    if (isNegative) str = str.substring(1);

    if (str.includes(',')) {
        str = str.split(',')[0].replace(/\./g, '');
    } else if (/\.\d{1,2}$/.test(str)) {
        // Valores con decimales flotantes desde Excel/Python p.ej. "50000.0" o "50000.00"
        str = str.split('.')[0].replace(/\./g, '');
    } else {
        str = str.replace(/\./g, '');
    }
    const num = parseInt(str, 10) || 0;
    return isNegative ? -num : num;
}

// 1. Obtener lista de deportistas con sus RUTs asociados y estado de pago del mes
exports.getAthletes = async (req, res) => {
    try {
        const { period, category, agrupacion, search, status, semaforo } = req.query;
        const currentPeriod = period || getCurrentSystemPeriod();

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
        const { first_name, last_name, category, agrupacion, fee_type, monthly_fee, status, phone, apoderado_phone, join_date, notes, rut } = req.body;

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
        let newFee = monthly_fee !== undefined ? parseFloat(monthly_fee) : cur.monthly_fee;
        const newStatus = status !== undefined ? status : cur.status;
        const newPhone = phone !== undefined ? phone.trim() : cur.phone;
        const newApodPhone = apoderado_phone !== undefined ? apoderado_phone.trim() : cur.apoderado_phone;
        const newJoinDate = join_date !== undefined ? join_date : (cur.join_date ? new Date(cur.join_date).toISOString().slice(0, 10) : '2026-09-01');
        const newNotes = notes !== undefined ? notes : cur.notes;
        const newRut = rut !== undefined ? cleanRut(rut) : cur.rut;

        // Si se define como becado completo y no se indicó cuota explícita, arancel es 0
        if ((newStatus === 'BECADO' || newFeeType === 'BECA_COMPLETA' || newFeeType === 'BECADO') && monthly_fee === undefined) {
            newFee = 0;
        }

        const result = await pool.query(
            `UPDATE athletes 
             SET first_name = $1, last_name = $2, category = $3, agrupacion = $4, fee_type = $5, 
                 monthly_fee = $6, status = $7, phone = $8, apoderado_phone = $9, join_date = $10, notes = $11, rut = $12
             WHERE id = $13 RETURNING *`,
            [newFirst, newLast, newCat, newAgrup, newFeeType, newFee, newStatus, newPhone, newApodPhone, newJoinDate, newNotes, newRut, id]
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

// 6b. Buscar y consultar historial y vínculos de un RUT Pagador
exports.lookupPayerRut = async (req, res) => {
    try {
        const queryStr = req.query.q || req.query.rut || '';
        const cRut = cleanRut(queryStr);
        const nameQuery = queryStr.trim().toLowerCase();

        if (!cRut && nameQuery.length < 2) {
            return res.json({ athletes: [], movements: [], payers: [] });
        }

        // 1. Buscar en athlete_payer_ruts y en bank_movements para encontrar RUTs y nombres coincidentes
        const payersRes = await pool.query(`
            SELECT DISTINCT 
                COALESCE(apr.payer_rut, m.payer_rut) as rut,
                COALESCE(NULLIF(apr.payer_name, ''), NULLIF(m.payer_name, ''), 'Desconocido') as payer_name
            FROM bank_movements m
            FULL OUTER JOIN athlete_payer_ruts apr ON m.payer_rut = apr.payer_rut
            WHERE 
                ($1 != '' AND (m.payer_rut LIKE $2 OR apr.payer_rut LIKE $2))
                OR ($3 != '' AND (LOWER(m.payer_name) LIKE $4 OR LOWER(apr.payer_name) LIKE $4))
            LIMIT 15
        `, [
            cRut, 
            `%${cRut}%`, 
            nameQuery, 
            `%${nameQuery}%`
        ]);

        if (payersRes.rows.length === 0 && !cRut) {
            return res.json({ payers: [], athletes: [], movements: [], stats: null });
        }

        const targetRut = cRut || (payersRes.rows[0]?.rut) || '';

        // 2. Deportistas asociados a este RUT
        const athRes = await pool.query(`
            SELECT 
                a.id, a.first_name, a.last_name, a.category, a.agrupacion, a.monthly_fee, a.status, a.phone, a.apoderado_phone,
                apr.relationship, apr.payer_name
            FROM athlete_payer_ruts apr
            JOIN athletes a ON apr.athlete_id = a.id
            WHERE apr.payer_rut = $1
            ORDER BY a.last_name ASC
        `, [targetRut]);

        // 3. Movimientos bancarios realizados por este RUT
        const movsRes = await pool.query(`
            SELECT 
                m.id, TO_CHAR(m.date, 'YYYY-MM-DD') as date, m.amount, m.period, m.category_concept, m.status, m.notes,
                m.payer_name, m.bank_origin, m.account_origin,
                a.id as athlete_id, a.first_name, a.last_name, a.category as athlete_category
            FROM bank_movements m
            LEFT JOIN athletes a ON m.athlete_id = a.id
            WHERE m.payer_rut = $1
            ORDER BY m.date DESC, m.id DESC
        `, [targetRut]);

        // 4. Calcular estadísticas del pagador
        const movs = movsRes.rows;
        const totalPaid = movs.reduce((sum, m) => sum + parseFloat(m.amount || 0), 0);
        
        // Frecuencia de montos y conceptos
        const amtCounts = {};
        const conceptCounts = {};
        movs.forEach(m => {
            const a = Math.round(parseFloat(m.amount));
            amtCounts[a] = (amtCounts[a] || 0) + 1;
            const c = m.category_concept || 'POR_DEFINIR';
            conceptCounts[c] = (conceptCounts[c] || 0) + 1;
        });

        let usualAmount = 0;
        let maxAmtCount = 0;
        for (const [amt, cnt] of Object.entries(amtCounts)) {
            if (cnt > maxAmtCount) {
                maxAmtCount = cnt;
                usualAmount = parseInt(amt, 10);
            }
        }

        let usualConcept = 'MENSUALIDAD';
        let maxConceptCount = 0;
        for (const [c, cnt] of Object.entries(conceptCounts)) {
            if (cnt > maxConceptCount) {
                maxConceptCount = cnt;
                usualConcept = c;
            }
        }

        res.json({
            target_rut: targetRut,
            formatted_rut: formatRut(targetRut),
            payers: payersRes.rows.map(p => ({ ...p, formatted_rut: formatRut(p.rut) })),
            athletes: athRes.rows,
            movements: movs.map(m => ({ ...m, formatted_rut: formatRut(targetRut) })),
            stats: {
                total_transfers: movs.length,
                total_paid: totalPaid,
                usual_amount: usualAmount,
                usual_concept: usualConcept,
                last_transfer: movs[0]?.date || null
            }
        });
    } catch (err) {
        console.error('Error al consultar RUT pagador:', err);
        res.status(500).json({ error: 'Error al consultar RUT pagador', details: err.message });
    }
};

// Helper para nombres de meses y detección de período
const MONTH_NAMES = {
    1: 'ENERO', 2: 'FEBRERO', 3: 'MARZO', 4: 'ABRIL',
    5: 'MAYO', 6: 'JUNIO', 7: 'JULIO', 8: 'AGOSTO',
    9: 'SEPTIEMBRE', 10: 'OCTUBRE', 11: 'NOVIEMBRE', 12: 'DICIEMBRE'
};

function getPeriodFromDate(dateVal, fallbackPeriod) {
    if (!dateVal) return fallbackPeriod || getCurrentSystemPeriod();
    let month = null;
    let year = null;

    if (dateVal instanceof Date) {
        month = dateVal.getMonth() + 1;
        year = dateVal.getFullYear();
    } else if (typeof dateVal === 'number' && dateVal > 25000 && dateVal < 60000) {
        const d = new Date(Math.round((dateVal - 25569) * 86400 * 1000));
        month = d.getUTCMonth() + 1;
        year = d.getUTCFullYear();
    } else {
        const s = dateVal.toString().trim();
        if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
            const parts = s.split('-');
            year = parts[0];
            month = parseInt(parts[1], 10);
        } else if (/^\d{1,2}[-/]\d{1,2}[-/]\d{4}/.test(s)) {
            const parts = s.split(/[-/]/);
            month = parseInt(parts[1], 10);
            year = parts[2];
        }
    }

    if (month && MONTH_NAMES[month] && year) {
        return `${MONTH_NAMES[month]}-${year}`;
    }
    return fallbackPeriod || getCurrentSystemPeriod();
}

function normalizeDateStr(dateVal) {
    if (!dateVal) return '';
    if (typeof dateVal === 'number' && dateVal > 25000 && dateVal < 60000) {
        const d = new Date(Math.round((dateVal - 25569) * 86400 * 1000));
        const y = d.getUTCFullYear();
        const m = String(d.getUTCMonth() + 1).padStart(2, '0');
        const day = String(d.getUTCDate()).padStart(2, '0');
        return `${y}-${m}-${day}`;
    }
    const cleanDate = dateVal.toString().trim();
    if (cleanDate.includes('-')) {
        const parts = cleanDate.split('-');
        if (parts.length === 3) {
            if (parts[0].length === 4) return cleanDate;
            if (parts[0].length <= 2) {
                return `${parts[2]}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}`;
            }
        }
    } else if (cleanDate.includes('/')) {
        const parts = cleanDate.split('/');
        if (parts.length === 3) {
            if (parts[0].length === 4) return `${parts[0]}-${parts[1].padStart(2, '0')}-${parts[2].padStart(2, '0')}`;
            if (parts[0].length <= 2) {
                return `${parts[2]}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}`;
            }
        }
    }
    return cleanDate;
}

function decodeHtmlEntities(str) {
    if (!str) return '';
    return str
        .replace(/H\s+eacute\s+ctor/gi, 'Héctor')
        .replace(/&eacute;/gi, 'é')
        .replace(/&aacute;/gi, 'á')
        .replace(/&iacute;/gi, 'í')
        .replace(/&oacute;/gi, 'ó')
        .replace(/&uacute;/gi, 'ú')
        .replace(/&ntilde;/gi, 'ñ')
        .replace(/&Eacute;/gi, 'É')
        .replace(/&Aacute;/gi, 'Á')
        .replace(/&Iacute;/gi, 'Í')
        .replace(/&Oacute;/gi, 'Ó')
        .replace(/&Uacute;/gi, 'Ú')
        .replace(/&Ntilde;/gi, 'Ñ')
        .replace(/&amp;/gi, '&');
}

function parseScotiabankDesc(rawDesc) {
    let desc = decodeHtmlEntities(rawDesc || '').trim();
    let payerRut = '';
    let payerName = desc;

    const tefMatch = desc.match(/^TEF\s+([0-9Kk.-]+)\s*(.*)/i);
    if (tefMatch) {
        payerRut = cleanRut(tefMatch[1]);
        payerName = tefMatch[2].trim() || desc;
    } else if (desc.toUpperCase().startsWith('TRANSF. DE ')) {
        payerName = desc.substring(10).trim();
    } else if (desc.toUpperCase().startsWith('TRANSFERENCIA DE ')) {
        payerName = desc.substring(17).trim();
    }
    return { payerRut, payerName, concept: desc };
}

function parseCartolaRowsUnified(rows) {
    if (!rows || rows.length === 0) return { movements: [], totalLeidos: 0, cargosDescartados: 0 };

    let headerIdx = -1;
    let isScotia = false;

    for (let r = 0; r < Math.min(rows.length, 25); r++) {
        const row = rows[r];
        if (!row || !Array.isArray(row)) continue;
        const rowStr = row.map(c => (c || '').toString().toLowerCase()).join(' ');

        if (rowStr.includes('abonos') || rowStr.includes('cargos') || (rowStr.includes('fecha') && rowStr.includes('descripci'))) {
            headerIdx = r;
            isScotia = true;
            break;
        } else if (rowStr.includes('rut origen') || rowStr.includes('nombre origen') || rowStr.includes('cta. abono')) {
            headerIdx = r;
            isScotia = false;
            break;
        }
    }

    const startIdx = headerIdx !== -1 ? headerIdx + 1 : 0;
    const movements = [];
    let totalLeidos = 0;
    let cargosDescartados = 0;

    for (let r = startIdx; r < rows.length; r++) {
        const row = rows[r];
        if (!row || !row[0]) continue;

        const firstColStr = (row[0] || '').toString().trim().toLowerCase();
        if (firstColStr === 'fecha' || firstColStr.includes('nombre empresa') || firstColStr.includes('número línea') || firstColStr.includes('saldo disponible')) {
            continue;
        }

        totalLeidos++;
        const rowLooksScotia = headerIdx !== -1
            ? isScotia
            : (row[1] && typeof row[1] === 'string' && (row[1].startsWith('TEF') || (row[1].startsWith('TRANSF') && row.length < 8) || row[1].startsWith('REDCOMPRA')));

        if (rowLooksScotia) {
            const dateVal = row[0];
            const desc = (row[1] || '').toString();
            const sucursal = (row[2] || '').toString().trim();
            let doc = (row[3] !== undefined && row[3] !== null) ? row[3].toString().trim() : '';
            if (doc.endsWith('.0')) doc = doc.slice(0, -2);
            if (doc === '0') doc = '';

            const abonoAmt = cleanAmount(row[5]);
            if (abonoAmt <= 0) {
                cargosDescartados++;
                continue;
            }

            const { payerRut, payerName, concept } = parseScotiabankDesc(desc);

            movements.push({
                date: (dateVal || '').toString().trim(),
                transfer_type: 'TRANSFERENCIA',
                account_dest: '',
                payer_rut: payerRut,
                payer_name: payerName,
                bank_origin: sucursal ? ('Scotiabank (' + sucursal + ')') : 'Scotiabank',
                account_origin: doc,
                amount: abonoAmt,
                concept: concept
            });
        } else {
            let dateVal = row[0];
            let rutRaw = row[3];
            let payerName = row[4];
            let amountRaw = row[7] || row[5] || row[1] || 0;
            let bank = row[5] || '';
            let conceptRaw = row[8] || '';

            const clAmt = cleanAmount(amountRaw);
            if (clAmt <= 0) {
                cargosDescartados++;
                continue;
            }

            let doc = (row[6] !== undefined && row[6] !== null) ? row[6].toString().trim() : '';
            if (doc.endsWith('.0')) doc = doc.slice(0, -2);

            movements.push({
                date: (dateVal || '').toString().trim(),
                transfer_type: (row[1] || 'TRANSFERENCIA').toString().trim(),
                account_dest: (row[2] || '').toString().trim(),
                payer_rut: cleanRut(rutRaw),
                payer_name: (payerName || '').toString().trim(),
                bank_origin: (bank || '').toString().trim(),
                account_origin: doc,
                amount: clAmt,
                concept: (conceptRaw || '').toString().trim()
            });
        }
    }
    return { movements, totalLeidos, cargosDescartados };
}

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
        let doc = getTag('documento_numero');
        if (doc.endsWith('.0')) doc = doc.slice(0, -2);
        if (doc === '0') doc = '';
        const sucursal = getTag('sucursal');

        const { payerRut, payerName, concept } = parseScotiabankDesc(desc);

        movements.push({
            date: fecha,
            transfer_type: 'TRANSFERENCIA',
            account_dest: '',
            payer_rut: payerRut,
            payer_name: payerName,
            bank_origin: sucursal ? `Scotiabank (${sucursal})` : 'Scotiabank',
            account_origin: doc,
            amount: Math.round(amt),
            concept: concept
        });
    }
    return movements;
}

// 7. Procesar y conciliar Cartola Bancaria / Últimos Movimientos (desde archivo Excel, XML o array JSON)
exports.processCartola = async (req, res) => {
    try {
        let movements = [];
        const { period } = req.body;
        let currentPeriod = period || getCurrentSystemPeriod();

        if (req.file) {
            const fileStr = req.file.buffer.toString('utf8');
            if (fileStr.includes('<cartola') && fileStr.includes('<movimiento>')) {
                // Archivo XML Scotiabank (typeDesc)
                movements = parseScotiabankXML(fileStr);
            } else {
                // Se subió un archivo Excel o CSV
                const workbook = xlsx.read(req.file.buffer, { type: 'buffer', raw: true, cellDates: false });
                let sheetName = workbook.SheetNames[0];
                if (currentPeriod) {
                    const pUpper = currentPeriod.toUpperCase();
                    const matchedSheet = workbook.SheetNames.find(s => pUpper.includes(s.toUpperCase()) || s.toUpperCase().includes(pUpper.split('-')[0]));
                    if (matchedSheet) sheetName = matchedSheet;
                }
                const rows = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, raw: true });
                const parsed = parseCartolaRowsUnified(rows);
                movements = parsed.movements;
            }
        } else if (Array.isArray(req.body.movements)) {
            movements = req.body.movements
                .filter(m => cleanAmount(m.amount) > 0)
                .map(m => {
                    let doc = (m.account_origin || '').trim();
                    if (doc.endsWith('.0')) doc = doc.slice(0, -2);
                    if (doc === '0') doc = '';
                    return {
                        date: m.date,
                        transfer_type: m.transfer_type || 'TRANSFERENCIA',
                        account_dest: m.account_dest || '',
                        payer_rut: cleanRut(m.payer_rut),
                        payer_name: (m.payer_name || '').trim(),
                        bank_origin: m.bank_origin || '',
                        account_origin: doc,
                        amount: cleanAmount(m.amount),
                        concept: m.concept || '',
                        period: m.period
                    };
                });
        } else {
            return res.status(400).json({ error: 'No se enviaron movimientos ni archivo' });
        }

        // Auto-detectar período predominante si las fechas corresponden a otro mes
        const periodCounts = {};
        movements.forEach(m => {
            const p = m.period || getPeriodFromDate(m.date, currentPeriod);
            if (p) periodCounts[p] = (periodCounts[p] || 0) + 1;
        });
        const dominantPeriod = Object.keys(periodCounts).sort((a, b) => periodCounts[b] - periodCounts[a])[0];
        if (dominantPeriod) {
            currentPeriod = dominantPeriod;
        }

        await ensureAuditTable();

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

            // Normalizar fecha
            const parsedDate = normalizeDateStr(mov.date);

            let doc = (mov.account_origin || '').trim();
            if (doc.endsWith('.0')) doc = doc.slice(0, -2);
            if (doc === '0') doc = '';

            const rut = cleanRut(mov.payer_rut);
            const payerNameClean = (mov.payer_name || '').trim().toLowerCase();
            const hasValidDoc = doc && doc.length >= 5;

            // ── DEDUPLICACIÓN INTELIGENTE EN MEMORIA ──
            let isDuplicate = false;

            // 1. Si tiene N° Doc válido (>= 5 dígitos), deduplicar ESTRICTAMENTE por documento y monto
            if (hasValidDoc) {
                const docLower = doc.toLowerCase();
                if (existingMovements.some(em => 
                    (em.account_origin && em.account_origin === doc) || 
                    (em.notes_lower && em.notes_lower.includes(docLower))
                )) {
                    isDuplicate = true;
                }
            } else {
                // 2. Si NO tiene N° Doc válido (transferencias internas o genéricas), deduplicar por fecha, monto y RUT/nombre
                if (rut && rut !== '') {
                    if (existingMovements.some(em => 
                        Math.round(em.amount) === amt && 
                        em.date_str === parsedDate && 
                        em.payer_rut === rut &&
                        (!em.account_origin || em.account_origin === '0' || em.account_origin === '')
                    )) {
                        isDuplicate = true;
                    }
                } else if (payerNameClean && payerNameClean.length > 3) {
                    if (existingMovements.some(em => 
                        Math.round(em.amount) === amt && 
                        em.date_str === parsedDate && (
                            (em.payer_name && (em.payer_name.includes(payerNameClean) || payerNameClean.includes(em.payer_name))) ||
                            (em.notes_lower && em.notes_lower.includes(payerNameClean))
                        ) &&
                        (!em.account_origin || em.account_origin === '0' || em.account_origin === '')
                    )) {
                        isDuplicate = true;
                    }
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
            else if (cLow.includes('bayes') || cLow.includes('no inscrito') || cLow.includes('no inscrita') || cLow.includes('sin ingresar')) categoryConcept = 'NO_INSCRITO_BAYES';
            else if (cLow.includes('debe')) categoryConcept = 'DEBE';
            else if (cLow.includes('otro') || cLow.includes('varios')) categoryConcept = 'OTROS';

            // Match por RUT
            const matchedAthletes = rut ? (rutLookup.get(rut) || []) : [];
            let athleteId = null;
            let status = 'PENDIENTE';
            let movementNotes = mov.concept || '';

            if (matchedAthletes.length === 1) {
                // Alumno reconocido: se asigna automáticamente a Pagos en estado CONCILIADO como POR_DEFINIR
                const ath = matchedAthletes[0];
                athleteId = ath.athlete_id;
                status = 'CONCILIADO';
                categoryConcept = 'POR_DEFINIR';
                matchedCount++;
            } else if (matchedAthletes.length > 1) {
                // Múltiples hermanos vinculados: asignar al primer candidato como POR_DEFINIR para rápida selección
                athleteId = matchedAthletes[0].athlete_id;
                status = 'CONCILIADO';
                categoryConcept = 'POR_DEFINIR';
                matchedCount++;
                const kidsNames = matchedAthletes.map(k => `${k.first_name} (${k.category} $${k.monthly_fee})`).join(' y ');
                movementNotes = movementNotes ? `${movementNotes} | Apoderado de: ${kidsNames}.` : `Apoderado de: ${kidsNames}.`;
            } else {
                // Sin coincidencia por RUT registrado:
                // Estrictamente queda sin alumno asignado (athleteId = null) y en estado PENDIENTE ("Por Asignar")
                // para que la tesorera lo asigne manualmente si corresponde.
                // NO se realiza asignación automática por coincidencia de nombre para evitar falsas asociaciones.
                athleteId = null;
                status = 'PENDIENTE';
                pendingCount++;
            }

            const movPeriod = mov.period || getPeriodFromDate(parsedDate, currentPeriod);

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
                period: movPeriod,
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
        await ensureAuditTable();
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
            if (status === 'PENDIENTE') {
                query += ` AND m.status = 'PENDIENTE' AND m.athlete_id IS NULL`;
            } else {
                query += ` AND m.status = $${pIdx++}`;
                params.push(status);
            }
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
            query += ` AND m.category_concept != 'MENSUALIDAD' AND (m.status = 'CONCILIADO' OR m.athlete_id IS NOT NULL)`;
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

// Helper para asegurar tabla de auditoría de modificaciones
let auditTableInitialized = false;
async function ensureAuditTable() {
    if (auditTableInitialized) return;
    try {
        await pool.query(`
            ALTER TABLE bank_movements ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP;
            
            CREATE TABLE IF NOT EXISTS payment_audit_logs (
                id SERIAL PRIMARY KEY,
                movement_id INTEGER,
                action VARCHAR(50),
                athlete_id INTEGER REFERENCES athletes(id) ON DELETE SET NULL,
                athlete_name VARCHAR(255),
                payer_rut VARCHAR(50),
                payer_name VARCHAR(255),
                amount NUMERIC(12, 2),
                concept_before VARCHAR(100),
                concept_after VARCHAR(100),
                notes TEXT,
                created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
            );

            -- Regularizar movimientos que ya tienen alumno asignado pero quedaron como PENDIENTE
            UPDATE bank_movements 
            SET status = 'CONCILIADO' 
            WHERE status = 'PENDIENTE' AND athlete_id IS NOT NULL;

            -- Limpieza preventiva: desasociar cualquier movimiento erróneamente vinculado por coincidencia de nombre
            UPDATE bank_movements
            SET athlete_id = NULL,
                status = CASE WHEN category_concept IN ('ARRIENDO_GYM', 'ARRIENDO_CANCHA') THEN 'CONCILIADO' ELSE 'PENDIENTE' END,
                notes = TRIM(REGEXP_REPLACE(notes, '\\|\\s*Asignado automáticamente.*$', '', 'i'))
            WHERE notes ILIKE '%Asignado automáticamente por%nombre%'
               OR notes ILIKE '%coincidencia de nombre%';

            -- Asegurar que el pagador Luis Hernán Barría no tenga enlaces erróneos a alumnos
            UPDATE bank_movements
            SET athlete_id = NULL
            WHERE payer_rut = '106789975' AND athlete_id IS NOT NULL;

            DELETE FROM athlete_payer_ruts WHERE payer_rut = '106789975';

            -- Corregir montos históricos inflados (x100) en payment_audit_logs
            UPDATE payment_audit_logs l
            SET amount = m.amount
            FROM bank_movements m
            WHERE l.movement_id = m.id AND l.amount >= 1000000 AND m.amount <= 500000;

            UPDATE payment_audit_logs
            SET amount = ROUND(amount / 100, 2)
            WHERE amount >= 1000000 AND (amount % 100 = 0);
        `);
        auditTableInitialized = true;
    } catch (e) {
        console.error('Error inicializando payment_audit_logs:', e.message);
    }
}

async function logPaymentModification(data) {
    try {
        await ensureAuditTable();
        let logAmt = null;
        if (data.amount !== undefined && data.amount !== null) {
            const raw = typeof data.amount === 'number' ? data.amount : parseFloat(String(data.amount).replace(/[$\s]/g, '').replace(',', '.'));
            logAmt = !isNaN(raw) ? Math.round(raw) : cleanAmount(data.amount);
        }
        await pool.query(`
            INSERT INTO payment_audit_logs 
            (movement_id, action, athlete_id, athlete_name, payer_rut, payer_name, amount, concept_before, concept_after, notes)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        `, [
            data.movement_id || null,
            data.action || 'MODIFICACION',
            data.athlete_id || null,
            data.athlete_name || null,
            data.payer_rut || null,
            data.payer_name || null,
            logAmt,
            data.concept_before || null,
            data.concept_after || null,
            data.notes || null
        ]);
    } catch (err) {
        console.error('Error guardando log de auditoría:', err.message);
    }
}

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
                 notes = $4,
                 updated_at = CURRENT_TIMESTAMP
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

        // Registrar en auditoría
        let athName = null;
        if (athId) {
            const athR = await pool.query('SELECT first_name, last_name FROM athletes WHERE id = $1', [athId]);
            if (athR.rows.length > 0) {
                athName = `${athR.rows[0].first_name} ${athR.rows[0].last_name}`;
            }
        }
        await logPaymentModification({
            movement_id: movement_id,
            action: newConcept === 'MENSUALIDAD' ? 'MENSUALIDAD' : 'ASIGNACION',
            athlete_id: athId,
            athlete_name: athName,
            payer_rut: mov.payer_rut,
            payer_name: mov.payer_name,
            amount: mov.amount,
            concept_before: mov.category_concept,
            concept_after: newConcept,
            notes: newNotes
        });

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
        const currentPeriod = period || getPeriodFromDate(new Date()) || 'OCTUBRE-2026';

        // Parsear fin de mes del periodo (ej: 'SEPTIEMBRE-2026')
        const monthMap = {
            'ENERO': 1, 'FEBRERO': 2, 'MARZO': 3, 'ABRIL': 4, 'MAYO': 5, 'JUNIO': 6,
            'JULIO': 7, 'AGOSTO': 8, 'SEPTIEMBRE': 9, 'OCTUBRE': 10, 'NOVIEMBRE': 11, 'DICIEMBRE': 12
        };
        let periodEnd = '2026-09-30';
        const parts = currentPeriod.split('-');
        if (parts.length === 2) {
            const mNum = monthMap[parts[0].toUpperCase()] || 9;
            const yNum = parseInt(parts[1], 10) || 2026;
            const lastDay = new Date(yNum, mNum, 0).getDate();
            periodEnd = `${yNum}-${String(mNum).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
        }

        // 1. Total deportistas y arancel esperado (excluyendo inactivos, retirados e ingresos posteriores)
        const athletesRes = await pool.query(`
            SELECT 
                COUNT(*) FILTER (WHERE status NOT IN ('INACTIVO', 'RETIRADO') AND (join_date IS NULL OR join_date <= $1)) as total_athletes,
                COUNT(*) FILTER (WHERE (status = 'BECADO' OR fee_type IN ('BECADO', 'BECA_COMPLETA') OR monthly_fee = 0) AND status NOT IN ('INACTIVO', 'RETIRADO') AND (join_date IS NULL OR join_date <= $1)) as total_becados,
                COUNT(*) FILTER (WHERE status = 'ACTIVO' AND fee_type NOT IN ('BECADO', 'BECA_COMPLETA') AND monthly_fee > 0 AND (join_date IS NULL OR join_date <= $1)) as total_activos_cobro,
                COALESCE(SUM(monthly_fee) FILTER (WHERE status = 'ACTIVO' AND fee_type NOT IN ('BECADO', 'BECA_COMPLETA') AND monthly_fee > 0 AND (join_date IS NULL OR join_date <= $1)), 0) as total_esperado,
                COUNT(*) FILTER (WHERE status IN ('INACTIVO', 'RETIRADO')) as total_inactivos
            FROM athletes
        `, [periodEnd]);

        // 2. Total recaudado por mensualidades
        const mensualidadesRes = await pool.query(`
            SELECT 
                COALESCE(SUM(amount), 0) as total_mensualidades,
                COUNT(DISTINCT athlete_id) as total_alumnos_pagaron,
                COUNT(*) as count_mensualidades
            FROM bank_movements
            WHERE period = $1 AND status = 'CONCILIADO' AND category_concept = 'MENSUALIDAD'
        `, [currentPeriod]);

        // 3. Total recaudado por pagos extras y otros ingresos (incluye pagos con alumno asignado en revisión)
        const extrasRes = await pool.query(`
            SELECT 
                COALESCE(SUM(amount), 0) as total_extras,
                COUNT(*) as count_extras
            FROM bank_movements
            WHERE period = $1 AND category_concept != 'MENSUALIDAD' AND category_concept != 'ANULADO' AND (status = 'CONCILIADO' OR athlete_id IS NOT NULL)
        `, [currentPeriod]);

        // 4. Desglose detallado de pagos extras por concepto
        const extrasDesgloseRes = await pool.query(`
            SELECT 
                category_concept,
                COUNT(*) as count,
                COALESCE(SUM(amount), 0) as total
            FROM bank_movements
            WHERE period = $1 AND category_concept != 'MENSUALIDAD' AND category_concept != 'ANULADO' AND (status = 'CONCILIADO' OR athlete_id IS NOT NULL)
            GROUP BY category_concept
            ORDER BY total DESC
        `, [currentPeriod]);

        // 5. Total movimientos pendientes de asignar (estrictamente sin alumno reconocido)
        const pendingRes = await pool.query(`
            SELECT 
                COUNT(*) as count_pendientes,
                COALESCE(SUM(amount), 0) as total_monto_pendiente
            FROM bank_movements
            WHERE period = $1 AND (status = 'PENDIENTE' OR athlete_id IS NULL) AND athlete_id IS NULL
        `, [currentPeriod]);

        // 6. Desglose por categoría (solo alumnos activos que hayan ingresado a la fecha)
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
                COUNT(a.id) FILTER (WHERE a.fee_type IN ('BECADO', 'BECA_COMPLETA') OR a.status = 'BECADO' OR a.monthly_fee = 0) as total_becados,
                COALESCE(SUM(a.monthly_fee) FILTER (WHERE a.status = 'ACTIVO' AND a.fee_type NOT IN ('BECADO', 'BECA_COMPLETA') AND a.monthly_fee > 0), 0) as esperado,
                COALESCE(SUM(m.rec_mensualidad), 0) as recaudado_mensualidad,
                COALESCE(SUM(m.rec_extras), 0) as recaudado_extras,
                COALESCE(SUM(m.rec_total), 0) as recaudado_total,
                COALESCE(SUM(m.rec_total), 0) as recaudado
            FROM athletes a
            LEFT JOIN ath_movs m ON a.id = m.athlete_id
            WHERE a.status NOT IN ('INACTIVO', 'RETIRADO') AND (a.join_date IS NULL OR a.join_date <= $2)
            GROUP BY a.category
            ORDER BY a.category ASC
        `, [currentPeriod, periodEnd]);

        // 7. Desglose por agrupación (Equipos Bayes - separación limpia de agrupaciones dobles)
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
            ),
            split_athletes AS (
                SELECT 
                    a.id,
                    a.monthly_fee,
                    a.fee_type,
                    a.status,
                    a.join_date,
                    TRIM(UNNEST(STRING_TO_ARRAY(COALESCE(NULLIF(a.agrupacion, ''), 'Sin Agrupación'), '/'))) as agrupacion,
                    m.rec_mensualidad,
                    m.rec_extras,
                    m.rec_total
                FROM athletes a
                LEFT JOIN ath_movs m ON a.id = m.athlete_id
                WHERE a.status NOT IN ('INACTIVO', 'RETIRADO')
            )
            SELECT 
                agrupacion,
                COUNT(id) as total_alumnos,
                COUNT(id) FILTER (WHERE fee_type IN ('BECADO', 'BECA_COMPLETA') OR status = 'BECADO' OR monthly_fee = 0) as total_becados,
                COALESCE(SUM(monthly_fee) FILTER (WHERE status = 'ACTIVO' AND fee_type NOT IN ('BECADO', 'BECA_COMPLETA') AND monthly_fee > 0), 0) as esperado,
                COALESCE(SUM(rec_mensualidad), 0) as recaudado_mensualidad,
                COALESCE(SUM(rec_extras), 0) as recaudado_extras,
                COALESCE(SUM(rec_total), 0) as recaudado_total,
                COALESCE(SUM(rec_total), 0) as recaudado
            FROM split_athletes
            WHERE agrupacion != '' AND agrupacion NOT ILIKE 'PF%' AND agrupacion NOT ILIKE '%PF' AND (join_date IS NULL OR join_date <= $2)
            GROUP BY agrupacion
            ORDER BY agrupacion ASC
        `, [currentPeriod, periodEnd]);

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

        const countPagaron = parseInt(mensualidadesRes.rows[0].total_alumnos_pagaron, 10) || 0;
        const countBecados = parseInt(athletesRes.rows[0].total_becados, 10) || 0;
        const totalActivosCobro = parseInt(athletesRes.rows[0].total_activos_cobro, 10) || 0;
        const totalAlumnosPeriodo = parseInt(athletesRes.rows[0].total_athletes, 10) || 0;
        const alumnosAlDia = Math.min(totalAlumnosPeriodo, countPagaron + countBecados);

        res.json({
            period: currentPeriod,
            esperado: parseFloat(athletesRes.rows[0].total_esperado),
            total_mensualidades: totalMens,
            total_extras: totalExt,
            recaudado: totalRecaudado,
            total_egresos: totalEgresos,
            count_egresos: countEgresos,
            saldo_neto: totalRecaudado - totalEgresos,
            alumnos_pagaron: countPagaron,
            alumnos_al_dia: alumnosAlDia,
            total_activos: totalActivosCobro,
            total_alumnos_periodo: totalAlumnosPeriodo,
            total_becados: countBecados,
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

// 12. Auditoría Integral y Diagnóstico de Calidad de Datos
exports.getAuditReport = async (req, res) => {
    try {
        const { period } = req.query;
        const currentPeriod = period || getCurrentSystemPeriod();

        // 1. Obtener deportistas
        const athQuery = `
            SELECT 
                a.id, a.first_name, a.last_name, (a.first_name || ' ' || a.last_name) as full_name,
                a.category, COALESCE(a.agrupacion, 'Sin Agrupación') as agrupacion,
                a.phone, a.apoderado_phone, a.join_date, a.rut, a.fee_type, a.monthly_fee,
                a.status, a.notes,
                COALESCE(ruts_agg.payer_ruts, '[]') as payer_ruts
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
            ORDER BY a.first_name, a.last_name
        `;
        const athletesRes = await pool.query(athQuery);
        const athletes = athletesRes.rows;

        // 2. Obtener movimientos del periodo
        const movQuery = `
            SELECT 
                m.id, TO_CHAR(m.date, 'YYYY-MM-DD') as date,
                m.payer_rut, m.payer_name, m.amount, m.athlete_id,
                m.period, m.category_concept, m.status, m.notes,
                (a.first_name || ' ' || a.last_name) as athlete_name,
                a.category as athlete_category
            FROM bank_movements m
            LEFT JOIN athletes a ON m.athlete_id = a.id
            WHERE m.period = $1
            ORDER BY m.date DESC, m.id DESC
        `;
        const movementsRes = await pool.query(movQuery, [currentPeriod]);
        const movements = movementsRes.rows;

        const alerts = [];

        // --- ALERTA 1: RUTS FALTANTES O DISCREPANTES ---
        athletes.forEach(a => {
            const cRut = cleanRut(a.rut);
            if (a.status !== 'INACTIVO' && a.status !== 'RETIRADO') {
                if (!cRut || cRut.length < 8) {
                    alerts.push({
                        id: `rut-missing-${a.id}`,
                        type: 'RUT',
                        severity: 'CRITICAL',
                        title: `RUT Faltante o Inválido: ${a.full_name}`,
                        subtitle: `${a.category} • ${a.agrupacion}`,
                        description: `El deportista ${a.full_name} figura en la base de datos sin un RUT válido (registrado como: "${a.rut || 'vacío'}").`,
                        suggestion: `Ingresar el RUT oficial para que las transferencias bancarias de su familia puedan conciliarse automáticamente.`,
                        quick_fix: null,
                        meta: { athlete_id: a.id, athlete_name: a.full_name }
                    });
                }
            }

            // Casos conocidos específicos con solución inmediata
            if (a.id === 235 || (a.first_name.includes('Tomás') && a.last_name.includes('Hernández'))) {
                if (cRut === '251709653') {
                    alerts.push({
                        id: `rut-fix-tomas-${a.id}`,
                        type: 'RUT',
                        severity: 'CRITICAL',
                        title: `Transposición de Dígitos: Tomás Alonso Hernández Licandeo`,
                        subtitle: `${a.category} • RUT actual: 25.170.965-3`,
                        description: `En la base de datos figura con RUT 25.170.965-3, pero en el Formulario oficial su RUT es 25.170.956-3 (dígitos 65 invertidos).`,
                        suggestion: `Corregir el RUT a 25.170.956-3 para asegurar la conciliación bancaria.`,
                        quick_fix: {
                            action: 'fix_rut',
                            label: 'Corregir a 25.170.956-3',
                            payload: { athlete_id: a.id, new_rut: '251709563' }
                        },
                        meta: { athlete_id: a.id }
                    });
                }
            }
            if (a.id === 122 || (a.first_name.includes('Karla') && a.last_name.includes('Conejeros'))) {
                if (cRut === '26918146') {
                    alerts.push({
                        id: `rut-fix-karla-${a.id}`,
                        type: 'RUT',
                        severity: 'CRITICAL',
                        title: `Dígito Verificador Faltante: Karla Constanza Conejeros Soto`,
                        subtitle: `${a.category} • RUT actual: 26918146`,
                        description: `El RUT guardado no tiene el dígito verificador. Su RUT oficial según el Formulario de Ingreso es 26.918.146-K.`,
                        suggestion: `Actualizar con el dígito verificador 'K'.`,
                        quick_fix: {
                            action: 'fix_rut',
                            label: 'Corregir a 26.918.146-K',
                            payload: { athlete_id: a.id, new_rut: '26918146K' }
                        },
                        meta: { athlete_id: a.id }
                    });
                }
            }
        });

        // --- ALERTA 2: INCONSISTENCIAS DE EDAD VS CATEGORÍA ---
        const ageChecks = [
            {
                name: 'Isabella Andrea Aguilera Sandoval',
                birthDate: '2016-09-22',
                currentCat: 'U13 Damas F',
                suggestedCat: 'Mini Vóley / U10',
                age: 10,
                desc: 'Tiene 10 años (nació el 22-09-2016). Figura en U13 Damas F pagando arancel de $50.000 cuando por edad le corresponde Mini Vóley ($36.000).'
            },
            {
                name: 'Anastasia Catalina Toledo Bello',
                birthDate: '2017-09-29',
                currentCat: 'U12 Damas F',
                suggestedCat: 'Mini Vóley / U10',
                age: 9,
                desc: 'Tiene 9 años (nació el 29-09-2017). Figura en U12 Damas F pagando $50.000 cuando por edad corresponde Mini Vóley ($36.000).'
            }
        ];

        ageChecks.forEach(ac => {
            const matchAth = athletes.find(a => cleanStr(a.full_name).includes(cleanStr(ac.name)));
            if (matchAth) {
                alerts.push({
                    id: `age-mismatch-${matchAth.id}`,
                    type: 'EDAD',
                    severity: 'WARNING',
                    title: `Desajuste de Edad: ${matchAth.full_name} (${ac.age} años)`,
                    subtitle: `Categoría actual: ${matchAth.category} ➔ Sugerida: ${ac.suggestedCat}`,
                    description: ac.desc,
                    suggestion: `Evaluar reasignar a ${ac.suggestedCat} o confirmar si entrena en categoría superior por decisión técnica.`,
                    quick_fix: null,
                    meta: { athlete_id: matchAth.id }
                });
            }
        });

        // --- ALERTA 3: TELÉFONOS DE CONTACTO Y RESCATE DE APODERADOS ---
        athletes.forEach(a => {
            if (a.status === 'ACTIVO') {
                const hasOwnPhone = !!(a.phone && a.phone.trim());
                const hasApoPhone = !!(a.apoderado_phone && a.apoderado_phone.trim());

                if (!hasOwnPhone && !hasApoPhone) {
                    alerts.push({
                        id: `phone-none-${a.id}`,
                        type: 'TELEFONO',
                        severity: 'WARNING',
                        title: `Sin Teléfono de Contacto: ${a.full_name}`,
                        subtitle: `${a.category} • ${a.agrupacion}`,
                        description: `El deportista no tiene registrado ningún número de celular (ni del alumno ni del apoderado).`,
                        suggestion: `Solicitar número telefónico para permitir cobranza y avisos de entrenamientos.`,
                        quick_fix: null,
                        meta: { athlete_id: a.id }
                    });
                }
            }
        });

        const phoneBackfills = [
            { name: 'Martina Ignacia Asencio Hernandez', parent: 'Pamela Hernández (Mamá)', phone: '910137528' },
            { name: 'Sofía Denise Cheuquemán Igor', parent: 'Abigail Igor (Mamá)', phone: '952335122' },
            { name: 'Josefa Leonor Miranda Barria', parent: 'Argenis Tayl (Papá)', phone: '964645229' },
            { name: 'Amanda Trinidad Pizarro Walther', parent: 'Sebastián Pizarro (Papá)', phone: '993214588' },
            { name: 'Pascale Emilia Barria Subiabre', parent: 'Evadio Barría (Apoderado)', phone: '975685842' }
        ];

        phoneBackfills.forEach((pb, idx) => {
            const matchAth = athletes.find(a => cleanStr(a.full_name).includes(cleanStr(pb.name)));
            if (matchAth && (!matchAth.apoderado_phone || !matchAth.apoderado_phone.trim())) {
                alerts.push({
                    id: `phone-backfill-${idx}`,
                    type: 'TELEFONO',
                    severity: 'INFO',
                    title: `Teléfono Rescatable: ${matchAth.full_name}`,
                    subtitle: `Apoderado: ${pb.parent} • Celular: ${pb.phone}`,
                    description: `El teléfono del apoderado está disponible en el Formulario de Ingreso pero no se ha cargado en la ficha del sistema.`,
                    suggestion: `Guardar ${pb.phone} en la ficha del alumno para habilitar botón de WhatsApp.`,
                    quick_fix: {
                        action: 'backfill_phone',
                        label: `Guardar ${pb.phone}`,
                        payload: { athlete_id: matchAth.id, apoderado_phone: pb.phone }
                    },
                    meta: { athlete_id: matchAth.id, phone: pb.phone }
                });
            }
        });

        // --- ALERTA 4: MOVIMIENTOS POR ASIGNAR CON COINCIDENCIA FAMILIAR ---
        const familyMatches = [
            { payerName: 'PAMELA HERNANDEZ', studentName: 'Martina Ignacia Asencio Hernandez', concept: 'MENSUALIDAD', note: 'Madre del Formulario' },
            { payerName: 'Argenis Guillermo Tayl', studentName: 'Josefa Leonor Miranda Barria', concept: 'MENSUALIDAD', note: 'Padre del Formulario' },
            { payerName: 'ODONTOLOG', studentName: 'Amanda Trinidad Pizarro Walther', concept: 'MENSUALIDAD', note: 'Clínica de Apoderado Sebastián Pizarro' },
            { payerName: 'EVADIO ALEJANDRO', studentName: 'Pascale Emilia Barria Subiabre', concept: 'MENSUALIDAD', note: 'Apoderado en Formulario' }
        ];

        movements.filter(m => !m.athlete_id || m.status === 'PENDIENTE').forEach(m => {
            const pName = (m.payer_name || '').toUpperCase();
            familyMatches.forEach(fm => {
                if (pName.includes(fm.payerName.toUpperCase())) {
                    const matchAth = athletes.find(a => cleanStr(a.full_name).includes(cleanStr(fm.studentName)));
                    if (matchAth) {
                        alerts.push({
                            id: `mov-fam-match-${m.id}`,
                            type: 'MOVIMIENTO',
                            severity: 'INFO',
                            title: `Match Familiar: Pago de $${cleanAmount(m.amount).toLocaleString('es-CL')} (${m.payer_name})`,
                            subtitle: `Coincide con apoderado de: ${matchAth.full_name} (${matchAth.category})`,
                            description: `Transferencia recibida de "${m.payer_name}" por $${cleanAmount(m.amount).toLocaleString('es-CL')} el día ${m.date}. La persona pagadora corresponde a ${fm.note} de ${matchAth.full_name}.`,
                            suggestion: `Asignar directamente este pago a ${matchAth.full_name}.`,
                            quick_fix: {
                                action: 'assign_movement',
                                label: `Asignar a ${matchAth.first_name}`,
                                payload: { movement_id: m.id, athlete_id: matchAth.id, concept: fm.concept }
                            },
                            meta: { movement_id: m.id, athlete_id: matchAth.id }
                        });
                    }
                }
            });

            if (pName.includes('CLUB DEPORTIVO VOLLEY VALDIVIA') || pName.includes('VALDIVIA')) {
                alerts.push({
                    id: `mov-institucional-${m.id}`,
                    type: 'MOVIMIENTO',
                    severity: 'WARNING',
                    title: `Pago Institucional Externo: ${m.payer_name} ($${cleanAmount(m.amount).toLocaleString('es-CL')})`,
                    subtitle: `Transferencia de Club Externo (no pertenece a un alumno particular)`,
                    description: `Transferencia de $${cleanAmount(m.amount).toLocaleString('es-CL')} recibida desde el Club Deportivo Volley Valdivia por concepto de campeonato/torneo. No debe ser asignada a un niño.`,
                    suggestion: `Clasificar como Campeonato / Inscripción Visita general.`,
                    quick_fix: {
                        action: 'reclassify_movement',
                        label: 'Marcar como Campeonato',
                        payload: { movement_id: m.id, new_concept: 'CAMPEONATO' }
                    },
                    meta: { movement_id: m.id }
                });
            }
        });

        // --- ALERTA 5: CAMPEONATOS CLASIFICADOS COMO MENSUALIDAD ---
        movements.forEach(m => {
            if (m.category_concept === 'MENSUALIDAD') {
                const notesStr = `${m.notes || ''} ${m.payer_name || ''}`.toLowerCase();
                const amt = parseFloat(m.amount) || 0;
                const isChampionship = notesStr.includes('torneo') || notesStr.includes('camp') || notesStr.includes('liname') || notesStr.includes('copa') || notesStr.includes('team val');
                if (isChampionship || (amt > 0 && amt <= 24000 && amt !== 17500)) {
                    alerts.push({
                        id: `champ-misclass-${m.id}`,
                        type: 'MOVIMIENTO',
                        severity: 'WARNING',
                        title: `Posible Campeonato etiquetado como Mensualidad: $${cleanAmount(amt).toLocaleString('es-CL')}`,
                        subtitle: `Alumno: ${m.athlete_name || 'Sin Asignar'} • Glosa: "${m.notes || '-'}"`,
                        description: `El pago de $${cleanAmount(amt).toLocaleString('es-CL')} el ${m.date} tiene glosa o monto típico de campeonato/torneo ("${m.notes || ''}"), pero está contabilizado como Mensualidad, distorsionando la barra de cobranza.`,
                        suggestion: `Reclasificar este pago a CAMPEONATO para mantener las mensualidades exactas.`,
                        quick_fix: {
                            action: 'reclassify_movement',
                            label: 'Convertir a Campeonato',
                            payload: { movement_id: m.id, new_concept: 'CAMPEONATO' }
                        },
                        meta: { movement_id: m.id }
                    });
                }
            }
        });

        // --- ALERTA 6: ALUMNO EN PLANILLA VALE NO REGISTRADO EN BD ---
        const missingAthletes = [
            {
                name: 'Josue David Perez Chacón',
                category: 'TC Varones M',
                monthly_fee: 35000,
                notes: 'Figura en hoja COBRANZA VALE con deuda Ago-Sept pero no existía en la base de datos de alumnos.'
            }
        ];

        missingAthletes.forEach((ma, idx) => {
            const exists = athletes.find(a => cleanStr(a.full_name).includes(cleanStr(ma.name)));
            if (!exists) {
                alerts.push({
                    id: `missing-ath-${idx}`,
                    type: 'ALUMNO_FALTANTE',
                    severity: 'CRITICAL',
                    title: `Deportista en Planilla no creado en Base de Datos: ${ma.name}`,
                    subtitle: `${ma.category} • Cuota: $35.000`,
                    description: ma.notes,
                    suggestion: `Dar de alta al alumno en el sistema para asignarle su deuda y registrar sus pagos.`,
                    quick_fix: {
                        action: 'create_missing_athlete',
                        label: `Dar de alta a ${ma.name}`,
                        payload: {
                            first_name: 'Josue David',
                            last_name: 'Perez Chacón',
                            category: ma.category,
                            monthly_fee: ma.monthly_fee,
                            notes: ma.notes
                        }
                    },
                    meta: { athlete_name: ma.name }
                });
            }
        });

        // --- ALERTA 7: APODERADOS CON MÚLTIPLES HIJOS (MONITOREO) ---
        const multiPayerMap = new Map();
        athletes.forEach(a => {
            (a.payer_ruts || []).forEach(r => {
                const cRut = cleanRut(r.payer_rut);
                if (!cRut) return;
                if (!multiPayerMap.has(cRut)) {
                    multiPayerMap.set(cRut, {
                        rut: formatRut(cRut),
                        payer_name: r.payer_name || 'Desconocido',
                        athletes: []
                    });
                }
                const entry = multiPayerMap.get(cRut);
                if (!entry.athletes.find(x => x.id === a.id)) {
                    entry.athletes.push({ id: a.id, name: a.full_name, category: a.category });
                }
            });
        });

        for (const [cRut, data] of multiPayerMap.entries()) {
            if (data.athletes.length > 1) {
                const names = data.athletes.map(x => `${x.name} (${x.category})`).join(', ');
                alerts.push({
                    id: `multi-payer-${cRut}`,
                    type: 'MULTI_PAGADOR',
                    severity: 'MONITOR',
                    title: `Apoderado con Múltiples Alumnos: ${data.payer_name}`,
                    subtitle: `RUT: ${data.rut} • ${data.athletes.length} alumnos vinculados`,
                    description: `Este pagador responde por ${data.athletes.length} deportistas: ${names}. Cuando transfiera, el sistema solicitará confirmar a cuál de ellos imputar el pago o si se debe dividir.`,
                    suggestion: `Monitoreo preventivo: verificar que las transferencias no se asignen por error a un solo hermano.`,
                    quick_fix: null,
                    meta: { payer_rut: data.rut, athletes: data.athletes }
                });
            }
        }

        // Resumen
        const summary = {
            total_alerts: alerts.length,
            critical_count: alerts.filter(a => a.severity === 'CRITICAL').length,
            warning_count: alerts.filter(a => a.severity === 'WARNING').length,
            info_count: alerts.filter(a => a.severity === 'INFO').length,
            monitor_count: alerts.filter(a => a.severity === 'MONITOR').length
        };

        res.json({
            period: currentPeriod,
            summary,
            alerts
        });
    } catch (err) {
        console.error('Error al generar auditoría integral:', err);
        res.status(500).json({ error: 'Error al generar informe de auditoría', details: err.message });
    }
};

// 13. Resolver / Aplicar Corrección Rápida desde Panel de Auditoría
exports.quickFixAuditItem = async (req, res) => {
    try {
        const { action, payload } = req.body;
        if (!action || !payload) {
            return res.status(400).json({ error: 'Acción y datos requeridos' });
        }

        if (action === 'fix_rut') {
            const { athlete_id, new_rut } = payload;
            await pool.query('UPDATE athletes SET rut = $1 WHERE id = $2', [cleanRut(new_rut), athlete_id]);
            return res.json({ success: true, message: `RUT actualizado correctamente a ${formatRut(new_rut)}` });
        }

        if (action === 'backfill_phone') {
            const { athlete_id, apoderado_phone } = payload;
            await pool.query('UPDATE athletes SET apoderado_phone = $1 WHERE id = $2', [apoderado_phone, athlete_id]);
            return res.json({ success: true, message: 'Teléfono de contacto actualizado correctamente' });
        }

        if (action === 'reclassify_movement') {
            const { movement_id, new_concept } = payload;
            const targetConcept = new_concept || 'CAMPEONATO';
            await pool.query('UPDATE bank_movements SET category_concept = $1, status = $2 WHERE id = $3', [targetConcept, 'CONCILIADO', movement_id]);
            await pool.query(`
                INSERT INTO payment_audit_logs (movement_id, action, amount, payer_name, payer_rut, concept_before, concept_after, notes)
                VALUES ($1, 'EDICION', 0, 'Auditoría', '', 'MENSUALIDAD', $2, 'Reclasificado desde Panel de Auditoría')
            `, [movement_id, targetConcept]).catch(() => {});
            return res.json({ success: true, message: `Pago reclasificado exitosamente como ${targetConcept}` });
        }

        if (action === 'create_missing_athlete') {
            const { first_name, last_name, category, monthly_fee, notes } = payload;
            const ins = await pool.query(`
                INSERT INTO athletes (first_name, last_name, category, monthly_fee, status, join_date, notes)
                VALUES ($1, $2, $3, $4, 'ACTIVO', '2026-08-01', $5)
                RETURNING *
            `, [first_name, last_name, category || 'TC Varones M', monthly_fee || 35000, notes || 'Ingresado desde Hoja COBRANZA VALE']);
            return res.json({ success: true, message: `Alumno ${first_name} ${last_name} dado de alta exitosamente`, athlete: ins.rows[0] });
        }

        if (action === 'assign_movement') {
            const { movement_id, athlete_id, concept } = payload;
            await pool.query(`
                UPDATE bank_movements 
                SET athlete_id = $1, category_concept = $2, status = 'CONCILIADO'
                WHERE id = $3
            `, [athlete_id, concept || 'MENSUALIDAD', movement_id]);
            return res.json({ success: true, message: 'Movimiento asignado exitosamente al alumno' });
        }

        return res.status(400).json({ error: 'Acción no reconocida' });
    } catch (e) {
        console.error('Error en quickFixAuditItem:', e);
        res.status(500).json({ error: 'Error al aplicar corrección', details: e.message });
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
        const payPeriod = period || getCurrentSystemPeriod();
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

        updateFields.push('updated_at = CURRENT_TIMESTAMP');
        params.push(id);
        const query = `UPDATE bank_movements SET ${updateFields.join(', ')} WHERE id = $${pIdx} RETURNING *`;
        const result = await pool.query(query, params);

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Movimiento no encontrado' });
        }

        const up = result.rows[0];
        let athName = null;
        if (up.athlete_id) {
            const athR = await pool.query('SELECT first_name, last_name FROM athletes WHERE id = $1', [up.athlete_id]);
            if (athR.rows.length > 0) athName = `${athR.rows[0].first_name} ${athR.rows[0].last_name}`;
        }
        await logPaymentModification({
            movement_id: id,
            action: 'EDICION',
            athlete_id: up.athlete_id,
            athlete_name: athName,
            payer_rut: up.payer_rut,
            payer_name: up.payer_name,
            amount: up.amount,
            concept_before: null,
            concept_after: up.category_concept,
            notes: up.notes
        });

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
            const splitConcept = s.concept || 'MENSUALIDAD';
            const hasAth = !!s.athlete_id;
            const isConciliado = hasAth || (splitConcept !== 'POR_DEFINIR' && splitConcept !== 'EXTRA' && splitConcept !== 'MENSUALIDAD');
            const insRes = await pool.query(
                `INSERT INTO bank_movements 
                 (date, transfer_type, account_dest, payer_rut, payer_name, bank_origin, account_origin, amount, athlete_id, period, category_concept, status, notes, updated_at)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, CURRENT_TIMESTAMP) RETURNING *`,
                [
                    orig.date, orig.transfer_type, orig.account_dest, orig.payer_rut, orig.payer_name,
                    orig.bank_origin, orig.account_origin, cleanAmount(s.amount),
                    hasAth ? parseInt(s.athlete_id, 10) : null,
                    s.period || orig.period,
                    splitConcept,
                    isConciliado ? 'CONCILIADO' : 'PENDIENTE',
                    s.notes || `Desglose de movimiento #${orig.id}`
                ]
            );
            createdSplits.push(insRes.rows[0]);
        }

        // Registrar en auditoría
        await logPaymentModification({
            movement_id: movement_id,
            action: 'SPLIT',
            athlete_id: null,
            athlete_name: null,
            payer_rut: orig.payer_rut,
            payer_name: orig.payer_name,
            amount: orig.amount,
            concept_before: orig.category_concept,
            concept_after: 'DIVIDIDO',
            notes: `Dividido en ${splits.length} partes`
        });

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

// 14. Obtener las últimas modificaciones de pagos
exports.getRecentModifications = async (req, res) => {
    try {
        await ensureAuditTable();
        const logsRes = await pool.query(`
            SELECT 
                l.id,
                l.movement_id,
                l.action,
                l.athlete_id,
                COALESCE(l.athlete_name, a.first_name || ' ' || a.last_name) as athlete_name,
                a.category as athlete_category,
                l.payer_rut,
                l.payer_name,
                COALESCE(m.amount, CASE WHEN l.amount >= 1000000 AND (l.amount % 100 = 0) THEN l.amount / 100 ELSE l.amount END) as amount,
                l.concept_before,
                l.concept_after,
                l.notes,
                l.created_at
            FROM payment_audit_logs l
            LEFT JOIN athletes a ON l.athlete_id = a.id
            LEFT JOIN bank_movements m ON l.movement_id = m.id
            ORDER BY l.created_at DESC
            LIMIT 50
        `);

        let logs = logsRes.rows;
        if (logs.length < 15) {
            const fallbackRes = await pool.query(`
                SELECT 
                    m.id as movement_id,
                    CASE 
                        WHEN m.category_concept = 'MENSUALIDAD' THEN 'MENSUALIDAD'
                        WHEN m.notes ILIKE '%Desglose%' THEN 'SPLIT'
                        ELSE 'ASIGNACION'
                    END as action,
                    m.athlete_id,
                    a.first_name || ' ' || a.last_name as athlete_name,
                    a.category as athlete_category,
                    m.payer_rut,
                    m.payer_name,
                    m.amount,
                    'POR_DEFINIR' as concept_before,
                    m.category_concept as concept_after,
                    m.notes,
                    COALESCE(m.updated_at, m.created_at) as created_at
                FROM bank_movements m
                LEFT JOIN athletes a ON m.athlete_id = a.id
                WHERE m.athlete_id IS NOT NULL OR m.status = 'CONCILIADO'
                ORDER BY COALESCE(m.updated_at, m.created_at) DESC
                LIMIT 30
            `);

            const existingIds = new Set(logs.map(l => l.movement_id));
            fallbackRes.rows.forEach(fb => {
                if (!existingIds.has(fb.movement_id)) {
                    logs.push(fb);
                }
            });
            logs.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
        }

        res.json({
            modifications: logs.slice(0, 50).map(l => ({
                ...l,
                formatted_rut: formatRut(l.payer_rut || '')
            }))
        });
    } catch (err) {
        console.error('Error al consultar últimas modificaciones:', err);
        res.status(500).json({ error: 'Error al consultar modificaciones', details: err.message });
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
        const payPeriod = period || getCurrentSystemPeriod();
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
        const currentPeriod = period || getCurrentSystemPeriod();
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
            [date || new Date(), period || getCurrentSystemPeriod(), category || 'OTROS', beneficiary.trim(), cleanAmt, payment_method || 'TRANSFERENCIA', receipt_number || '', notes || '']
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

