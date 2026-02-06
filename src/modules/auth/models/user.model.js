const { DataTypes } = require('sequelize');
const sequelize = require('../../../common/db.config');
const bcrypt = require('bcrypt');

const User = sequelize.define('User', {
    id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        allowNull: false,
        primaryKey: true,

    },
    name: {
        type: DataTypes.STRING,
        allowNull: false,
    },
    email: {
        type: DataTypes.STRING,
        allowNull: false,
        unique: true,
        validate: {
            isEmail: true 
        }
    },
    username: {
        type: DataTypes.STRING,
        allowNull: false,
        unique: true,
    },
    password: {
        type: DataTypes.STRING,
        allowNull: false,
    },
    role: {
        type: DataTypes.ENUM('ADMIN', 'ACCOUNTS', 'HR', 'FACTORY_MANAGER', 'INVENTORY_MANAGER', 'SALES', 'EMPLOYEE', 'Technical-Seupervisor', 'Technical-Team'),
        allowNull: false,
    }
    
}, {
    timestamps: true,   
    hooks: {
        // Hook 1: Jab naya user bane
        beforeCreate: async (user) => {
            if (user.password) {
                user.password = await bcrypt.hash(user.password, 10);
            }
        },
        // Hook 2: Jab user password update kare (BOHOT ZAROORI)
        beforeUpdate: async (user) => {
            if (user.changed('password')) {
                user.password = await bcrypt.hash(user.password, 10);
            }
        }
    }
});

// Instance Method for Login
User.prototype.validPassword = async function (password) {
    return await bcrypt.compare(password, this.password);
};

module.exports = User;