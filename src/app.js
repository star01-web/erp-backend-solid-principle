const express = require('express');
const cors = require('cors');       
const helmet = require('helmet');   

const authRoutes = require('./modules/auth/route/auth.route');
const userRoutes = require('./modules/auth/route/user.route');
const CreateEmployee = require('./modules/hrm/Route/emp_route');
const CreateOfficeLocation = require('./modules/hrm/Route/Office_Location_Route');
const attendaceRow = require('./modules/hrm/Route/Checkin_CheckOut_Route');
const internalAuth = require('./modules/auth/middleware/api.internalAuth');
const app = express();

// --- 1. Middleware ---
app.use(express.json()); 
app.use(express.urlencoded({ extended: true })); 
app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));         
app.use(helmet());       
// --- 2. Routes ---
app.get('/', (req, res) => {
    res.send('✅ ERP-Star Backend is Running Successfully!');
});

// app.use(internalAuth); // Internal API Auth Middleware
app.use('/v1/api/auth', authRoutes);
app.use('/v2/api/user', userRoutes);
app.use('/v2/api/employee', CreateEmployee);
app.use('/v2/api/office-location', CreateOfficeLocation);
app.use('/v2/api/attendace',attendaceRow)

// --- 3. Error Handling Middleware ---
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).json({ message: 'Something went wrong!' });
});
module.exports = app;