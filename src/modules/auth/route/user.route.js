const express = require('express');
const { Registration, Profile, ChangePassword, updateProfile, logout } = require('../controller/user.controller');
const { verifyToken } = require('../middleware/authMiddleware');

const router = express.Router();

// Error wrapper for async functions
const asyncHandler = (fn) => (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
};

// user routes
router.post('/register', asyncHandler(Registration));
router.get('/profile', verifyToken, asyncHandler(Profile));
router.put('/change-password', verifyToken, asyncHandler(ChangePassword));
router.put('/update-profile/:id', verifyToken, asyncHandler(updateProfile));
router.post('/logout', verifyToken, asyncHandler(logout));

module.exports = router;

    