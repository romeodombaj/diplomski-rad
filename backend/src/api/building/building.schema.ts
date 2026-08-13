import { z } from 'zod';

export const CreateBuildingSchema = z.object({
  name: z.string().min(1),
  address: z.string().min(1),
  contract_address: z.string().min(1),
});

export const UpdateBuildingSchema = z.object({
  name: z.string().min(1).optional(),
  address: z.string().min(1).optional(),
  contract_address: z.string().min(1).optional(),
});
