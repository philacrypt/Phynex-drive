const rideModel = require('../models/rides');
const fares = require('../services/fares');
const googleRoutes = require('../services/google-routes');

function createHttpError(status, message) {
    const error = new Error(message);
    error.status = status;
    return error;
}

function parseCoordinates(body) {
    const coordinate = (value) => (
        typeof value === 'number' || (typeof value === 'string' && value.trim() !== '')
            ? Number(value)
            : Number.NaN
    );
    const input = {
        pickupLat: coordinate(body.pickupLat),
        pickupLng: coordinate(body.pickupLng),
        destinationLat: coordinate(body.destinationLat),
        destinationLng: coordinate(body.destinationLng)
    };

    for (const [label, coordinate, min, max] of [
        ['Pickup latitude', input.pickupLat, -90, 90],
        ['Pickup longitude', input.pickupLng, -180, 180],
        ['Destination latitude', input.destinationLat, -90, 90],
        ['Destination longitude', input.destinationLng, -180, 180]
    ]) {
        if (!Number.isFinite(coordinate) || coordinate < min || coordinate > max) {
            throw createHttpError(400, `${label} is invalid. Select the location from Google Maps.`);
        }
    }
    return input;
}

async function getRouteEstimate(body, vehicleType) {
    if (!['car', 'bike'].includes(vehicleType)) {
        throw createHttpError(400, 'Choose a car or bike.');
    }
    const points = parseCoordinates(body);
    const route = await googleRoutes.getDrivingRoute(
        { latitude: points.pickupLat, longitude: points.pickupLng },
        { latitude: points.destinationLat, longitude: points.destinationLng }
    );
    return {
        ...fares.calculateFare(route.distanceMeters, vehicleType),
        duration: route.duration,
        vehicleType
    };
}

function validateRideDetails(body, profile) {
    const input = {
        ...parseCoordinates(body),
        pickup: typeof body.pickup === 'string' ? body.pickup.trim() : '',
        destination: typeof body.destination === 'string' ? body.destination.trim() : '',
        vehicleType: body.vehicleType,
        paymentMethod: body.paymentMethod,
        driverUid: typeof body.driverUid === 'string' ? body.driverUid.trim() : ''
    };

    if (!profile.phone || !/^\+[1-9]\d{7,14}$/.test(profile.phone)) {
        throw createHttpError(403, 'A verified phone number is required to book a ride.');
    }
    if (typeof profile.displayName !== 'string' || profile.displayName.trim().length < 2) {
        throw createHttpError(400, 'Add your name to your account before booking.');
    }
    if (input.pickup.length < 2 || input.pickup.length > 120) {
        throw createHttpError(400, 'Choose a valid pickup location from Google Maps.');
    }
    if (input.destination.length < 2 || input.destination.length > 120) {
        throw createHttpError(400, 'Choose a valid destination from Google Maps.');
    }
    if (input.pickup.toLowerCase() === input.destination.toLowerCase()
        || (input.pickupLat === input.destinationLat && input.pickupLng === input.destinationLng)) {
        throw createHttpError(400, 'Pickup and destination must be different.');
    }
    if (!['car', 'bike'].includes(input.vehicleType)) {
        throw createHttpError(400, 'Choose a car or bike.');
    }
    if (!['cash', 'mpesa'].includes(input.paymentMethod)) {
        throw createHttpError(400, 'Choose cash or M-Pesa as your payment method.');
    }
    if (body.driverUid !== undefined && body.driverUid !== ''
        && (typeof body.driverUid !== 'string' || !input.driverUid || input.driverUid.length > 128)) {
        throw createHttpError(400, 'Choose a valid available driver.');
    }
    if (input.paymentMethod === 'mpesa' && !require('../services/mpesa').isConfigured()) {
        throw createHttpError(503, 'M-Pesa is not configured yet. Choose cash or contact support.');
    }

    return input;
}

async function estimateRide(req, res) {
    const points = parseCoordinates(req.body || {});
    const route = await googleRoutes.getDrivingRoute(
        { latitude: points.pickupLat, longitude: points.pickupLng },
        { latitude: points.destinationLat, longitude: points.destinationLng }
    );
    const estimates = ['car', 'bike'].map((vehicleType) => ({
        ...fares.calculateFare(route.distanceMeters, vehicleType),
        duration: route.duration,
        vehicleType
    }));
    res.json({
        distanceKm: estimates[0].distanceKm,
        billableKm: estimates[0].billableKm,
        duration: estimates[0].duration,
        estimates
    });
}

async function getAvailableDrivers(req, res) {
    const latitude = Number(req.query.pickupLat);
    const longitude = Number(req.query.pickupLng);
    if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90
        || !Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
        throw createHttpError(400, 'Choose a valid pickup location to find nearby drivers.');
    }
    res.json({ drivers: await rideModel.listAvailableDrivers(latitude, longitude) });
}

async function createRide(req, res) {
    const input = validateRideDetails(req.body || {}, req.profile);
    const estimate = await getRouteEstimate(input, input.vehicleType);
    const ride = await rideModel.createRide({
        ...input,
        distanceKm: estimate.distanceKm,
        fareKsh: estimate.fareKsh
    }, req.profile.id);
    res.status(201).json({ ride });
}

async function getRide(req, res) {
    const ride = await rideModel.getCustomerRide(req.params.id, req.profile.id);
    if (!ride) throw createHttpError(404, 'Ride not found.');
    res.json({ ride });
}

async function getMyRides(req, res) {
    res.json({ rides: await rideModel.listCustomerRides(req.profile.id) });
}

async function cancelRide(req, res) {
    const ride = await rideModel.getCustomerRide(req.params.id, req.profile.id);
    if (!ride) throw createHttpError(404, 'Ride not found.');
    if (ride.status !== 'requested') {
        throw createHttpError(409, 'This ride can no longer be cancelled in the app. Contact support for help.');
    }
    await rideModel.cancelRequestedRide(ride.id, req.profile.id);
    res.json({ ride: await rideModel.getCustomerRide(ride.id, req.profile.id) });
}

module.exports = {
    cancelRide,
    createHttpError,
    createRide,
    estimateRide,
    getAvailableDrivers,
    getMyRides,
    getRide,
    parseCoordinates
};
