const OfficeLocation = require('../model/Office_Location_model'); // Adjust path as needed

const createOfficeLocation = async (req, res) => {
    try {
        const { locationName, latitude, longitude, radiusInMeters } = req.body;

        // 1. Validation: Ensure required fields are present
        if (!locationName || latitude === undefined || longitude === undefined) {
            return res.status(400).json({
                success: false,
                message: "locationName, latitude, and longitude are required."
            });
        }

        // 2. Optional: Coordinate range validation
        // Latitude is -90 to 90, Longitude is -180 to 180
        if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) {
            return res.status(400).json({
                success: false,
                message: "Invalid coordinates provided."
            });
        }

        // 3. Create the Location
        const newLocation = await OfficeLocation.create({
            locationName,
            latitude,
            longitude,
            radiusInMeters: radiusInMeters || 100 // Defaults to 100 if not provided
        });

        return res.status(201).json({
            success: true,
            message: "Office Location created successfully",
            data: {
                id: newLocation.id,
                name: newLocation.locationName,
                coords: [newLocation.latitude, newLocation.longitude]
            }
        });

    } catch (error) {
        console.error("Error creating office location:", error);
        return res.status(500).json({
            success: false,
            message: "Failed to create office location",
            error: error.message
        });
    }
};

/**
 * Get all locations (Useful for populating the Employee Create dropdown)
 */
const getAllLocations = async (req, res) => {
    try {
        const locations = await OfficeLocation.findAll({
            // Definimos los campos exactos de tu modelo
            attributes: [
                'id', 
                'locationName', 
                'latitude', 
                'longitude', 
                'radiusInMeters'
            ]
        });

        // Verificamos si hay datos
        if (locations.length === 0) {
            return res.status(404).json({ message: "No se encontraron ubicaciones." });
        }

        return res.status(200).json(locations);
    } catch (error) {
        console.error("Error al obtener ubicaciones:", error);
        return res.status(500).json({ 
            message: "Error interno del servidor", 
            error: error.message 
        });
    }
};

/**
 * Update an existing Office Location
 */
const updateOfficeLocation = async (req, res) => {
    try {
        const { id } = req.params; // Get ID from URL
        const { locationName, latitude, longitude, radiusInMeters } = req.body;

        // 1. Find the location first
        const location = await OfficeLocation.findByPk(id);

        if (!location) {
            return res.status(404).json({
                success: false,
                message: "Office location not found."
            });
        }

        // 2. Validate coordinates if they are being updated
        if (latitude !== undefined && (latitude < -90 || latitude > 90)) {
            return res.status(400).json({ success: false, message: "Invalid latitude." });
        }
        if (longitude !== undefined && (longitude < -180 || longitude > 180)) {
            return res.status(400).json({ success: false, message: "Invalid longitude." });
        }

        // 3. Perform the update
        // We use .update() on the instance to trigger hooks if you have any
        await location.update({
            locationName: locationName || location.locationName,
            latitude: latitude !== undefined ? latitude : location.latitude,
            longitude: longitude !== undefined ? longitude : location.longitude,
            radiusInMeters: radiusInMeters !== undefined ? radiusInMeters : location.radiusInMeters
        });

        return res.status(200).json({
            success: true,
            message: "Office location updated successfully",
            data: location
        });

    } catch (error) {
        console.error("Error updating location:", error);
        return res.status(500).json({
            success: false,
            message: "Failed to update location",
            error: error.message
        });
    }
};

const deleteOfficeLocation = async (req, res) => {
    try {
        const { id } = req.params;

        // 1. Intentar eliminar directamente (Más eficiente)
        // Opcional: Puedes usar findByPk si necesitas validar algo antes de borrar
        const deletedRows = await OfficeLocation.destroy({
            where: { id: id }
        });

        // 2. Verificar si se eliminó algo
        if (deletedRows === 0) {
            return res.status(404).json({
                success: false,
                message: "No se encontró la ubicación de la oficina con el ID proporcionado."
            });
        }

        // 3. Respuesta de éxito
        return res.status(200).json({
            success: true,
            message: "Ubicación eliminada correctamente.",
            data: { id }
        });

    } catch (error) {
        console.error("Error en deleteOfficeLocation:", error);
        
        return res.status(500).json({
            success: false,
            message: "Error interno al intentar eliminar la ubicación.",
            error: error.message
        });
    }
};

module.exports = {
    createOfficeLocation,
    getAllLocations,
    updateOfficeLocation,
    deleteOfficeLocation
};