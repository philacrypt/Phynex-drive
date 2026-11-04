const express = require('express');
const controller = require('../controllers/admin');

const router = express.Router();

router.get('/summary', controller.getSummary);
router.get('/rides', controller.getRides);

module.exports = router;
