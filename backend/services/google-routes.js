function isConfigured() {
    return Boolean(process.env.GOOGLE_MAPS_SERVER_API_KEY);
}

async function getDrivingRoute(pickup, destination) {
    const apiKey = process.env.GOOGLE_MAPS_SERVER_API_KEY;
    if (!apiKey) {
        const error = new Error('Distance pricing is not configured. Contact PHYNEX RIDE support.');
        error.status = 503;
        throw error;
    }

    const response = await fetch('https://routes.googleapis.com/directions/v2:computeRoutes', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-Goog-Api-Key': apiKey,
            'X-Goog-FieldMask': 'routes.distanceMeters,routes.duration'
        },
        body: JSON.stringify({
            origin: {
                location: { latLng: { latitude: pickup.latitude, longitude: pickup.longitude } }
            },
            destination: {
                location: { latLng: { latitude: destination.latitude, longitude: destination.longitude } }
            },
            travelMode: 'DRIVE',
            routingPreference: 'TRAFFIC_AWARE',
            regionCode: 'KE',
            units: 'METRIC'
        }),
        signal: AbortSignal.timeout(12_000)
    });

    if (!response.ok) {
        const error = new Error('Google Maps could not calculate this driving route.');
        error.status = response.status === 429 ? 503 : 502;
        throw error;
    }
    const result = await response.json();
    const route = result.routes?.[0];
    if (!route || !Number.isFinite(route.distanceMeters) || route.distanceMeters <= 0) {
        const error = new Error('No driving route was found between those locations.');
        error.status = 422;
        throw error;
    }

    return {
        distanceMeters: route.distanceMeters,
        duration: route.duration
    };
}

module.exports = { getDrivingRoute, isConfigured };
