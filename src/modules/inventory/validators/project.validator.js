const { z } = require("zod");

const nonEmpty = (message) =>
  z.string({ error: message }).trim().min(1, { message });

const createProjectSchema = z
  .object({
    project_name: nonEmpty("project_name is required."),
    project_code: z.string().trim().optional(),
    description: z.string().optional(),
    client_name: z.string().optional(),
    manager_name: z.string().optional(),
    contact_number: z.string().optional(),
    location: z.string().optional(),
    start_date: z.string().optional(),
    end_date: z.string().optional(),
  })
  .passthrough();

const updateProjectSchema = z
  .object({
    project_name: z.string().trim().min(1).optional(),
    project_code: z.string().trim().optional(),
    description: z.string().optional(),
    client_name: z.string().optional(),
    manager_name: z.string().optional(),
    contact_number: z.string().optional(),
    location: z.string().optional(),
    start_date: z.string().optional(),
    end_date: z.string().optional(),
    is_active: z.boolean().optional(),
  })
  .passthrough();

const projectOutwardSchema = z
  .object({
    warehouse_id: nonEmpty("warehouse_id (source warehouse) is required."),
    project_id: nonEmpty("project_id (target project) is required."),
    item_id: nonEmpty("item_id (product id) is required."),
    quantity: z.coerce.number().positive("quantity must be greater than zero."),
    uom: z.string().optional(),
    manufacturer_id: z.string().optional(),
    color: z.string().optional(),
    reference_no: z.string().optional(),
    remarks: z.string().optional(),
  })
  .passthrough();

const projectTransferSchema = z
  .object({
    source_project_id: nonEmpty("source_project_id is required."),
    target_project_id: nonEmpty("target_project_id is required."),
    item_id: nonEmpty("item_id (product id) is required."),
    quantity: z.coerce.number().positive("quantity must be greater than zero."),
    uom: z.string().optional(),
    manufacturer_id: z.string().optional(),
    color: z.string().optional(),
    reference_no: z.string().optional(),
    remarks: z.string().optional(),
  })
  .passthrough();

module.exports = {
  createProjectSchema,
  updateProjectSchema,
  projectOutwardSchema,
  projectTransferSchema,
};
