'use strict';

jest.mock('../../../services/solana/skr-staking-service', () => ({
  getSkrStake: jest.fn(),
}));

const controller = require('../solana-skr-controller');
const skrService = require('../../../services/solana/skr-staking-service');

const OWNER = 'CzNRNm6vbDiJ2MG96Lw4gSZW1gSjeV6DgSEAjCULxXcJ';

const response = (networkId = 'solana-mainnet') => {
  const res = { locals: { network: { id: networkId, environment: 'mainnet' } } };
  res.status = jest.fn(() => res);
  res.json = jest.fn(() => res);
  res.send = jest.fn(() => res);
  return res;
};

beforeEach(() => jest.clearAllMocks());

test('answers the position with amounts as strings', async () => {
  skrService.getSkrStake.mockResolvedValue({
    mint: 'SKRbvo6Gf7GondiT3BbTfuRDPqLWei4j2Qy2NPGZhW3',
    sharePrice: 1151142678n,
    cooldownSeconds: 172800,
    apy: 0.151,
    usdPrice: 0.01622,
    liquid: 3000000n,
    totalStaked: 5026970696857042n,
    logo: 'https://assets.coingecko.com/seeker-logo.jpg',
    positions: [
      {
        address: '7yFnVkeEk4Qd6jgGsjrU4rhYDd7UQ985ah1VgWNg8m58',
        staked: 46045707120n,
        earned: 6045707120n,
        guardian: { pool: 'DPJ58', name: 'Solana Mobile Guardian', commissionBps: 0, active: true },
        unstaking: { amount: 5000000n, withdrawableAt: 1791000000000 },
        stakedSince: null,
        history: [{ at: 1791000000000, earned: 25707120n }],
      },
    ],
  });
  const res = response();

  await controller.getStake({ query: { owner: OWNER } }, res);

  expect(res.status).toHaveBeenCalledWith(200);
  expect(res.send).toHaveBeenCalledWith({
    mint: 'SKRbvo6Gf7GondiT3BbTfuRDPqLWei4j2Qy2NPGZhW3',
    decimals: 6,
    sharePrice: '1151142678',
    cooldownSeconds: 172800,
    apy: 0.151,
    usdPrice: 0.01622,
    liquid: '3000000',
    totalStaked: '5026970696857042',
    logo: 'https://assets.coingecko.com/seeker-logo.jpg',
    positions: [
      {
        address: '7yFnVkeEk4Qd6jgGsjrU4rhYDd7UQ985ah1VgWNg8m58',
        staked: '46045707120',
        earned: '6045707120',
        guardian: { pool: 'DPJ58', name: 'Solana Mobile Guardian', commissionBps: 0, active: true },
        unstaking: { amount: '5000000', withdrawableAt: 1791000000000 },
        stakedSince: null,
        history: [{ at: 1791000000000, earned: '25707120' }],
      },
    ],
  });
});

test('is mainnet only', async () => {
  const res = response('solana-devnet');

  await controller.getStake({ query: { owner: OWNER } }, res);

  expect(res.status).toHaveBeenCalledWith(404);
  expect(skrService.getSkrStake).not.toHaveBeenCalled();
});

test('refuses an owner that is not a Solana address', async () => {
  const res = response();

  await controller.getStake({ query: { owner: 'nope' } }, res);

  expect(res.status).toHaveBeenCalledWith(400);
  expect(skrService.getSkrStake).not.toHaveBeenCalled();
});
