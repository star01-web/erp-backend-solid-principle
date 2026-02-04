 const {Sequelize} = require('sequelize');

 const sequelize = require('./db.config');


//  improt models
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

    // Associations can be defined here
   // Employee to CheckIn (One-to-Many)
db.EmployeeMaster.hasMany(db.CheckIn, { 
    foreignKey: 'employee_master_id', 
    as: 'checkins' 
});
db.CheckIn.belongsTo(db.EmployeeMaster, { 
    foreignKey: 'employee_master_id',
    as: 'employee'
});

// Employee to CheckOut (One-to-Many)
db.EmployeeMaster.hasMany(db.CheckOut, { 
    foreignKey: 'employee_master_id', 
    sourceKey: 'id',        
    as: 'checkouts' 
});

db.CheckOut.belongsTo(db.EmployeeMaster, { 
    foreignKey: 'employee_master_id', 
    targetKey: 'id', 
    as: 'employee'
});

// Ek location ke andar bahut saare employees ho sakte hain
db.OfficeLocation.hasMany(db.EmployeeMaster, { 
    foreignKey: 'location_id', 
    as: 'employees' 
});

// Ek employee ki sirf EK hi location hogi
db.EmployeeMaster.belongsTo(db.OfficeLocation, { 
    foreignKey: 'location_id', 
    as: 'location' 
});

db.EmployeeMaster.belongsTo(db.User, { 
    foreignKey: 'userId', 
    as: 'loginDetails' 
});

// Reverse relation (User ke paas ek employee profile hai)
db.User.hasOne(db.EmployeeMaster, { 
    foreignKey: 'userId',
    as: 'employeeProfile'
});


module.exports = db