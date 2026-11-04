const MPESA_ORIGINS = {
    production: 'https://api.safaricom.co.ke',
    sandbox: 'https://sandbox.safaricom.co.ke'
};

let tokenCache;

function isConfigured() {
    return Boolean(
        MPESA_ORIGINS[process.env.MPESA_ENV]
        && process.env.MPESA_CONSUMER_KEY
        && process.env.MPESA_CONSUMER_SECRET
        && process.env.MPESA_SHORTCODE
        && process.env.MPESA_PASSKEY
        && process.env.MPESA_CALLBACK_URL
        && (process.env.MPESA_ENV !== 'production' || process.env.MPESA_CALLBACK_URL.startsWith('https://'))
    );
}

function requireConfigured() {
    if (!isConfigured()) {
        const error = new Error('M-Pesa payments are not configured. Choose cash or contact support.');
        error.status = 503;
        throw error;
    }
    if (process.env.MPESA_ENV === 'production' && !process.env.MPESA_CALLBACK_URL.startsWith('https://')) {
        const error = new Error('The production M-Pesa callback URL must use HTTPS.');
        error.status = 503;
        throw error;
    }
}

function getTimestamp() {
    const parts = new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Africa/Nairobi',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hourCycle: 'h23'
    }).formatToParts(new Date()).reduce((values, part) => {
        values[part.type] = part.value;
        return values;
    }, {});
    return `${parts.year}${parts.month}${parts.day}${parts.hour}${parts.minute}${parts.second}`;
}

async function getAccessToken() {
    if (tokenCache && tokenCache.expiresAt > Date.now()) return tokenCache.value;
    const credentials = Buffer.from(
        `${process.env.MPESA_CONSUMER_KEY}:${process.env.MPESA_CONSUMER_SECRET}`
    ).toString('base64');
    const response = await fetch(
        `${MPESA_ORIGINS[process.env.MPESA_ENV]}/oauth/v1/generate?grant_type=client_credentials`,
        {
            headers: { Authorization: `Basic ${credentials}` },
            signal: AbortSignal.timeout(10_000)
        }
    );
    if (!response.ok) throw new Error('M-Pesa authentication failed.');
    const data = await response.json();
    if (!data.access_token) throw new Error('M-Pesa did not return an access token.');
    tokenCache = {
        value: data.access_token,
        expiresAt: Date.now() + Math.max(30, Number(data.expires_in) - 30) * 1000
    };
    return tokenCache.value;
}

function normalizeKenyanPhone(phone) {
    let digits = phone.replace(/\D/g, '');
    if (digits.startsWith('0')) digits = `254${digits.slice(1)}`;
    if (!/^254[17]\d{8}$/.test(digits)) {
        const error = new Error('A valid Kenyan mobile number is required for M-Pesa.');
        error.status = 400;
        throw error;
    }
    return digits;
}

async function startStkPush({ phone, amountKsh, rideId }) {
    requireConfigured();
    const timestamp = getTimestamp();
    const shortCode = process.env.MPESA_SHORTCODE;
    const password = Buffer.from(`${shortCode}${process.env.MPESA_PASSKEY}${timestamp}`).toString('base64');
    const accessToken = await getAccessToken();
    const response = await fetch(`${MPESA_ORIGINS[process.env.MPESA_ENV]}/mpesa/stkpush/v1/processrequest`, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            BusinessShortCode: shortCode,
            Password: password,
            Timestamp: timestamp,
            TransactionType: process.env.MPESA_TRANSACTION_TYPE || 'CustomerPayBillOnline',
            Amount: amountKsh,
            PartyA: normalizeKenyanPhone(phone),
            PartyB: shortCode,
            PhoneNumber: normalizeKenyanPhone(phone),
            CallBackURL: process.env.MPESA_CALLBACK_URL,
            AccountReference: (process.env.MPESA_ACCOUNT_REFERENCE || 'PHIL-RIDE').slice(0, 12),
            TransactionDesc: `Ride ${rideId.slice(0, 8)}`
        }),
        signal: AbortSignal.timeout(15_000)
    });
    const data = await response.json();
    if (!response.ok || data.ResponseCode !== '0' || !data.CheckoutRequestID || !data.MerchantRequestID) {
        throw new Error(data.errorMessage || 'M-Pesa could not start the payment request.');
    }
    return {
        checkoutRequestId: data.CheckoutRequestID,
        merchantRequestId: data.MerchantRequestID
    };
}

async function verifyStkPayment(checkoutRequestId) {
    requireConfigured();
    const timestamp = getTimestamp();
    const shortCode = process.env.MPESA_SHORTCODE;
    const password = Buffer.from(`${shortCode}${process.env.MPESA_PASSKEY}${timestamp}`).toString('base64');
    const accessToken = await getAccessToken();
    const response = await fetch(`${MPESA_ORIGINS[process.env.MPESA_ENV]}/mpesa/stkpushquery/v1/query`, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            BusinessShortCode: shortCode,
            Password: password,
            Timestamp: timestamp,
            CheckoutRequestID: checkoutRequestId
        }),
        signal: AbortSignal.timeout(15_000)
    });
    const data = await response.json();
    if (!response.ok) throw new Error('M-Pesa payment verification failed.');
    return data;
}

module.exports = { isConfigured, normalizeKenyanPhone, startStkPush, verifyStkPayment };
