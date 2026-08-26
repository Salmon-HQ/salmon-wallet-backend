'use strict';

jest.mock('../../../../packages/health-check', () => ({
  healthCheck: jest.fn(),
}));

jest.mock('../../../repositories/data-source', () => ({
  redis: {},
}));

jest.mock('../../../services/shared/geo-service', () => ({
  getCallerGeo: jest.fn(),
}));

const geoService = require('../../../services/shared/geo-service');
const { healthCheck } = require('../../../../packages/health-check');
const { name, version } = require('../../../../package.json');
const controller = require('../info-controller');

describe('info-controller', () => {
  const buildRes = () => ({
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

  describe('ip', () => {
    it('forwards the service payload on success', async () => {
      geoService.getCallerGeo.mockResolvedValue({ country: 'AR', query: '1.2.3.4' });
      const res = buildRes();

      await controller.ip({}, res);

      expect(geoService.getCallerGeo).toHaveBeenCalledTimes(1);
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.send).toHaveBeenCalledWith({ country: 'AR', query: '1.2.3.4' });
    });

    it('propagates upstream failures to the error middleware', async () => {
      const err = new Error('boom');
      geoService.getCallerGeo.mockRejectedValue(err);
      const res = buildRes();

      await expect(controller.ip({}, res)).rejects.toThrow(err);

      expect(res.status).not.toHaveBeenCalled();
      expect(res.send).not.toHaveBeenCalled();
    });
  });
});
