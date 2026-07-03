const { z } = require("zod");

const COORDS_MSG = "latitude and longitude are required";

// Coerce so numeric strings ("12.97") are accepted like the original math path.
const punchSchema = z
  .object({
    latitude: z.coerce.number({ error: COORDS_MSG }),
    longitude: z.coerce.number({ error: COORDS_MSG }),
    employee_ids: z.array(z.any()).optional(),
  })
  .loose();

module.exports = {
  checkinSchema: punchSchema,
  checkoutSchema: punchSchema,
};
