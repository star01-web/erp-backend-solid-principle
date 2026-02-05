 const express = require('express');
    const router = express.Router();
    const  {createOfficeLocation,updateOfficeLocation} = require('../Controller/Office_Location_Controller');

    const asyncHandler = (fn) => (req, res, next) => {
        Promise.resolve(fn(req, res, next)).catch(next);
    };

    // Route to create a new office location
    router.post('/create-office-location', asyncHandler(createOfficeLocation));
    router.put('/update-office-location/:id', asyncHandler(updateOfficeLocation));

    module.exports = router;