const { z } = require("zod");

const MSG = "locationName, latitude, and longitude are required.";

// Presence check only; coordinate-range validation stays in the service so its
// distinct "Invalid coordinates provided." message is preserved.
const createProjectSiteSchema = z
  .object({
    locationName: z.string({ error: MSG }).trim().min(1, MSG),
    latitude: z.coerce.number({ error: MSG }),
    longitude: z.coerce.number({ error: MSG }),
  })
  .loose();

module.exports = { createProjectSiteSchema };
