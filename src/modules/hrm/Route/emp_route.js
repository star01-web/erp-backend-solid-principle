const express = require('express');
const router = express.Router();
const {CreateEmployee,updateEmployee } = require('../Controller/employee_controller.js');

router.post('/create-employee', CreateEmployee);
router.put('/update-employee/:id', updateEmployee);
module.exports = router;
