const { DataTypes } = require('sequelize');
const sequelize = require('../../../common/db.config.js');


const Lead = sequelize.define('Lead', {
    id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        allowNull: false,
        primaryKey: true,
    },
    leadId: {
        type: DataTypes.STRING,
        allowNull: false,
        unique: true,
    },
    assignedTo: {
        type: DataTypes.STRING,
        allowNull: false,
    },
    name:{
        type: DataTypes.STRING,
        allowNull: false,
    },
    contactNumber: {
        type: DataTypes.STRING,
        allowNull: false,
        unique: true,
    },
    email: {
        type: DataTypes.STRING,
        allowNull: false,
        unique: true,
    },
});


module.exports = Lead;