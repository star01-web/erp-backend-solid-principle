const sequelize = require('./common/db.config')
const db = require('./common/index.db');
const app = require('./app');
const cors = require('cors');
const HOST = process.env.SYSTEM_IP || 'localhost'
app.use(cors());
const startServer = async () => {
    try {
        await sequelize.authenticate();
        console.log(' Database connected via .env file!');

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