import db from '../../db';
import type { Totp_secret, CreateTotp_secretDto, UpdateTotp_secretDto, Totp_secretSearchParams, Totp_secretCursorPage } from './totp_secret.types';

// Strip internal fields before returning to clients
const strip = ({ building_id: _, ...rest }: any): Totp_secret => rest;

export const getAll = async (buildingId: number, params: Totp_secretSearchParams): Promise<Totp_secretCursorPage> => {
  const limit = Number(params.limit) || 20;
  const SORTABLE_COLS = new Set<string>(['id', 'did', 'secret', 'period', 'digits', 'created_at', 'updated_at']);
  const sortCol = params.sort && SORTABLE_COLS.has(params.sort) ? params.sort : 'id';
  const sortDir = params.order === 'desc' ? 'desc' : 'asc';

  const base = db('totp_secrets').where({ building_id: buildingId }).whereNull('deleted_at').orderBy(sortCol, sortDir);
  if (sortCol === 'id') {
    if (params.cursor) base.where('id', '>', Number(params.cursor));
  } else {
    const pg = Number(params.page) || 1;
    base.offset((pg - 1) * limit);
  }

  if (params.created_at_from) base.where('created_at', '>=', params.created_at_from);
  if (params.created_at_to) base.where('created_at', '<=', params.created_at_to);
  if (params.updated_at_from) base.where('updated_at', '>=', params.updated_at_from);
  if (params.updated_at_to) base.where('updated_at', '<=', params.updated_at_to);
  const rows = await base.clone().limit(limit + 1);
  const hasMore = rows.length > limit;
  const data = (hasMore ? rows.slice(0, limit) : rows).map(strip);
  const nextCursor = hasMore ? String(data[data.length - 1].id) : null;

  let total: number | undefined;
  if (params.count === 'true') {
    const countRow = await base.clone().count('* as count').first();
    total = Number((countRow as any).count);
  }

  return { data, nextCursor, hasMore, total };
};

export const getById = async (buildingId: number, id: number): Promise<Totp_secret | undefined> => {
  const row = await db('totp_secrets').where({ id, building_id: buildingId }).whereNull('deleted_at').first();
  return row ? strip(row) : undefined;
};

export const create = async (buildingId: number, data: CreateTotp_secretDto): Promise<Totp_secret> => {
  const [id] = await db('totp_secrets').insert({ ...data, building_id: buildingId });
  return getById(buildingId, id) as Promise<Totp_secret>;
};

export const update = async (buildingId: number, id: number, data: UpdateTotp_secretDto): Promise<Totp_secret | undefined> => {
  await db('totp_secrets').where({ id, building_id: buildingId }).update({ ...data, updated_at: new Date().toISOString() });
  return getById(buildingId, id);
};

export const remove = async (buildingId: number, id: number): Promise<void> => {
  await db('totp_secrets').where({ id, building_id: buildingId }).whereNull('deleted_at').update({ deleted_at: new Date().toISOString() });
};
