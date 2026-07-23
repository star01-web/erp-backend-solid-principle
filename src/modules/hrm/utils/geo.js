/**
 * Geospatial helpers for geofencing.
 */

// Haversine distance between two lat/lon points, in meters.
const getDistance = (lat1, lon1, lat2, lon2) => {
  // Sequelize returns DECIMAL columns as strings; parseFloat ensures numeric math.
  const la1 = parseFloat(lat1);
  const lo1 = parseFloat(lon1);
  const la2 = parseFloat(lat2);
  const lo2 = parseFloat(lon2);

  const R = 6371e3; // Earth's radius in meters
  const φ1 = (la1 * Math.PI) / 180;
  const φ2 = (la2 * Math.PI) / 180;
  const Δφ = ((la2 - la1) * Math.PI) / 180;
  const Δλ = ((lo2 - lo1) * Math.PI) / 180;

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
const findMatchingSite = (sites, latitude, longitude) => {
  const userLat = parseFloat(latitude);
  const userLng = parseFloat(longitude);

  for (const site of sites) {
    const siteLat = parseFloat(site.latitude);
    const siteLng = parseFloat(site.longitude);
    const radius = Number(site.radiusInMeters) || 100;
    const distance = getDistance(userLat, userLng, siteLat, siteLng);

    console.log(
      `📍 Geofence check: "${site.locationName}" ` +
      `| user(${userLat}, ${userLng}) vs site(${siteLat}, ${siteLng}) ` +
      `| distance: ${distance.toFixed(1)}m, radius: ${radius}m ` +
      `| ${distance <= radius ? "✅ INSIDE" : "❌ OUTSIDE"}`,
    );

    if (distance <= radius) return site;
  }

  return null;
};

module.exports = { getDistance, findMatchingSite };
