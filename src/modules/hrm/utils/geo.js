/**
 * Geospatial helpers for geofencing.
 */

// Haversine distance between two lat/lon points, in meters.
const getDistance = (lat1, lon1, lat2, lon2) => {
  const R = 6371e3; // Earth's radius in meters
  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const Δφ = ((lat2 - lat1) * Math.PI) / 180;
  const Δλ = ((lon2 - lon1) * Math.PI) / 180;

  const a =
    Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c; // Distance in meters
};

/**
 * Returns the first office whose geofence contains the given point, or null.
 * @param {Array} offices - OfficeLocation records (latitude, longitude, radiusInMeters)
 */
const findMatchingOffice = (offices, latitude, longitude) =>
  offices.find((office) => {
    const distance = getDistance(
      latitude,
      longitude,
      office.latitude,
      office.longitude,
    );
    return distance <= (office.radiusInMeters || 100);
  });

module.exports = { getDistance, findMatchingOffice };
