const { DataTypes } = require('sequelize');
const sequelize = require('../../../common/db.config.js');

const ProjectSite = sequelize.define('ProjectSite', {
    id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true
    },
    locationName: {
        type: DataTypes.STRING,
        allowNull: false
    },
    latitude: {
        type: DataTypes.DECIMAL(10, 8),
        allowNull: false
    },
    longitude: {
        type: DataTypes.DECIMAL(11, 8),
        allowNull: false
    },
    radiusInMeters: {
        type: DataTypes.INTEGER,
        defaultValue: 100
    }
}, {
    tableName: 'ProjectSite'
});

module.exports = ProjectSite;
