const express = require('express')
const router = express.Router()
const { handleCheckIn, handleCheckOut, getAttendanceData } = require('../Controller/CheckIn_CheckOut_controller')
const {verifyToken} = require('../middleware/verifyToken')

const asyncHandler = (fn) => (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
};

router.post('/checkin', verifyToken, asyncHandler(handleCheckIn))
router.post('/checkout', verifyToken, asyncHandler(handleCheckOut))
router.get('/attandace-data', verifyToken, asyncHandler(getAttendanceData))

module.exports = router