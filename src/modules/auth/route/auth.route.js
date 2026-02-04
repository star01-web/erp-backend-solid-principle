const express = require('express');
const {  login } = require('../controller/auth.controller');
const router = express.Router();

// auth routes
router.post('/login', login);
module.exports = router;