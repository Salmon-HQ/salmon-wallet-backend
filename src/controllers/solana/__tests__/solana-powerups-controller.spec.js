'use strict';

jest.mock('../../../../packages/api-utils', () => ({
  decorator: jest.fn(async (resource, data) => resource(data)),
}));
jest.mock('../../../services/solana/powerups/powerup-build-service', () => ({ build: jest.fn() }));

const controller = require('../solana-powerups-controller');
const buildService = require('../../../services/solana/powerups/powerup-build-service');

const PAYER = '86xCnPeV69n6t3DnyGvkKobf9FdN2H9oiVDdaMpo2MMY';

const createRes = () => ({
  locals: { network: { id: 'solana-mainnet' } },
  status: jest.fn().mockReturnThis(),
  send: jest.fn(),
  json: jest.fn(),
});
const request = (query) => ({ params: { id: 'fixture' }, query });

describe('solana-powerups-controller', () => {
  let info;

  beforeEach(() => {
    jest.clearAllMocks();
    info = jest.spyOn(console, 'info').mockImplementation(() => {});
  });

  afterEach(() => info.mockRestore());

  it('requires a valid publicKey before touching the service', async () => {
    const missing = createRes();
    await controller.build(request({}), missing);
    expect(missing.status).toHaveBeenCalledWith(400);
    expect(missing.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: 'missing_parameter' })
    );

    const invalid = createRes();
    await controller.build(request({ publicKey: 'not-base58!' }), invalid);
    expect(invalid.status).toHaveBeenCalledWith(400);
    expect(invalid.json).toHaveBeenCalledWith(
      expect.objectContaining({ error: 'invalid_parameter' })
    );
    expect(buildService.build).not.toHaveBeenCalled();
  });

  it('delegates to the service, renders the resource and logs [POWERUP_BUILD] built', async () => {
    buildService.build.mockResolvedValue({
      transaction: 'AAAA',
      expiresAt: '2026-09-11T00:00:00.000Z',
      provider: { id: 'memo', displayName: 'Memo', attribution: 'Powered by Memo' },
      salmonFee: null,
      contributor: { name: 'Fixture Labs', url: 'https://fixture.example' },
      priorityFeeMicroLamports: 1000,
      computeUnitLimit: 11500,
      display: { note: 'hi' },
    });
    const res = createRes();

    await controller.build(request({ publicKey: PAYER, note: 'hi' }), res);

    expect(buildService.build).toHaveBeenCalledWith(
      'fixture',
      { publicKey: PAYER, note: 'hi' },
      res.locals
    );
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.send).toHaveBeenCalledWith({
      transaction: 'AAAA',
      expiresAt: '2026-09-11T00:00:00.000Z',
      provider: 'memo',
      providerDisplayName: 'Memo',
      attribution: 'Powered by Memo',
      salmonFee: null,
      routeFee: null,
      contributor: { name: 'Fixture Labs', url: 'https://fixture.example' },
      priorityFeeMicroLamports: 1000,
      computeUnitLimit: 11500,
      note: 'hi',
    });
    expect(info).toHaveBeenCalledWith('[POWERUP_BUILD]', {
      id: 'fixture',
      network: 'solana-mainnet',
      outcome: 'built',
    });
  });

  it('logs the error code as the outcome and lets the error reach the middleware', async () => {
    const error = Object.assign(new Error('nope'), { statusCode: 404, errorCode: 'not_found' });
    buildService.build.mockRejectedValue(error);

    await expect(controller.build(request({ publicKey: PAYER }), createRes())).rejects.toBe(error);
    expect(info).toHaveBeenCalledWith('[POWERUP_BUILD]', {
      id: 'fixture',
      network: 'solana-mainnet',
      outcome: 'not_found',
    });
  });
});
