const driverModel = require('../models/drivers');
const rideModel = require('../models/rides');
const { createHttpError } = require('./rides');

const statusTransitions = {
    accepted: 'en_route',
    en_route: 'in_progress',
    in_progress: 'completed'
};

async function getDriver(req, res) {
    res.json({ driver: await driverModel.getDriver(req.profile.id) });
}

async function getSummary(req, res) {
    res.json({
        summary: await driverModel.getDriverStats(req.profile.id),
        driver: await driverModel.getDriver(req.profile.id)
    });
}

async function setOnline(req, res) {
    if (typeof req.body?.online !== 'boolean') {
        throw createHttpError(400, 'Online status must be true or false.');
    }
    let location;
    if (req.body.online) {
        location = validateLocation(req.body);
    }
    const driver = await driverModel.setOnline(req.profile.id, req.body.online, location);
    if (!driver) throw createHttpError(403, 'Driver account setup is incomplete. Contact operations.');
    res.json({ driver });
}

function validateLocation(body) {
    const latitude = typeof body.latitude === 'number' ? body.latitude : Number.NaN;
    const longitude = typeof body.longitude === 'number' ? body.longitude : Number.NaN;
    if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90
        || !Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
        throw createHttpError(400, 'A valid GPS location is required to go online.');
    }
    return { latitude, longitude };
}

async function updateLocation(req, res) {
    const { latitude, longitude } = validateLocation(req.body || {});
    if (!await driverModel.updateLocation(req.profile.id, latitude, longitude)) {
        throw createHttpError(409, 'Go online before updating your location.');
    }
    res.json({ updated: true });
}

async function getRides(req, res) {
    const [available, active] = await Promise.all([
        rideModel.listRides({ status: 'requested', availableForDrivers: true }),
        rideModel.listDriverRides(req.profile.id)
    ]);
    res.json({
        available: available.map(({ customerPhone, ...ride }) => ride),
        active
    });
}

async function acceptRide(req, res) {
    const driver = await driverModel.getDriver(req.profile.id);
    if (!driver) throw createHttpError(403, 'Driver account setup is incomplete. Contact operations.');
    if (!driver.online) throw createHttpError(409, 'Go online before accepting a ride.');
    const ride = await rideModel.getRide(req.params.id);
    if (!ride) throw createHttpError(404, 'Ride not found.');
    if (!await rideModel.assignRide(ride.id, req.profile.id)) {
        throw createHttpError(409, 'This ride has already been taken, paid status changed, or cancelled.');
    }
    res.json({ ride: await rideModel.getRide(ride.id) });
}

async function advanceRide(req, res) {
    const ride = await rideModel.getRide(req.params.id);
    if (!ride) throw createHttpError(404, 'Ride not found.');
    if (ride.driverUid !== req.profile.id) {
        throw createHttpError(403, 'This ride is not assigned to your account.');
    }

    const nextStatus = statusTransitions[ride.status];
    if (!nextStatus) throw createHttpError(409, 'This ride cannot be advanced further.');
    const result = await rideModel.updateAssignedRideStatus(
        ride.id,
        req.profile.id,
        ride.status,
        nextStatus
    );
    if (!result.changes && result.paymentRequired) {
        throw createHttpError(409, 'The M-Pesa payment must be confirmed before completing this ride.');
    }
    if (!result.changes) throw createHttpError(409, 'The ride changed. Refresh and try again.');
    res.json({ ride: await rideModel.getRide(ride.id) });
}

module.exports = {
    acceptRide,
    advanceRide,
    getDriver,
    getRides,
    getSummary,
    setOnline,
    updateLocation
};
