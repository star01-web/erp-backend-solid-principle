const { Sequelize } = require('sequelize');
const sequelize = require('./db.config');

// Models Import
const User = require('../modules/auth/models/user.model');
const EmployeeMaster = require('../modules/hrm/model/EmployeeMaster');
const CheckIn = require('../modules/hrm/model/CheckIn_model');
const CheckOut = require('../modules/hrm/model/CheckOut_model');
const OfficeLocation = require('../modules/hrm/model/Office_Location_model');

const db = {
    sequelize,
    Sequelize,
    User,
    EmployeeMaster,
    CheckIn,
    CheckOut,
    OfficeLocation
};

// --- ASSOCIATIONS (RELATIONS) ---

// 1. Employee to CheckIn (One-to-Many)
db.EmployeeMaster.hasMany(db.CheckIn, { 
    foreignKey: 'employee_master_id', 
    as: 'checkins' 
});
db.CheckIn.belongsTo(db.EmployeeMaster, { 
    foreignKey: 'employee_master_id',
    as: 'employee'
});

// 2. Employee to CheckOut (One-to-Many)
db.EmployeeMaster.hasMany(db.CheckOut, { 
    foreignKey: 'employee_master_id', 
    as: 'checkouts' 
});
db.CheckOut.belongsTo(db.EmployeeMaster, { 
    foreignKey: 'employee_master_id', 
    as: 'employee'
});

// 3. OfficeLocation to EmployeeMaster (Geofencing ke liye)
db.OfficeLocation.hasMany(db.EmployeeMaster, { 
    foreignKey: 'location_id', 
    as: 'employees' 
});
db.EmployeeMaster.belongsTo(db.OfficeLocation, { 
    foreignKey: 'location_id', 
    as: 'location' 
});

// 4. User to EmployeeMaster (Login Mapping)
db.User.hasOne(db.EmployeeMaster, { 
    foreignKey: 'userId', // Check karein aapke DB mein 'userId' hai ya 'user_id'
    as: 'employeeProfile'
});
db.EmployeeMaster.belongsTo(db.User, { 
    foreignKey: 'userId', 
    as: 'loginDetails' 
});

// 5. Self-Referencing (Supervisor to Team Members)
// Yeh line aapka "Team" render karne mein madad karegi
db.EmployeeMaster.hasMany(db.EmployeeMaster, {
    foreignKey: 'supervisor_id',
    as: 'teamMembers'
});
db.EmployeeMaster.belongsTo(db.EmployeeMaster, {
    foreignKey: 'supervisor_id',
    as: 'supervisor'
});

module.exports = db;