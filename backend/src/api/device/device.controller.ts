import type { Request, Response, NextFunction } from 'express';
import * as deviceService from './device.service';
import type { CreateDeviceInput, UpdateDeviceInput } from './device.schema';

const buildingOf = (req: Request) => (req.user as any).buildingId as number;

export async function getAll(req: Request, res: Response, next: NextFunction) {
  try {
    const page = await deviceService.getAll(buildingOf(req), req.query as any);
    res.json({ success: true, ...page });
  } catch (err) { next(err); }
}

export async function getById(req: Request, res: Response, next: NextFunction) {
  try {
    const device = await deviceService.getById(buildingOf(req), Number(req.params.id));
    if (!device) return res.status(404).json({ success: false, message: 'Device not found' });
    res.json({ success: true, data: device });
  } catch (err) { next(err); }
}

export async function create(req: Request, res: Response, next: NextFunction) {
  try {
    const device = await deviceService.create(buildingOf(req), req.body as CreateDeviceInput);
    res.status(201).json({ success: true, data: device });
  } catch (err: any) {
    if (err?.status === 404) return res.status(404).json({ success: false, message: 'Door not found' });
    if (err?.status === 409) return res.status(409).json({ success: false, message: err.message });
    next(err);
  }
}

export async function update(req: Request, res: Response, next: NextFunction) {
  try {
    const device = await deviceService.update(
      buildingOf(req), Number(req.params.id), req.body as UpdateDeviceInput,
    );
    if (!device) return res.status(404).json({ success: false, message: 'Device not found' });
    res.json({ success: true, data: device });
  } catch (err: any) {
    if (err?.status === 404) return res.status(404).json({ success: false, message: 'Door not found' });
    if (err?.status === 409) return res.status(409).json({ success: false, message: err.message });
    next(err);
  }
}

export async function remove(req: Request, res: Response, next: NextFunction) {
  try {
    await deviceService.remove(buildingOf(req), Number(req.params.id));
    res.status(204).send();
  } catch (err) { next(err); }
}

export async function listForDoor(req: Request, res: Response, next: NextFunction) {
  try {
    const rows = await deviceService.listForDoor(buildingOf(req), Number(req.params.doorId));
    res.json({ success: true, data: rows });
  } catch (err) { next(err); }
}

export async function scan(req: Request, res: Response, next: NextFunction) {
  try {
    const seconds = (req.body?.seconds as number | undefined) ?? 8;
    const found = await deviceService.scan(buildingOf(req), seconds);
    res.json({ success: true, data: found });
  } catch (err) { next(err); }
}
