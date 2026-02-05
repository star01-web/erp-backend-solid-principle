const sequelize = require('./common/db.config')
const db = require('./common/index.db');
const app = require('./app');
const HOST = process.env.SYSTEM_IP || 'localhost'
const startServer = async () => {
    try {
        if (!process.env.DB_HOST || !process.env.DB_USER || !process.env.DB_NAME) {
            throw new Error('❌ Missing DB env variables: DB_HOST, DB_USER, DB_NAME required');
        }

        await sequelize.authenticate();
        console.log('✅ Database connected successfully!');

        await db.sequelize.sync({ alter: false });
        console.log(' All models were synchronized successfully.');
        
        const PORT = process.env.PORT || 3000;
        
        app.listen(PORT, () => {
            console.log(` Server is running on ${HOST} port ${PORT}`);
        });

    } catch (error) {
        console.error(' Error:', error.message);
    }
};

startServer();