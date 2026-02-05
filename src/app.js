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

// --- Error Wrapper for Async Routes ---
const asyncHandler = (fn) => (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
};

// --- 1. Middleware ---
app.use(express.json()); 
app.use(express.urlencoded({ extended: true })); 
app.use(cors({
    origin: process.env.ALLOWED_ORIGINS?.split(',') || 'localhost',
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true
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
app.use('/v2/api/attendance', attendaceRow);

// --- 3. Error Handling Middleware ---
// 404 Handler
app.use((req, res) => {
    res.status(404).json({ message: '❌ Route not found' });
});

// Global Error Handler (MUST be last)
app.use((err, req, res, next) => {
    const statusCode = err.status || err.statusCode || 500;
    const errorMessage = err.message || 'Internal Server Error';
    
    console.error('\n🔴 CRASH DETECTED:');
    console.error(`Status: ${statusCode}`);
    console.error(`Message: ${errorMessage}`);
    console.error(`Stack: ${err.stack}\n`);
    
    res.status(statusCode).json({
        success: false,
        message: process.env.NODE_ENV === 'production' ? 'Something went wrong!' : errorMessage,
        ...(process.env.NODE_ENV !== 'production' && { error: err.stack })
    });
});

// Handle Unhandled Promise Rejections
process.on('unhandledRejection', (reason, promise) => {
    console.error('\n⚠️ Unhandled Rejection:', reason);
    console.error('Promise:', promise);
});

// Handle Uncaught Exceptions
process.on('uncaughtException', (error) => {
    console.error('\n❌ UNCAUGHT EXCEPTION:', error);
    process.exit(1);
});

module.exports = app;