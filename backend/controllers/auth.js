const profileModel = require('../models/profiles');
const { createHttpError } = require('./rides');

function getSession(req, res) {
    res.json({ profile: req.profile });
}

async function updateProfile(req, res) {
    const displayName = typeof req.body?.displayName === 'string'
        ? req.body.displayName.trim()
        : '';
    if (displayName.length < 2 || displayName.length > 80) {
        throw createHttpError(400, 'Enter a name between 2 and 80 characters.');
    }
    const profile = await profileModel.updateDisplayName(req.profile.id, displayName);
    if (!profile) throw createHttpError(404, 'Account profile not found.');
    res.json({ profile });
}

module.exports = { getSession, updateProfile };
