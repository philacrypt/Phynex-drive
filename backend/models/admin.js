const { pool } = require('../database');

async function getSummary() {
    const [rideResult, driverResult] = await Promise.all([
        pool.query(`
            SELECT COUNT(*)::INTEGER AS "totalRides",
                COUNT(*) FILTER (WHERE status = 'requested')::INTEGER AS "requestedRides",
                COUNT(*) FILTER (WHERE status IN ('accepted', 'en_route', 'in_progress'))::INTEGER AS "activeRides",
                COUNT(*) FILTER (WHERE status = 'completed')::INTEGER AS "completedRides",
                COUNT(*) FILTER (WHERE status = 'cancelled')::INTEGER AS "cancelledRides",
                COALESCE(SUM(fare_ksh) FILTER (WHERE status = 'completed'), 0)::INTEGER AS "revenueKsh"
            FROM rides
        `),
        pool.query(`
            SELECT COUNT(*)::INTEGER AS "totalDrivers",
                COUNT(*) FILTER (
                    WHERE drivers.online
                        AND drivers.last_location_at > CURRENT_TIMESTAMP - INTERVAL '2 minutes'
                )::INTEGER AS "onlineDrivers"
            FROM drivers
            JOIN profiles USING (firebase_uid)
            WHERE profiles.role = 'driver'
        `)
    ]);
    return { ...rideResult.rows[0], ...driverResult.rows[0] };
}

module.exports = { getSummary };
