const DataTypes = require('sequelize');
const sequelize = require('../../../common/db.config.js');
const { email } = require('zod');


const Lead = sequelize.define('Lead', {
    id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        allowNull: false,
    },
    leadId: {
        type: DataTypes.STRING,
        allowNull: false,
        unique: true,
    },
    assingeTo: {
        type: DataTypes.STRING,
        allowNull: false,
    },
    name:{
        type: DataTypes.STRING,
        allowNull: false,
    },
    contactNumber: {
        type: DataTypes.NUMBER,
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