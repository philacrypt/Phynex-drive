const test = require('node:test');
const assert = require('node:assert/strict');

test('Google Routes receives the selected endpoints and returns driving distance', async (t) => {
    const previousKey = process.env.GOOGLE_MAPS_SERVER_API_KEY;
    process.env.GOOGLE_MAPS_SERVER_API_KEY = 'test-key';
    const fetch = t.mock.method(global, 'fetch', async (url, options) => {
        assert.equal(url, 'https://routes.googleapis.com/directions/v2:computeRoutes');
        assert.equal(options.headers['X-Goog-Api-Key'], 'test-key');
        const request = JSON.parse(options.body);
        assert.equal(request.origin.location.latLng.latitude, -1.28);
        assert.equal(request.destination.location.latLng.longitude, 36.82);
        return new Response(JSON.stringify({
            routes: [{ distanceMeters: 5100, duration: '900s' }]
        }), { status: 200 });
    });
    t.after(() => {
        if (previousKey === undefined) delete process.env.GOOGLE_MAPS_SERVER_API_KEY;
        else process.env.GOOGLE_MAPS_SERVER_API_KEY = previousKey;
    });

    const routes = require('./google-routes');
    assert.deepEqual(await routes.getDrivingRoute(
        { latitude: -1.28, longitude: 36.8 },
        { latitude: -1.3, longitude: 36.82 }
    ), { distanceMeters: 5100, duration: '900s' });
    assert.equal(fetch.mock.callCount(), 1);
});

test('Google Routes fails explicitly when the server key is missing', async (t) => {
    const previousKey = process.env.GOOGLE_MAPS_SERVER_API_KEY;
    delete process.env.GOOGLE_MAPS_SERVER_API_KEY;
    t.after(() => {
        if (previousKey !== undefined) process.env.GOOGLE_MAPS_SERVER_API_KEY = previousKey;
    });

    const routes = require('./google-routes');
    await assert.rejects(
        routes.getDrivingRoute({ latitude: 0, longitude: 0 }, { latitude: 1, longitude: 1 }),
        { status: 503, message: 'Distance pricing is not configured. Contact Phil-Ride support.' }
    );
});
