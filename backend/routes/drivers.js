const express = require('express');
const controller = require('../controllers/drivers');

const router = express.Router();

router.get('/', controller.getDriver);
router.get('/summary', controller.getSummary);
router.put('/online', controller.setOnline);
router.put('/location', controller.updateLocation);
router.get('/rides', controller.getRides);
router.post('/rides/:id/accept', controller.acceptRide);
router.post('/rides/:id/advance', controller.advanceRide);

module.exports = router;
