const express = require('express')
const router = express.Router()
const { handleCheckIn, handleCheckOut, getAttendanceData, getTeamMembers, getFilteredAttendance, getAllAttendanceData} = require('../Controller/CheckIn_CheckOut_controller')
const {verifyToken} = require('../middleware/verifyToken')

const asyncHandler = (fn) => (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
};

router.post('/checkin', verifyToken, asyncHandler(handleCheckIn))
router.post('/checkout', verifyToken, asyncHandler(handleCheckOut))
router.get('/attandace-data', verifyToken, asyncHandler(getAttendanceData))
router.get('/team-members', verifyToken, asyncHandler(getTeamMembers))
router.get('/filtered-attendance', verifyToken, asyncHandler(getFilteredAttendance))
router.get('/full-attendance-report', verifyToken, asyncHandler(getAllAttendanceData))


module.exports = router