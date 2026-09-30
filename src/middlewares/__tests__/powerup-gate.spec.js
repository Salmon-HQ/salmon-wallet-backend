'use strict';

jest.mock('../../availability/country-resolver', () => ({ countryOfRequest: jest.fn() }));
jest.mock('../../availability/availability-table', () => ({
  ...jest.requireActual('../../availability/availability-table'),
  loadTable: jest.fn(),
}));
jest.mock('../../services/solana/powerups/powerup-catalog-service', () => ({ listFor: jest.fn() }));
jest.mock('../../services/shared/network-capabilities-service', () => ({ getPowerups: jest.fn() }));

const powerupGate = require('../powerup-gate');
const { countryOfRequest } = require('../../availability/country-resolver');
const { loadTable, DEFAULT_TABLE } = require('../../availability/availability-table');

const req = (platform, id = 'swap') => ({
  params: { id },
  headers: platform ? { 'x-salmon-platform': platform } : {},
});
const createRes = () => ({
  locals: {},
  status: jest.fn().mockReturnThis(),
  json: jest.fn(),
});

const run = async (table, request, capability = 'swap') => {
  loadTable.mockResolvedValue(table);
  const res = createRes();
  const next = jest.fn();
  await powerupGate(capability)(request, res, next);
  return { res, next };
};

describe('powerup-gate', () => {
  let info;

  beforeEach(() => {
    jest.clearAllMocks();
    info = jest.spyOn(console, 'info').mockImplementation(() => {});
  });

  afterEach(() => info.mockRestore());

  it('refuses a blocked country with 403 region_restricted and never calls next', async () => {
    countryOfRequest.mockReturnValue('CU');
    const { res, next } = await run(DEFAULT_TABLE, req('android'));
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ error: 'region_restricted' }));
    expect(next).not.toHaveBeenCalled();
    expect(res.locals.availability).toBeUndefined();
  });

  it('passes an allowed country with the routing provider in res.locals', async () => {
    countryOfRequest.mockReturnValue('AR');
    const { res, next } = await run(DEFAULT_TABLE, req('android'));
    expect(next).toHaveBeenCalledWith();
    expect(res.locals.availability).toEqual({
      capability: 'swap',
      platform: 'android',
      country: 'AR',
      provider: 'jupiter',
    });
  });

  it('routes a Jupiter-prohibited country to 0x', async () => {
    countryOfRequest.mockReturnValue('SG');
    const { res } = await run(DEFAULT_TABLE, req('extension'));
    expect(res.locals.availability.provider).toBe('0x');
  });

  it('fails open with the default provider when the country is unresolvable', async () => {
    countryOfRequest.mockReturnValue(null);
    const { res, next } = await run(DEFAULT_TABLE, req('ios'));
    expect(next).toHaveBeenCalledWith();
    expect(res.locals.availability).toMatchObject({ country: null, provider: 'jupiter' });
  });

  it('blocks the US on every platform, header or not', async () => {
    countryOfRequest.mockReturnValue('US');
    for (const platform of ['ios', 'android', 'extension', undefined, 'web']) {
      const { res } = await run(DEFAULT_TABLE, req(platform));
      expect(res.status).toHaveBeenCalledWith(403);
    }
  });

  it('applies a platform override', async () => {
    const table = JSON.parse(JSON.stringify(DEFAULT_TABLE));
    table.capabilities.swap.platforms.ios = {
      unavailable: [...table.capabilities.swap.unavailable, 'AR'],
    };
    countryOfRequest.mockReturnValue('AR');
    const ios = await run(table, req('ios'));
    expect(ios.res.status).toHaveBeenCalledWith(403);
    const android = await run(table, req('android'));
    expect(android.next).toHaveBeenCalledWith();
  });

  it('reads the capability from :id when mounted with "param" and passes unknown capabilities', async () => {
    countryOfRequest.mockReturnValue('US');
    const { res, next } = await run(DEFAULT_TABLE, req('ios', 'memo'), 'param');
    expect(next).toHaveBeenCalledWith();
    expect(res.locals.availability).toEqual({
      capability: 'memo',
      platform: 'ios',
      country: 'US',
      provider: null,
    });
  });

  it('logs the decision without the address', async () => {
    countryOfRequest.mockReturnValue('BR');
    await run(DEFAULT_TABLE, { ...req('android'), query: { publicKey: 'WALLET' } });
    expect(info).toHaveBeenCalledWith('[POWERUP_GATE]', {
      capability: 'swap',
      platform: 'android',
      country: 'BR',
      enabled: true,
      provider: 'jupiter',
    });
    expect(JSON.stringify(info.mock.calls)).not.toContain('WALLET');
  });
});
