const { DataTypes } = require('sequelize'); // 'dataTypes' ko 'DataTypes' kar diya hai (Sequelize standard)
const sequelize = require('../../../common/db.config.js');

const CheckIn = sequelize.define('CheckIn', {
    id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        allowNull: false,
        primaryKey: true
    },
    employeeId: {
        type: DataTypes.UUID,
        allowNull: false,
        field: 'employee_master_id'
       
    },
    checkInTime: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW
    },
    
    latitude: {
        type: DataTypes.DECIMAL(10, 8),
        allowNull: false,
    },
    longitude: {
        type: DataTypes.DECIMAL(11, 8),
        allowNull: false,
    },
    address: {
        type: DataTypes.STRING,
        allowNull: true 
    },
    marked_by: {
    type: DataTypes.UUID,
    allowNull: true
}
}, {
    tableName: 'hrm_checkins', 
    timestamps: true 
});

module.exports = CheckIn;