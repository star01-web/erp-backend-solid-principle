const { z } = require("zod");

/**
 * Zod validation schema for Site Wise Material Summary Report query parameters.
 */
const dateStringRegex = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}(\.\d{3})?Z?)?$/;

const siteMaterialSummaryQuerySchema = z
  .object({
    projectId: z.string().trim().optional(),
    siteId: z.string().trim().optional(),
    productId: z.string().trim().optional(),
    manufacturerId: z.string().trim().optional(),
    fromDate: z
      .string()
      .trim()
      .refine((val) => !val || dateStringRegex.test(val), {
        message: "fromDate must be a valid date string (e.g. YYYY-MM-DD)",
      })
      .optional(),
    toDate: z
      .string()
      .trim()
      .refine((val) => !val || dateStringRegex.test(val), {
        message: "toDate must be a valid date string (e.g. YYYY-MM-DD)",
      })
      .optional(),
  })
  .refine(
    (data) => {
      if (data.fromDate && data.toDate) {
        return new Date(data.fromDate) <= new Date(data.toDate);
      }
      return true;
    },
    {
      message: "fromDate must be earlier than or equal to toDate",
      path: ["fromDate"],
    },
  )
  .loose();

module.exports = {
  siteMaterialSummaryQuerySchema,
};
