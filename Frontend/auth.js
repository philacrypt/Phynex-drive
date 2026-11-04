const firebaseVersion = '11.10.0';

let firebaseAuth;
let firebaseApi;
let confirmationResult;
let recaptchaVerifier;
let authConfig;

async function loadAuth() {
    const response = await fetch('/api/config');
    if (!response.ok) throw new Error('Account sign-in settings could not be loaded.');
    authConfig = await response.json();
    if (!authConfig.firebaseReady) {
        return { config: authConfig, available: false };
    }

    const base = `https://www.gstatic.com/firebasejs/${firebaseVersion}`;
    const [appApi, authApi] = await Promise.all([
        import(`${base}/firebase-app.js`),
        import(`${base}/firebase-auth.js`)
    ]);
    const app = appApi.initializeApp(authConfig.firebase);
    firebaseAuth = authApi.getAuth(app);
    firebaseApi = authApi;
    return { config: authConfig, available: true };
}

export const authReady = loadAuth();

function currentUser() {
    return new Promise((resolve) => {
        let unsubscribe = () => {};
        unsubscribe = firebaseApi.onAuthStateChanged(firebaseAuth, (user) => {
            unsubscribe();
            resolve(user);
        });
    });
}

function normalizePhone(phone) {
    let digits = phone.replace(/\D/g, '');
    if (digits.startsWith('0')) digits = `254${digits.slice(1)}`;
    if (digits.startsWith('254')) return `+${digits}`;
    if (digits.length >= 9 && digits.length <= 15) return `+${digits}`;
    throw new Error('Enter a complete phone number, including the country code.');
}

export async function sendPhoneCode(phone, recaptchaElement) {
    const { available } = await authReady;
    if (!available) throw new Error('Phone sign-in is not configured. Contact Phil-Ride support.');
    if (recaptchaVerifier) {
        recaptchaVerifier.clear();
        recaptchaVerifier = null;
    }
    recaptchaVerifier = new firebaseApi.RecaptchaVerifier(firebaseAuth, recaptchaElement, {
        size: 'normal'
    });
    await recaptchaVerifier.render();
    confirmationResult = await firebaseApi.signInWithPhoneNumber(
        firebaseAuth,
        normalizePhone(phone),
        recaptchaVerifier
    );
}

export async function verifyPhoneCode(code, displayName) {
    if (!confirmationResult) throw new Error('Request a verification code first.');
    const result = await confirmationResult.confirm(code);
    const idToken = await result.user.getIdToken();
    const session = await fetch('/api/auth/session', {
        headers: { Authorization: `Bearer ${idToken}` }
    });
    const sessionData = await session.json();
    if (!session.ok) throw new Error(sessionData.error || 'Your account could not be verified.');

    if (displayName.trim().length >= 2 && displayName.trim() !== sessionData.profile.displayName) {
        const update = await fetch('/api/auth/profile', {
            method: 'PATCH',
            headers: {
                Authorization: `Bearer ${idToken}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ displayName: displayName.trim() })
        });
        const updateData = await update.json();
        if (!update.ok) throw new Error(updateData.error || 'Your profile could not be updated.');
        sessionData.profile = updateData.profile;
    }

    return sessionData.profile;
}

export async function authorizedFetch(url, options = {}) {
    const { available } = await authReady;
    if (!available) throw new Error('Phone sign-in is not configured on this service.');
    const user = await currentUser();
    if (!user) {
        const returnTo = `${window.location.pathname}${window.location.search}`;
        window.location.assign(`/portal.html?next=${encodeURIComponent(returnTo)}`);
        throw new Error('Sign in to continue.');
    }
    const token = await user.getIdToken();
    const response = await fetch(url, {
        ...options,
        headers: {
            Authorization: `Bearer ${token}`,
            ...(options.body ? { 'Content-Type': 'application/json' } : {}),
            ...options.headers
        }
    });
    const data = await response.json();
    if (response.status === 401) {
        await firebaseApi.signOut(firebaseAuth);
        window.location.replace('/portal.html');
        throw new Error('Your sign-in expired. Verify your phone number again.');
    }
    if (!response.ok) throw new Error(data.error || 'The request could not be completed.');
    return data;
}

export async function requireRole(role) {
    const { available } = await authReady;
    if (!available) return null;
    const user = await currentUser();
    if (!user) {
        const next = `${window.location.pathname}${window.location.search}`;
        window.location.replace(`/portal.html?next=${encodeURIComponent(next)}`);
        return null;
    }
    const { profile } = await authorizedFetch('/api/auth/session');
    if (profile.role !== role) {
        const error = new Error(`This page is restricted to ${role} accounts.`);
        error.status = 403;
        throw error;
    }
    return profile;
}

export async function signOut() {
    const { available } = await authReady;
    if (available && await currentUser()) {
        await firebaseApi.signOut(firebaseAuth);
    }
    window.location.replace('/portal.html');
}

export function getPublicConfig() {
    return authReady.then(({ config }) => config);
}
