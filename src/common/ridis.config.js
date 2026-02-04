const { createClient } = require('redis');
const path = require('path'); 
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });

// 1. Client Setup
const client = createClient({
    username: process.env.REDIS_USERNAME || 'default',
    password: process.env.REDIS_PASSWORD,
    socket: {
        host: process.env.REDIS_HOST,
        port: process.env.REDIS_PORT // Port zaroori hai cloud ke liye
    }
});

client.on('error', err => console.log('❌ Redis Client Error', err));

// 2. Async Wrapper Function (Yeh zaroori hai Error hatane ke liye)
const connectRedis = async () => {
    try {
        await client.connect();
        console.log('✅ Connected to Redis Cloud successfully!');
        
        // Optional: Connection check karne ke liye ek value set karke dekhein
        // await client.set('ping', 'pong');
        // console.log('Ping check:', await client.get('ping'));
        
    } catch (err) {
        console.error('❌ Redis Connection Failed:', err.message);
    }
};

// 3. Function Call
connectRedis();

// 4. Export Client
module.exports = client;