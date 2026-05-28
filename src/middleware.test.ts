import { describe, expect, it, vi } from 'vitest';
import type { Request, Response } from 'express';
import { requireOrgId, requireUuidParam } from './middleware.js';

const VALID_UUID = '0193e9b0-7e1f-7000-8000-000000000000';

function mockRes(): Response {
  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  };
  return res as unknown as Response;
}

describe('requireOrgId', () => {
  it('returns the org id when the header is a valid UUID', () => {
    const req = { header: () => VALID_UUID } as unknown as Request;
    const res = mockRes();
    expect(requireOrgId(req, res)).toBe(VALID_UUID);
    expect(res.status).not.toHaveBeenCalled();
  });

  it('rejects a missing header with 400', () => {
    const req = { header: () => undefined } as unknown as Request;
    const res = mockRes();
    expect(requireOrgId(req, res)).toBeNull();
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('rejects a malformed header with 400', () => {
    const req = { header: () => 'not-a-uuid' } as unknown as Request;
    const res = mockRes();
    expect(requireOrgId(req, res)).toBeNull();
    expect(res.status).toHaveBeenCalledWith(400);
  });
});

describe('requireUuidParam', () => {
  it('returns the param when it is a valid UUID', () => {
    const req = { params: { executionId: VALID_UUID } } as unknown as Request;
    const res = mockRes();
    expect(requireUuidParam(req, res, 'executionId')).toBe(VALID_UUID);
  });

  it('rejects a malformed param with 400', () => {
    const req = { params: { executionId: 'nope' } } as unknown as Request;
    const res = mockRes();
    expect(requireUuidParam(req, res, 'executionId')).toBeNull();
    expect(res.status).toHaveBeenCalledWith(400);
  });
});
