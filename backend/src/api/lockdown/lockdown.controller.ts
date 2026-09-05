import type { Request, Response, NextFunction } from 'express';
import * as lockdownService from './lockdown.service';

const buildingOf = (req: Request) => (req.user as any).buildingId as number;
const operatorOf = (req: Request) => (req.user as any)?.email ?? (req.user as any)?.userId;

export async function getState(req: Request, res: Response, next: NextFunction) {
  try {
    res.json({ success: true, data: await lockdownService.getState(buildingOf(req)) });
  } catch (err) { next(err); }
}

export async function setBuilding(req: Request, res: Response, next: NextFunction) {
  try {
    const state = await lockdownService.setBuilding(
      buildingOf(req), Boolean(req.body?.active), operatorOf(req),
    );
    res.json({ success: true, data: state });
  } catch (err) { next(err); }
}

export async function setDoor(req: Request, res: Response, next: NextFunction) {
  try {
    const out = await lockdownService.setDoor(
      buildingOf(req), Number(req.params.doorId), Boolean(req.body?.locked_down), operatorOf(req),
    );
    if (!out.ok) return res.status(404).json({ success: false, message: 'Door not found' });
    res.json({ success: true, data: await lockdownService.getState(buildingOf(req)) });
  } catch (err) { next(err); }
}
