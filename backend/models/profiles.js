const { pool } = require('../database');

const adminUids = new Set((process.env.ADMIN_UIDS || '').split(',').map((uid) => uid.trim()).filter(Boolean));
const driverUids = new Set((process.env.DRIVER_UIDS || '').split(',').map((uid) => uid.trim()).filter(Boolean));

function roleForUid(uid) {
    if (adminUids.has(uid)) return 'admin';
    if (driverUids.has(uid)) return 'driver';
    return 'customer';
}

async function upsertFromFirebase(decodedToken) {
    const role = roleForUid(decodedToken.uid);
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const result = await client.query(`
            INSERT INTO profiles (firebase_uid, phone, display_name, role)
            VALUES ($1, $2, $3, $4)
            ON CONFLICT (firebase_uid) DO UPDATE SET
                phone = EXCLUDED.phone,
                role = EXCLUDED.role,
                updated_at = CURRENT_TIMESTAMP
            RETURNING firebase_uid AS id, display_name AS "displayName", phone, role
        `, [
            decodedToken.uid,
            decodedToken.phone_number || '',
            typeof decodedToken.name === 'string' ? decodedToken.name : '',
            role
        ]);
        if (role === 'driver') {
            await client.query(`
                INSERT INTO drivers (firebase_uid) VALUES ($1)
                ON CONFLICT (firebase_uid) DO NOTHING
            `, [decodedToken.uid]);
        }
        await client.query('COMMIT');
        return result.rows[0];
    } catch (error) {
        await client.query('ROLLBACK');
        throw error;
    } finally {
        client.release();
    }
}

async function getProfile(uid) {
    const result = await pool.query(`
        SELECT firebase_uid AS id, display_name AS "displayName", phone, role
        FROM profiles WHERE firebase_uid = $1
    `, [uid]);
    return result.rows[0] || null;
}

async function updateDisplayName(uid, displayName) {
    const result = await pool.query(`
        UPDATE profiles
        SET display_name = $2, updated_at = CURRENT_TIMESTAMP
        WHERE firebase_uid = $1
        RETURNING firebase_uid AS id, display_name AS "displayName", phone, role
    `, [uid, displayName]);
    return result.rows[0] || null;
}

module.exports = { getProfile, roleForUid, updateDisplayName, upsertFromFirebase };
