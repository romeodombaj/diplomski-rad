export type PersonType = 'employee' | 'contractor' | 'visitor' | 'service';
export type PersonStatus = 'invited' | 'enrolling' | 'active' | 'suspended' | 'offboarded';

export interface Person {
  id: string;
  building_id: number;
  full_name: string;
  employee_no: string | null;
  email: string | null;
  phone: string | null;
  department: string | null;
  job_title: string | null;
  person_type: PersonType;
  status: PersonStatus;
  did: string | null;
  enrolled_at: string | null;
  employment_start: string | null;
  employment_end: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreatePersonDto {
  full_name: string;
  employee_no?: string | null;
  email?: string | null;
  phone?: string | null;
  department?: string | null;
  job_title?: string | null;
  person_type?: PersonType;
  employment_start?: string | null;
  employment_end?: string | null;
}

export interface UpdatePersonDto {
  full_name?: string;
  employee_no?: string | null;
  email?: string | null;
  phone?: string | null;
  department?: string | null;
  job_title?: string | null;
  employment_start?: string | null;
  employment_end?: string | null;
}

export interface PersonSearchParams {
  q?: string;
  cursor?: string;
  limit?: number;
  count?: string;
  sort?: string;
  order?: 'asc' | 'desc';
  page?: number;
  status?: string;
  person_type?: string;
  department?: string;
  no_did?: string;
  include_offboarded?: string;
  created_at_from?: string;
  created_at_to?: string;
  updated_at_from?: string;
  updated_at_to?: string;
}

export interface PersonCursorPage {
  data: Person[];
  nextCursor: string | null;
  hasMore: boolean;
  total?: number;
}

export interface PersonDevice {
  id: number;
  person_id: string;
  did: string;
  platform: string | null;
  model: string | null;
  enrolled_at: string;
  revoked_at: string | null;
  revocation_reason: string | null;
}

export interface EnrollmentInvite {
  token: string;
  expires_at: string;
  person_id: string;
}
