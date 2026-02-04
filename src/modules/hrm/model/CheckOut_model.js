const { DataTypes } = require('sequelize');
const sequelize = require('../../../common/db.config.js');

const CheckOut = sequelize.define('CheckOut', {
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
    checkOutTime: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW
    },
    // Location tracking for Check-out
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
},
working_hours: {
    type: DataTypes.DECIMAL(5, 2),
    allowNull: true
}
}, {
    tableName: 'hrm_checkouts',
    timestamps: true 
});

module.exports = CheckOut;