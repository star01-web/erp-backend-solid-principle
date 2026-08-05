const { z } = require("zod");

const projectConsumptionQuerySchema = z
  .object({
    projectId: z.string().optional(),
    fromDate: z.string().optional(),
    toDate: z.string().optional(),
  })
  .passthrough();

const siteConsumptionQuerySchema = z
  .object({
    siteId: z.string().optional(),
    projectId: z.string().optional(),
    fromDate: z.string().optional(),
    toDate: z.string().optional(),
  })
  .passthrough();

module.exports = {
  projectConsumptionQuerySchema,
  siteConsumptionQuerySchema,
};
