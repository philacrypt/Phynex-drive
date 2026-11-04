const { pool } = require('../database');

async function getDriver(firebaseUid) {
    const result = await pool.query(`
        SELECT p.firebase_uid AS id, p.display_name AS "displayName", p.phone,
            (
                d.online
                AND d.last_location_at > CURRENT_TIMESTAMP - INTERVAL '2 minutes'
            ) AS online
        FROM drivers d
        JOIN profiles p ON p.firebase_uid = d.firebase_uid
        WHERE d.firebase_uid = $1 AND p.role = 'driver'
    `, [firebaseUid]);
    return result.rows[0] || null;
}

async function setOnline(firebaseUid, online, location) {
    const result = await pool.query(`
        UPDATE drivers
        SET online = $2,
            latitude = CASE WHEN $2 THEN $3 ELSE latitude END,
            longitude = CASE WHEN $2 THEN $4 ELSE longitude END,
            last_location_at = CASE WHEN $2 THEN CURRENT_TIMESTAMP ELSE last_location_at END
        WHERE firebase_uid = $1
        RETURNING firebase_uid AS id, online
    `, [firebaseUid, online, location?.latitude ?? null, location?.longitude ?? null]);
    return result.rows[0] || null;
}

async function updateLocation(firebaseUid, latitude, longitude) {
    const result = await pool.query(`
        UPDATE drivers
        SET latitude = $2, longitude = $3, last_location_at = CURRENT_TIMESTAMP
        WHERE firebase_uid = $1 AND online = TRUE
        RETURNING firebase_uid AS id
    `, [firebaseUid, latitude, longitude]);
    return result.rowCount;
}

async function getSummary() {
    const result = await pool.query(`
        SELECT COUNT(*)::INTEGER AS "totalDrivers",
            COUNT(*) FILTER (
                WHERE online AND last_location_at > CURRENT_TIMESTAMP - INTERVAL '2 minutes'
            )::INTEGER AS "onlineDrivers"
        FROM drivers
        JOIN profiles USING (firebase_uid)
        WHERE profiles.role = 'driver'
    `);
    return result.rows[0];
}

async function getDriverStats(firebaseUid) {
    const result = await pool.query(`
        SELECT COUNT(*) FILTER (
                WHERE rides.status IN ('accepted', 'en_route', 'in_progress')
            )::INTEGER AS "activeRides",
            COALESCE(SUM(rides.fare_ksh) FILTER (WHERE rides.status = 'completed'), 0)::INTEGER AS "completedFares"
        FROM rides
        WHERE rides.driver_uid = $1
    `, [firebaseUid]);
    return result.rows[0];
}

module.exports = { getDriver, getDriverStats, getSummary, setOnline, updateLocation };
