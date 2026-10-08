'use strict';

jest.mock('../../../services/solana/stake-account-service');

const controller = require('../solana-account-controller');
const stakeService = require('../../../services/solana/stake-account-service');

const WALLET = 'CzNRNm6vbDiJ2MG96Lw4gSZW1gSjeV6DgSEAjCULxXcJ';

const response = () => {
  const res = { locals: { network: { environment: 'mainnet' } } };
  res.status = jest.fn(() => res);
  res.json = jest.fn(() => res);
  res.send = jest.fn(() => res);
  return res;
};

describe('listStakes', () => {
  beforeEach(() => jest.clearAllMocks());

  test('answers the stake accounts in the public shape, amounts as strings', async () => {
    stakeService.listStakeAccounts.mockResolvedValue({
      epoch: 1052,
      usdPrice: 108.2,
      accounts: [
        {
          address: 'E5zHk2dnsnk6bL94BPe3svRczbT6WfZnmcQm3wVVEQRs',
          lamports: 1002513301,
          delegatedLamports: '1000847061',
          voter: 'Sa1HXZsn2u6p2dMLZGhfxtsRw7Jo32hF15yBghWJsCz',
          activationEpoch: 1046,
          deactivationEpoch: null,
          state: 'active',
          validator: { name: 'Salmon Wallet', iconUrl: 'https://i.ibb.co/d4MQcwKL/salmon.png' },
          rewards: [{ epoch: 1051, lamports: 169992, postBalance: 1002513301 }],
        },
      ],
    });
    const res = response();

    await controller.listStakes({ params: { address: WALLET } }, res);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.send).toHaveBeenCalledWith({
      epoch: 1052,
      usdPrice: 108.2,
      data: [
        {
          address: 'E5zHk2dnsnk6bL94BPe3svRczbT6WfZnmcQm3wVVEQRs',
          lamports: '1002513301',
          delegatedLamports: '1000847061',
          voter: 'Sa1HXZsn2u6p2dMLZGhfxtsRw7Jo32hF15yBghWJsCz',
          validator: { name: 'Salmon Wallet', iconUrl: 'https://i.ibb.co/d4MQcwKL/salmon.png' },
          activationEpoch: 1046,
          deactivationEpoch: null,
          state: 'active',
          rewards: [{ epoch: 1051, lamports: '169992', postBalance: '1002513301' }],
        },
      ],
    });
  });

  test('refuses an address that is not a Solana address', async () => {
    const res = response();

    await controller.listStakes({ params: { address: 'not-an-address' } }, res);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(stakeService.listStakeAccounts).not.toHaveBeenCalled();
  });
});
