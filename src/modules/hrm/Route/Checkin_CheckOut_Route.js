const express = require('express')
const router = express.Router()
const { handleCheckIn, handleCheckOut, getAttendanceData } = require('../Controller/CheckIn_CheckOut_controller')
const {verifyToken} = require('../middleware/verifyToken')
router.post('/checkin', verifyToken , handleCheckIn)
router.post('/checkout', verifyToken ,handleCheckOut)
router.get('/attandace-data', verifyToken , getAttendanceData)

module.exports = router