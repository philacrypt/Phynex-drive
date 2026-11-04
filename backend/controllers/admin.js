const adminModel = require('../models/admin');
const rideModel = require('../models/rides');

async function getSummary(req, res) {
    res.json({ summary: await adminModel.getSummary() });
}

async function getRides(req, res) {
    res.json({ rides: await rideModel.listRides({ limit: 100 }) });
}

module.exports = { getRides, getSummary };
