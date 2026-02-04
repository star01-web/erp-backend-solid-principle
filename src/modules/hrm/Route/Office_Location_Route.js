 const express = require('express');
    const router = express.Router();
    const  {createOfficeLocation,updateOfficeLocation} = require('../Controller/Office_Location_Controller');

    // Route to create a new office location
    router.post('/create-office-location', createOfficeLocation);
    router.put('/update-office-location/:id', updateOfficeLocation);

    module.exports = router;