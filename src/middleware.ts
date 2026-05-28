import type { Request, Response } from 'express';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function requireOrgId(req: Request, res: Response): string | null {
  const orgId = req.header('x-org-id');
  if (!orgId || !UUID_RE.test(orgId)) {
    res.status(400).json({ error: 'x-org-id header must be a UUID' });
    return null;
  }
  return orgId;
}

export function requireUuidParam(
  req: Request,
  res: Response,
  name: string,
): string | null {
  const v = req.params[name];
  if (typeof v !== 'string' || !UUID_RE.test(v)) {
    res.status(400).json({ error: `${name} must be a UUID` });
    return null;
  }
  return v;
}
