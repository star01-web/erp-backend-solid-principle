
const createEmployeeMiddleware = async (req, res, next) => {
    const { name, email, phone, address, position, role , department } = req.body;
    if(!name || !email || !phone || !address || !position || !department || !role) {
        return res.status(400).json({ message: 'All fields are required' });
    }
    if(email && !email.includes('@gmail.com')) {
        return res.status(400).json({ message: 'Invalid email format' });
    }

    if(phone && phone.toString().length !== 10) {
        return res.status(400).json({ message: 'Phone number must be 10 digits' });
    }
    next();

};


module.exports = createEmployeeMiddleware;