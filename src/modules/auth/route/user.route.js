const express = require('express');
const { Registration, Profile, ChangePassword, updateProfile, logout } = require('../controller/user.controller');
const tokenVerify = require('../middleware/authMiddleware');

const router = express.Router();

// user routes
router.post('/register', Registration);
router.get('/profile', tokenVerify, Profile);
router.put('/change-password', tokenVerify, ChangePassword);
router.put('/update-profile/:id', tokenVerify, updateProfile);
router.post('/logout', logout);

module.exports = router;

    