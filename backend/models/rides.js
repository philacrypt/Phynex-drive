const { pool } = require('../database');

const rideColumns = `
    r.id,
    r.customer_uid AS "customerUid",
    customer.display_name AS "customerName",
    customer.phone AS "customerPhone",
    r.pickup,
    r.pickup_lat AS "pickupLat",
    r.pickup_lng AS "pickupLng",
    r.destination,
    r.destination_lat AS "destinationLat",
    r.destination_lng AS "destinationLng",
    r.vehicle_type AS "vehicleType",
    r.distance_km AS "distanceKm",
    r.fare_ksh AS "fareKsh",
    r.status,
    r.driver_uid AS "driverUid",
    driver.display_name AS "driverName",
    driver.phone AS "driverPhone",
    driver_record.latitude AS "driverLat",
    driver_record.longitude AS "driverLng",
    driver_record.last_location_at AS "driverLocationAt",
    r.created_at AS "createdAt",
    r.accepted_at AS "acceptedAt",
    r.started_at AS "startedAt",
    r.completed_at AS "completedAt",
    payment.method AS "paymentMethod",
    payment.status AS "paymentStatus",
    payment.mpesa_receipt AS "mpesaReceipt",
    (payment.checkout_request_id IS NOT NULL AND payment.status = 'pending') AS "paymentProcessing"
`;

const rideQuery = `
    SELECT ${rideColumns}
    FROM rides r
    JOIN profiles customer ON customer.firebase_uid = r.customer_uid
    LEFT JOIN profiles driver ON driver.firebase_uid = r.driver_uid
    LEFT JOIN drivers driver_record ON driver_record.firebase_uid = r.driver_uid
    LEFT JOIN LATERAL (
        SELECT method, status, mpesa_receipt, checkout_request_id
        FROM payments
        WHERE ride_id = r.id
        ORDER BY created_at DESC
        LIMIT 1
    ) payment ON TRUE
`;

async function createRide(input, customerUid) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        if (input.driverUid) {
            const driver = await client.query(`
                SELECT firebase_uid
                FROM drivers
                WHERE firebase_uid = $1 AND online = TRUE
                    AND last_location_at > CURRENT_TIMESTAMP - INTERVAL '2 minutes'
                FOR UPDATE
            `, [input.driverUid]);
            const activeRide = driver.rowCount ? await client.query(`
                SELECT id FROM rides
                WHERE driver_uid = $1
                    AND status IN ('accepted', 'en_route', 'in_progress')
                LIMIT 1
            `, [input.driverUid]) : null;
            if (!driver.rowCount || activeRide.rowCount) {
                const error = new Error('That driver is no longer available. Choose another driver or let PHYNEX find one.');
                error.status = 409;
                throw error;
            }
        }
        const inserted = await client.query(`
            INSERT INTO rides (
                customer_uid, pickup, pickup_lat, pickup_lng, destination,
                destination_lat, destination_lng, vehicle_type, distance_km, fare_ksh,
                preferred_driver_uid
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
            RETURNING id
        `, [
            customerUid,
            input.pickup,
            input.pickupLat,
            input.pickupLng,
            input.destination,
            input.destinationLat,
            input.destinationLng,
            input.vehicleType,
            input.distanceKm,
            input.fareKsh,
            input.paymentMethod === 'mpesa' ? input.driverUid || null : null
        ]);
        if (input.driverUid && input.paymentMethod === 'cash') {
            const assigned = await client.query(`
                UPDATE rides
                SET status = 'accepted', driver_uid = $1, accepted_at = CURRENT_TIMESTAMP
                WHERE id = $2 AND status = 'requested'
                    AND EXISTS (
                        SELECT 1 FROM drivers
                        WHERE firebase_uid = $1 AND online = TRUE
                            AND last_location_at > CURRENT_TIMESTAMP - INTERVAL '2 minutes'
                            AND NOT EXISTS (
                                SELECT 1 FROM rides active
                                WHERE active.driver_uid = $1
                                    AND active.status IN ('accepted', 'en_route', 'in_progress')
                            )
                    )
                RETURNING id
            `, [input.driverUid, inserted.rows[0].id]);
            if (!assigned.rowCount) {
                const error = new Error('That driver is no longer available. Choose another driver or let PHYNEX find one.');
                error.status = 409;
                throw error;
            }
        }
        await client.query(`
            INSERT INTO payments (ride_id, customer_uid, method, amount_ksh)
            VALUES ($1, $2, $3, $4)
        `, [inserted.rows[0].id, customerUid, input.paymentMethod, input.fareKsh]);
        await client.query('COMMIT');
        return getRide(inserted.rows[0].id);
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
}

async function getRide(id) {
    const result = await pool.query(`${rideQuery} WHERE r.id = $1`, [id]);
    return result.rows[0] || null;
}

async function getCustomerRide(id, customerUid) {
    const result = await pool.query(`${rideQuery} WHERE r.id = $1 AND r.customer_uid = $2`, [id, customerUid]);
    return result.rows[0] || null;
}

async function listCustomerRides(customerUid, limit = 50) {
    const result = await pool.query(`
        ${rideQuery}
        WHERE r.customer_uid = $1
        ORDER BY r.created_at DESC
        LIMIT $2
    `, [customerUid, limit]);
    return result.rows;
}

async function listRides({ status, limit = 100, availableForDrivers = false } = {}) {
    const conditions = [];
    const values = [];
    if (status) {
        values.push(status);
        conditions.push(`r.status = $${values.length}`);
    }
    if (availableForDrivers) {
        conditions.push(`(
            payment.method = 'cash'
            OR (payment.method = 'mpesa' AND payment.status = 'paid')
        )`);
    }
    values.push(limit);
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const result = await pool.query(`
        ${rideQuery}
        ${where}
        ORDER BY r.created_at DESC
        LIMIT $${values.length}
    `, values);
    return result.rows;
}

async function listAvailableDrivers(latitude, longitude, limit = 12) {
    const result = await pool.query(`
        SELECT profiles.firebase_uid AS id,
            profiles.display_name AS "displayName",
            ROUND((
                6371 * ACOS(LEAST(1, GREATEST(-1,
                    SIN(RADIANS($1)) * SIN(RADIANS(drivers.latitude))
                    + COS(RADIANS($1)) * COS(RADIANS(drivers.latitude))
                    * COS(RADIANS(drivers.longitude - $2))
                )))
            )::numeric, 1)::float AS "distanceKm"
        FROM drivers
        JOIN profiles ON profiles.firebase_uid = drivers.firebase_uid
        WHERE profiles.role = 'driver'
            AND drivers.online = TRUE
            AND drivers.last_location_at > CURRENT_TIMESTAMP - INTERVAL '2 minutes'
            AND NOT EXISTS (
                SELECT 1 FROM rides active
                WHERE active.driver_uid = drivers.firebase_uid
                    AND active.status IN ('accepted', 'en_route', 'in_progress')
            )
        ORDER BY "distanceKm", profiles.display_name
        LIMIT $3
    `, [latitude, longitude, limit]);
    return result.rows;
}

async function cancelRequestedRide(id, customerUid) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const update = await client.query(`
            UPDATE rides
            SET status = 'cancelled', cancelled_at = CURRENT_TIMESTAMP
            WHERE id = $1 AND customer_uid = $2 AND status = 'requested'
            RETURNING id
        `, [id, customerUid]);
        if (update.rowCount) {
            await client.query(`
                UPDATE payments
                SET status = 'failed', updated_at = CURRENT_TIMESTAMP
                WHERE ride_id = $1 AND status = 'pending'
            `, [id]);
        }
        await client.query('COMMIT');
        return update.rowCount;
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
}

async function assignRide(id, driverUid) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const driver = await client.query(`
            SELECT firebase_uid
            FROM drivers
            WHERE firebase_uid = $1 AND online = TRUE
                AND last_location_at > CURRENT_TIMESTAMP - INTERVAL '2 minutes'
            FOR UPDATE
        `, [driverUid]);
        if (!driver.rowCount) {
            await client.query('ROLLBACK');
            return 0;
        }
        const activeRide = await client.query(`
            SELECT id FROM rides
            WHERE driver_uid = $1
                AND status IN ('accepted', 'en_route', 'in_progress')
            LIMIT 1
        `, [driverUid]);
        if (activeRide.rowCount) {
            await client.query('ROLLBACK');
            return 0;
        }
        const result = await client.query(`
            UPDATE rides
            SET status = 'accepted', driver_uid = $1, accepted_at = CURRENT_TIMESTAMP
            WHERE id = $2 AND status = 'requested' AND driver_uid IS NULL
            RETURNING id
        `, [driverUid, id]);
        await client.query('COMMIT');
        return result.rowCount;
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
}

async function updateAssignedRideStatus(id, driverUid, currentStatus, nextStatus) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const ride = await client.query(`
            SELECT status FROM rides
            WHERE id = $1 AND driver_uid = $2
            FOR UPDATE
        `, [id, driverUid]);
        if (!ride.rowCount || ride.rows[0].status !== currentStatus) {
            await client.query('ROLLBACK');
            return { changes: 0 };
        }

        if (nextStatus === 'completed') {
            const payment = await client.query(`
                SELECT method, status FROM payments
                WHERE ride_id = $1 ORDER BY created_at DESC LIMIT 1
                FOR UPDATE
            `, [id]);
            if (!payment.rowCount || (payment.rows[0].method === 'mpesa' && payment.rows[0].status !== 'paid')) {
                await client.query('ROLLBACK');
                return { changes: 0, paymentRequired: true };
            }
            if (payment.rows[0].method === 'cash' && payment.rows[0].status === 'pending') {
                await client.query(`
                    UPDATE payments SET status = 'paid', updated_at = CURRENT_TIMESTAMP
                    WHERE ride_id = $1 AND status = 'pending'
                `, [id]);
            }
        }

        const result = await client.query(`
            UPDATE rides
            SET status = $1,
                started_at = CASE WHEN $1 = 'in_progress' THEN CURRENT_TIMESTAMP ELSE started_at END,
                completed_at = CASE WHEN $1 = 'completed' THEN CURRENT_TIMESTAMP ELSE completed_at END
            WHERE id = $2 AND driver_uid = $3 AND status = $4
            RETURNING id
        `, [nextStatus, id, driverUid, currentStatus]);
        await client.query('COMMIT');
        return { changes: result.rowCount };
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
}

async function listDriverRides(driverUid) {
    const result = await pool.query(`
        ${rideQuery}
        WHERE r.driver_uid = $1
            AND r.status IN ('accepted', 'en_route', 'in_progress')
        ORDER BY r.accepted_at DESC
    `, [driverUid]);
    return result.rows;
}

module.exports = {
    assignRide,
    cancelRequestedRide,
    createRide,
    getCustomerRide,
    getRide,
    listCustomerRides,
    listAvailableDrivers,
    listDriverRides,
    listRides,
    updateAssignedRideStatus
};
