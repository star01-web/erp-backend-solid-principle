const express = require('express');
const {  login } = require('../controller/auth.controller');
const router = express.Router();

// Error wrapper for async functions
const asyncHandler = (fn) => (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
};

// auth routes
router.post('/login', asyncHandler(login));
module.exports = router;