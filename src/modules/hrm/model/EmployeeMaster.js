  const { DataTypes } = require('sequelize');
  const sequelize = require('../../../common/db.config');
  const { de } = require('zod/locales');
  const EmployeeMaster = sequelize.define('EmployeeMaster', {
    
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
      field: 'employee_master_id'
    },
    emp_code: {
      type: DataTypes.STRING,
      allowNull: false,
      unique: true
    },
    name: {
      type: DataTypes.STRING,
      allowNull: false
    },
    phone: {
      type: DataTypes.STRING,
      allowNull: false,
      unique: true
    },
    address:{
      type: DataTypes.STRING,
      allowNull: false
      },
    email: {
      type: DataTypes.STRING,
      allowNull: false,
      unique: true,    
      validate: { isEmail: true }
    },
    department: {
      type: DataTypes.STRING,
      allowNull: false
    },
    position: {
      type: DataTypes.STRING,
      allowNull: false
    },
    monthly_wages: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: false
    },
    location_id: {
      type: DataTypes.UUID,
      allowNull: true,
    },
    isActive: {
      type: DataTypes.BOOLEAN,
      defaultValue: true 
    },
    supervisor_id: {
          type: DataTypes.UUID,
          allowNull: true, // Top level admin ke liye null hoga
          references: {
              model: 'hrm_employee_master',
              key: 'employee_master_id'
          }
      },
    user_id: {
      type: DataTypes.UUID,
      allowNull: true,
      field: 'userId'
    }
  }, {
    tableName: 'hrm_employee_master', 
    timestamps: true 
  });

  module.exports = EmployeeMaster;