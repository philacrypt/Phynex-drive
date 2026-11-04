const fs = require('node:fs');
const path = require('node:path');
const { cert, getApps, initializeApp } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const profileModel = require('../models/profiles');

let firebaseAuth;

function getFirebaseAuth() {
    if (firebaseAuth) return firebaseAuth;
    const serviceAccountPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH;
    if (!serviceAccountPath) {
        const error = new Error('Firebase phone authentication is not configured.');
        error.status = 503;
        throw error;
    }

    const resolvedPath = path.resolve(serviceAccountPath);
    if (!fs.existsSync(resolvedPath)) {
        const error = new Error('Firebase service-account file was not found on the server.');
        error.status = 503;
        throw error;
    }

    const serviceAccount = JSON.parse(fs.readFileSync(resolvedPath, 'utf8'));
    const app = getApps()[0] || initializeApp({ credential: cert(serviceAccount) });
    firebaseAuth = getAuth(app);
    return firebaseAuth;
}

async function authenticate(req, res, next) {
    const header = req.get('authorization') || '';
    const match = /^Bearer ([^\s]+)$/.exec(header);
    if (!match) return res.status(401).json({ error: 'Sign in with your verified phone number to continue.' });

    try {
        const decodedToken = await getFirebaseAuth().verifyIdToken(match[1], true);
        req.profile = await profileModel.upsertFromFirebase(decodedToken);
        return next();
    } catch (error) {
        if (Number.isInteger(error.status)) {
            return res.status(error.status).json({ error: error.message });
        }
        if (typeof error.code === 'string' && error.code.startsWith('auth/')) {
            return res.status(401).json({ error: 'Your sign-in has expired. Verify your phone number again.' });
        }
        return next(error);
    }
}

function requireRole(...roles) {
    return (req, res, next) => {
        if (!req.profile || !roles.includes(req.profile.role)) {
            return res.status(403).json({ error: 'Your account does not have access to this area.' });
        }
        return next();
    };
}

module.exports = { authenticate, requireRole };
