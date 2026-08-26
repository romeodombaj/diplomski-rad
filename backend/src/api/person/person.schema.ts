import { z } from 'zod';

const PERSON_TYPES = ['employee', 'contractor', 'visitor', 'service'] as const;

// Contact detail, never a credential — people authenticate on their phone.
const optionalStr = z.string().trim().min(1).nullable().optional();
const optionalDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD').nullable().optional();

export const CreatePersonSchema = z.object({
  full_name: z.string().trim().min(1),
  employee_no: optionalStr,
  email: z.string().trim().email().nullable().optional(),
  phone: optionalStr,
  department: optionalStr,
  job_title: optionalStr,
  person_type: z.enum(PERSON_TYPES).optional(),
  employment_start: optionalDate,
  employment_end: optionalDate,
});

// person_type is immutable after creation, and status moves only through the
// lifecycle endpoints so every transition has an explicit audit point.
export const UpdatePersonSchema = z.object({
  full_name: z.string().trim().min(1).optional(),
  employee_no: optionalStr,
  email: z.string().trim().email().nullable().optional(),
  phone: optionalStr,
  department: optionalStr,
  job_title: optionalStr,
  employment_start: optionalDate,
  employment_end: optionalDate,
});

export const SuspendPersonSchema = z.object({
  reason: z.string().trim().min(1).optional(),
});

export const OffboardPersonSchema = z.object({
  reason: z.string().trim().min(1).optional(),
});

export const RevokeDeviceSchema = z.object({
  reason: z.string().trim().min(1).optional(),
});

/** Mobile → backend. Presented with the one-time enrolment token. */
export const ClaimEnrollmentSchema = z.object({
  token: z.string().trim().min(1),
  did: z.string().trim().min(1),
  publicKey: z.string().trim().min(1),
  deviceInfo: z
    .object({
      platform: z.string().trim().min(1).optional(),
      model: z.string().trim().min(1).optional(),
    })
    .optional(),
});
