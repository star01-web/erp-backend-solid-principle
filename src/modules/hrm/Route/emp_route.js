const express = require('express');
const router = express.Router();
const {CreateEmployee,updateEmployee,getallEmployee, getEmployeeProfile } = require('../Controller/employee_controller.js');

const asyncHandler = (fn) => (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
};

router.post('/create-employee', asyncHandler(CreateEmployee));
router.put('/update-employee/:id', asyncHandler(updateEmployee));
router.get('/get-all-employees', asyncHandler(getallEmployee));
router.get('/get-user-profile', asyncHandler(getEmployeeProfile));
module.exports = router;
