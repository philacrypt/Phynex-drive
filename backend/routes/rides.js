const express = require('express');
const controller = require('../controllers/rides');
const paymentsController = require('../controllers/payments');

const router = express.Router();

router.post('/', controller.createRide);
router.post('/estimate', controller.estimateRide);
router.get('/drivers', controller.getAvailableDrivers);
router.get('/mine', controller.getMyRides);
router.get('/:id', controller.getRide);
router.patch('/:id/cancel', controller.cancelRide);
router.post('/:id/mpesa-payment', paymentsController.startMpesaPayment);

module.exports = router;
