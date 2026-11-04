const { pool } = require('../database');

async function getForCustomerRide(rideId, customerUid) {
    const result = await pool.query(`
        SELECT payments.id, payments.ride_id AS "rideId", payments.method, payments.status,
            payments.amount_ksh AS "amountKsh", payments.mpesa_receipt AS "mpesaReceipt",
            profiles.phone AS "customerPhone"
        FROM payments
        JOIN profiles ON profiles.firebase_uid = payments.customer_uid
        WHERE payments.ride_id = $1 AND payments.customer_uid = $2
        ORDER BY created_at DESC
        LIMIT 1
    `, [rideId, customerUid]);
    return result.rows[0] || null;
}

async function setCheckoutDetails(paymentId, checkout) {
    const result = await pool.query(`
        UPDATE payments
        SET merchant_request_id = $2,
            checkout_request_id = $3,
            updated_at = CURRENT_TIMESTAMP
        WHERE id = $1 AND status = 'pending'
        RETURNING id
    `, [paymentId, checkout.merchantRequestId, checkout.checkoutRequestId]);
    return result.rowCount;
}

async function findByCheckoutRequestId(checkoutRequestId) {
    const result = await pool.query(`
        SELECT id, ride_id AS "rideId", customer_uid AS "customerUid",
            method, status, amount_ksh AS "amountKsh"
        FROM payments
        WHERE checkout_request_id = $1
    `, [checkoutRequestId]);
    return result.rows[0] || null;
}

async function markFailed(paymentId) {
    await pool.query(`
        UPDATE payments SET status = 'failed', updated_at = CURRENT_TIMESTAMP
        WHERE id = $1 AND status = 'pending'
    `, [paymentId]);
}

async function markPaid(paymentId, receipt) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const ride = await client.query(`
            SELECT ride_id AS id FROM payments WHERE id = $1
        `, [paymentId]);
        if (!ride.rowCount) {
            await client.query('ROLLBACK');
            return false;
        }
        await client.query('SELECT id FROM rides WHERE id = $1 FOR UPDATE', [ride.rows[0].id]);
        const payment = await client.query(`
            SELECT ride_id AS "rideId", status FROM payments
            WHERE id = $1 FOR UPDATE
        `, [paymentId]);
        if (payment.rows[0].status === 'paid') {
            await client.query('COMMIT');
            return true;
        }
        await client.query(`
            UPDATE payments
            SET status = 'paid', mpesa_receipt = $2, updated_at = CURRENT_TIMESTAMP
            WHERE id = $1 AND status = 'pending'
        `, [paymentId, receipt]);
        const preferred = await client.query(`
            SELECT preferred_driver_uid AS id
            FROM rides
            WHERE id = $1 AND status = 'requested'
                AND preferred_driver_uid IS NOT NULL
            FOR UPDATE
        `, [payment.rows[0].rideId]);
        if (preferred.rowCount) {
            const driver = await client.query(`
                SELECT firebase_uid
                FROM drivers
                WHERE firebase_uid = $1 AND online = TRUE
                    AND last_location_at > CURRENT_TIMESTAMP - INTERVAL '2 minutes'
                    AND NOT EXISTS (
                        SELECT 1 FROM rides active
                        WHERE active.driver_uid = $1
                            AND active.status IN ('accepted', 'en_route', 'in_progress')
                    )
                FOR UPDATE
            `, [preferred.rows[0].id]);
            if (driver.rowCount) {
                await client.query(`
                    UPDATE rides
                    SET status = 'accepted', driver_uid = $2,
                        preferred_driver_uid = NULL, accepted_at = CURRENT_TIMESTAMP
                    WHERE id = $1 AND status = 'requested'
                `, [payment.rows[0].rideId, preferred.rows[0].id]);
            } else {
                await client.query(`
                    UPDATE rides SET preferred_driver_uid = NULL
                    WHERE id = $1 AND status = 'requested'
                `, [payment.rows[0].rideId]);
            }
        }
        await client.query('COMMIT');
        return true;
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
}

module.exports = {
    findByCheckoutRequestId,
    getForCustomerRide,
    markFailed,
    markPaid,
    setCheckoutDetails
};
