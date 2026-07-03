const axios = require("axios");

/**
 * Reverse-geocode a coordinate to a human-readable address via OpenStreetMap
 * Nominatim. Falls back to a coordinate string on failure (never throws).
 */
const getAddressFromOSM = async (lat, lon) => {
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lon}`;

    const response = await axios.get(url, {
      headers: {
        "User-Agent": "StarERP_HRM_System",
      },
      timeout: 5000,
    });

    return response.data.display_name || `Lat: ${lat}, Lon: ${lon}`;
  } catch (error) {
    console.error("❌ OSM Fetch Error:", error.message);
    return `Coordinates: ${lat}, ${lon}`;
  }
};

module.exports = { getAddressFromOSM };
