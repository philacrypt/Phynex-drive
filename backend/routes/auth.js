const express = require('express');
const controller = require('../controllers/auth');

const router = express.Router();

router.get('/session', controller.getSession);
router.patch('/profile', controller.updateProfile);

module.exports = router;
