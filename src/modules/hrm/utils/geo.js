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
 * Returns the first project site whose geofence contains the given point, or null.
 * @param {Array} sites - ProjectSite records (latitude, longitude, radiusInMeters)
 */
const findMatchingSite = (sites, latitude, longitude) =>
  sites.find((site) => {
    const distance = getDistance(
      latitude,
      longitude,
      site.latitude,
      site.longitude,
    );
    return distance <= (site.radiusInMeters || 100);
  });

module.exports = { getDistance, findMatchingSite };
