import db from '../../db';
import type { Door, CreateDoorDto, UpdateDoorDto, DoorSearchParams, DoorCursorPage } from './door.types';

// Strip internal fields before returning to clients
const strip = ({ project_id: _, ...rest }: any): Door => rest;

export const getAll = async (projectId: string, params: DoorSearchParams): Promise<DoorCursorPage> => {
  const limit = Number(params.limit) || 20;
  const SORTABLE_COLS = new Set<string>(['id', 'building_id', 'name', 'door_code', 'mqtt_topic', 'active', 'created_at', 'updated_at']);
  const sortCol = params.sort && SORTABLE_COLS.has(params.sort) ? params.sort : 'id';
  const sortDir = params.order === 'desc' ? 'desc' : 'asc';

  const base = db('doors').where({ project_id: projectId }).whereNull('deleted_at').orderBy(sortCol, sortDir);
  if (sortCol === 'id') {
    if (params.cursor) base.where('id', '>', Number(params.cursor));
  } else {
    const pg = Number(params.page) || 1;
    base.offset((pg - 1) * limit);
  }

  if (params.active !== undefined && params.active !== '') base.where('active', params.active === 'true');
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

export const getById = async (projectId: string, id: number): Promise<Door | undefined> => {
  const row = await db('doors').where({ id, project_id: projectId }).whereNull('deleted_at').first();
  return row ? strip(row) : undefined;
};

export const create = async (projectId: string, data: CreateDoorDto): Promise<Door> => {
  const [id] = await db('doors').insert({ ...data, project_id: projectId });
  return getById(projectId, id) as Promise<Door>;
};

export const update = async (projectId: string, id: number, data: UpdateDoorDto): Promise<Door | undefined> => {
  await db('doors').where({ id, project_id: projectId }).update({ ...data, updated_at: new Date().toISOString() });
  return getById(projectId, id);
};

export const remove = async (projectId: string, id: number): Promise<void> => {
  await db('doors').where({ id, project_id: projectId }).whereNull('deleted_at').update({ deleted_at: new Date().toISOString() });
};
