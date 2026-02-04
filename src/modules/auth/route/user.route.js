const express = require('express');
const { Registration, Profile, ChangePassword, updateProfile, logout } = require('../controller/user.controller');
const { verifyToken } = require('../middleware/authMiddleware');

const router = express.Router();

// user routes
router.post('/register', Registration);
router.get('/profile', verifyToken, Profile);
router.put('/change-password', verifyToken, ChangePassword);
router.put('/update-profile/:id', verifyToken, updateProfile);
router.post('/logout', verifyToken, logout);

module.exports = router;

    