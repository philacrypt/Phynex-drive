require('dotenv').config();

const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const helmet = require('helmet');
const { rateLimit } = require('express-rate-limit');
const { initializeDatabase, pool } = require('./database');
const { authenticate, requireRole } = require('./middleware/auth');
const paymentsController = require('./controllers/payments');
const mpesa = require('./services/mpesa');
const googleRoutes = require('./services/google-routes');
const fares = require('./services/fares');

const app = express();
const port = Number(process.env.PORT) || 3000;
const host = process.env.HOST || '127.0.0.1';
const projectRoot = path.join(__dirname, '..');
const frontendPath = path.join(projectRoot, 'Frontend');
const serviceAccountPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH
    ? path.resolve(process.env.FIREBASE_SERVICE_ACCOUNT_PATH)
    : '';
let databaseReady = false;

app.disable('x-powered-by');
app.set('trust proxy', process.env.TRUST_PROXY === 'true' ? 1 : false);
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            scriptSrc: [
                "'self'",
                "'unsafe-inline'",
                'https://www.gstatic.com',
                'https://maps.googleapis.com',
                'https://maps.gstatic.com',
                'https://www.google.com',
                'https://unpkg.com'
            ],
            styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com', 'https://maps.googleapis.com', 'https://unpkg.com'],
            imgSrc: ["'self'", 'data:', 'blob:', 'https://*.googleapis.com', 'https://*.gstatic.com', 'https://*.tile.openstreetmap.org'],
            connectSrc: [
                "'self'",
                'https://identitytoolkit.googleapis.com',
                'https://securetoken.googleapis.com',
                'https://*.googleapis.com',
                'https://www.googleapis.com',
                'https://nominatim.openstreetmap.org',
                'https://router.project-osrm.org'
            ],
            frameSrc: ["'self'", 'https://*.firebaseapp.com', 'https://www.google.com', 'https://recaptcha.google.com'],
            fontSrc: ["'self'", 'data:', 'https://fonts.gstatic.com'],
            objectSrc: ["'none'"],
            baseUri: ["'self'"],
            frameAncestors: ["'none'"]
        }
    }
}));
app.use(express.json({ limit: '20kb', strict: true }));

const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 1200,
    standardHeaders: 'draft-8',
    legacyHeaders: false
});
const signInLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 30,
    standardHeaders: 'draft-8',
    legacyHeaders: false
});
app.use('/api', apiLimiter);

app.get('/api/health', async (req, res) => {
    if (!databaseReady) {
        return res.status(503).json({
            status: 'not_ready',
            error: 'PostgreSQL is not configured or could not be reached. Check DATABASE_URL.'
        });
    }
    await pool.query('SELECT 1');
    res.json({ status: 'ok' });
});

app.get('/api/config', (req, res) => {
    const firebaseWebConfig = {
        apiKey: process.env.FIREBASE_WEB_API_KEY || '',
        authDomain: process.env.FIREBASE_AUTH_DOMAIN || '',
        projectId: process.env.FIREBASE_PROJECT_ID || '',
        appId: process.env.FIREBASE_APP_ID || ''
    };
    const firebaseReady = Object.values(firebaseWebConfig).every(Boolean)
        && Boolean(serviceAccountPath && fs.existsSync(serviceAccountPath));
    res.json({
        market: 'Nairobi, Kenya',
        currency: 'KES',
        databaseReady,
        firebaseReady,
        firebase: firebaseReady ? firebaseWebConfig : null,
        mapsReady: Boolean(process.env.GOOGLE_MAPS_BROWSER_API_KEY),
        mapsBrowserApiKey: process.env.GOOGLE_MAPS_BROWSER_API_KEY || '',
        routesReady: googleRoutes.isConfigured(),
        mpesaReady: mpesa.isConfigured(),
        fareRules: fares.getFareRules()
    });
});

function requireDatabase(req, res, next) {
    if (!databaseReady) {
        return res.status(503).json({
            error: 'The service database is not ready. Contact Phil-Ride support.'
        });
    }
    return next();
}

app.post(
    '/api/payments/mpesa/callback',
    signInLimiter,
    paymentsController.handleMpesaCallback
);

app.use('/api/auth', signInLimiter, requireDatabase, authenticate, require('./routes/auth'));
app.use('/api/rides', requireDatabase, authenticate, requireRole('customer'), require('./routes/rides'));
app.use('/api/driver', requireDatabase, authenticate, requireRole('driver'), require('./routes/drivers'));
app.use('/api/admin', requireDatabase, authenticate, requireRole('admin'), require('./routes/admin'));

app.get('/driver', (req, res) => {
    res.sendFile(path.join(projectRoot, 'driver-app', 'driver.html'));
});
app.get('/admin', (req, res) => {
    res.sendFile(path.join(projectRoot, 'admin-dashboard', 'admin.html'));
});
app.use('/driver-app', express.static(path.join(projectRoot, 'driver-app'), { etag: true }));
app.use('/admin-dashboard', express.static(path.join(projectRoot, 'admin-dashboard'), { etag: true }));
app.use(express.static(frontendPath, { etag: true }));

app.use((req, res) => {
    res.status(404).json({ error: 'Not found.' });
});

app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    const status = Number.isInteger(error.status)
        ? error.status
        : error.type === 'entity.parse.failed'
            ? 400
            : error.type === 'entity.too.large'
                ? 413
                : 500;
    if (status >= 500) console.error(error);
    const message = status >= 500 ? 'The server could not complete the request.' : error.message;
    res.status(status).json({ error: message });
});

async function start() {
    fares.getFareRules();
    try {
        await initializeDatabase();
        databaseReady = true;
        console.log('PostgreSQL schema is ready.');
    } catch (error) {
        console.error('Phil-Ride database is unavailable:', error.message);
    }
    app.listen(port, host, () => {
        console.log(`Phil-Ride listening on ${host}:${port}`);
    });
}

start().catch((error) => {
    console.error('Phil-Ride could not start:', error.message);
    process.exitCode = 1;
});
