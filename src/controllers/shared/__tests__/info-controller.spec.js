'use strict';

jest.mock('../../../../packages/health-check', () => ({
  healthCheck: jest.fn(),
}));

jest.mock('../../../repositories/data-source', () => ({
  redis: {},
}));

const { healthCheck } = require('../../../../packages/health-check');
const { name, version } = require('../../../../package.json');
const controller = require('../info-controller');

describe('info-controller', () => {
  const buildRes = () => ({
    set: jest.fn(),
    status: jest.fn().mockReturnThis(),
    send: jest.fn(),
  });

  let originalEnv;

  beforeEach(() => {
    jest.clearAllMocks();
    originalEnv = {
      GITHUB_RUN_ID: process.env.GITHUB_RUN_ID,
      GITHUB_SHA: process.env.GITHUB_SHA,
      STAGE: process.env.STAGE,
    };
    process.env.GITHUB_RUN_ID = 'run-42';
    process.env.GITHUB_SHA = 'sha-deadbeef';
    process.env.STAGE = 'develop';
  });

  afterEach(() => {
    process.env.GITHUB_RUN_ID = originalEnv.GITHUB_RUN_ID;
    process.env.GITHUB_SHA = originalEnv.GITHUB_SHA;
    process.env.STAGE = originalEnv.STAGE;
  });

  describe('status', () => {
    it('returns 200 with name, version, build, commit, stage, and a fresh timestamp', async () => {
      const res = buildRes();
      await controller.status({}, res);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.send).toHaveBeenCalledWith(
        expect.objectContaining({
          name,
          version,
          build: 'run-42',
          commit: 'sha-deadbeef',
          stage: 'develop',
          time: expect.any(Date),
        })
      );
    });

    it("tells the caller where the country gate places them, and the database's date", async () => {
      const res = buildRes();
      await controller.status(
        { requestContext: { identity: { sourceIp: '8.8.8.8' } }, headers: {} },
        res
      );

      expect(res.set).toHaveBeenCalledWith('Cache-Control', 'no-store');
      expect(res.send).toHaveBeenCalledWith(
        expect.objectContaining({
          country: 'US',
          countryDatabase: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
        })
      );
    });
  });

  describe('health', () => {
    it('mirrors statusCode + info from healthCheck', async () => {
      healthCheck.mockResolvedValue({ statusCode: 200, info: { REDIS: 'up' } });
      const res = buildRes();
      const req = {};

      await controller.health(req, res);

      expect(healthCheck).toHaveBeenCalledWith(
        req,
        expect.objectContaining({ REDIS: expect.anything() })
      );
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.send).toHaveBeenCalledWith({ REDIS: 'up' });
    });

    it('forwards a non-200 statusCode when healthCheck reports degraded', async () => {
      healthCheck.mockResolvedValue({ statusCode: 503, info: { REDIS: 'down' } });
      const res = buildRes();

      await controller.health({}, res);

      expect(res.status).toHaveBeenCalledWith(503);
      expect(res.send).toHaveBeenCalledWith({ REDIS: 'down' });
    });
  });
});
