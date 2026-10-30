'use strict';

jest.mock('axios', () => ({ get: jest.fn() }));
jest.mock('../../../../../infrastructure/providers/provider-client', () => ({
  providerCall: jest.fn((name, fn) => fn({ timeout: 3000, signal: 'signal' })),
}));

const FIXTURE = require('./fixtures/dagon-devnet-epoch2.json');

const T0 = new Date('2026-11-01T12:00:00Z').getTime();
const MINUTE = 60 * 1000;
const OTHER_KEY = 'Sett1erwx2eqT5A8uvu8GBxDFT2W5TNnhirL7hLmb8m';

const copy = (edit = () => {}) => {
  const doc = JSON.parse(JSON.stringify(FIXTURE));
  edit(doc);
  return doc;
};

describe('dagon config', () => {
  let axios;
  let providerCall;
  let config;
  let error;
  const locals = { network: { id: 'solana-devnet' } };

  beforeEach(() => {
    jest.resetModules();
    jest.useFakeTimers({ now: T0 });
    axios = require('axios');
    ({ providerCall } = require('../../../../../infrastructure/providers/provider-client'));
    config = require('../dagon/config');
    error = jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.useRealTimers();
    error.mockRestore();
  });

  const unavailable = { statusCode: 503, errorCode: 'dagon_config_unavailable' };

  it('accepts the epoch 2 copy, fetched under the dagon-config profile', async () => {
    axios.get.mockResolvedValue({ data: copy() });

    const accepted = await config.getConfig(locals);

    expect(accepted).toMatchObject({ epoch: 2, cluster: 'devnet', pool: FIXTURE.pool });
    expect(providerCall).toHaveBeenCalledWith('dagon-config', expect.any(Function), { locals });
    expect(axios.get).toHaveBeenCalledWith(
      'https://raw.githubusercontent.com/inkwell-finance/pc-wallet-kit/main/devnet.json',
      expect.objectContaining({ timeout: 3000, signal: 'signal' })
    );
  });

  it('pins the program ids the registry reuses', () => {
    expect(config.PC_TOKEN_PROGRAM_ID).toBe(FIXTURE.programs.pcToken);
    expect(config.PC_SWAP_PROGRAM_ID).toBe(FIXTURE.programs.pcSwap);
    expect(config.ENCRYPT_PROGRAM_ID).toBe(FIXTURE.programs.encrypt);
  });

  it('accepts a body served as text', async () => {
    axios.get.mockResolvedValue({ data: JSON.stringify(copy()) });

    await expect(config.getConfig(locals)).resolves.toMatchObject({ epoch: 2 });
  });

  it.each([
    ['malformed JSON', '{"cluster": "devnet",'],
    ['a body that is not an object', '[]'],
    ['another cluster', copy((d) => (d.cluster = 'mainnet-beta'))],
    ['another pc-token id', copy((d) => (d.programs.pcToken = OTHER_KEY))],
    ['another pc-swap id', copy((d) => (d.programs.pcSwap = OTHER_KEY))],
    ['another Encrypt id', copy((d) => (d.programs.encrypt = OTHER_KEY))],
    [
      'a non-https executor',
      copy((d) => (d.encryptGrpcUrl = 'http://pre-alpha-dev-1.encrypt.ika-network.net:443')),
    ],
    ['another executor host', copy((d) => (d.encryptGrpcUrl = 'https://executor.example.com'))],
    [
      'a look-alike executor host',
      copy((d) => (d.encryptGrpcUrl = 'https://pre-alpha-dev-1.encrypt.ika-network.net.evil.io')),
    ],
    ['an executor URL that does not parse', copy((d) => (d.encryptGrpcUrl = 'not a url'))],
    ['a short network key', copy((d) => (d.networkKeyHex = '55'.repeat(31)))],
    ['a non-hex network key', copy((d) => (d.networkKeyHex = 'zz'.repeat(32)))],
    ['a non-integer fhe type', copy((d) => (d.fheTypeU64 = 4.5))],
    ['an fhe type given as text', copy((d) => (d.fheTypeU64 = '4'))],
    ['an fhe type past one byte', copy((d) => (d.fheTypeU64 = 200))],
    ['an invalid side address', copy((d) => (d.sides.USDC.vault = 'not-base58!'))],
    ['a side without decimals', copy((d) => delete d.sides.DOGE.decimals)],
    ['no sides', copy((d) => delete d.sides)],
    ['an invalid pool address', copy((d) => (d.pool.reserveCtA = 'O0O0'))],
    ['a pool missing an account', copy((d) => delete d.pool.vaultBalanceCtB)],
    ['a pool on one side twice', copy((d) => (d.pool.sideB = 'USDC'))],
    ['a pool naming an unknown side', copy((d) => (d.pool.sideB = 'SOL'))],
  ])('refuses %s with 503 and logs a reason, never the body', async (_label, body) => {
    axios.get.mockResolvedValue({ data: body });

    await expect(config.getConfig(locals)).rejects.toMatchObject(unavailable);
    expect(error).toHaveBeenCalledWith(
      expect.stringContaining('[DAGON_CONFIG]'),
      expect.objectContaining({ reason: expect.any(String) })
    );
    const logged = JSON.stringify(error.mock.calls);
    expect(logged).not.toContain(FIXTURE.networkKeyHex);
    expect(logged).not.toContain(FIXTURE.pool.address);
  });

  it('answers 503 when the fetch fails and no copy is cached', async () => {
    axios.get.mockRejectedValue(Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' }));

    await expect(config.getConfig(locals)).rejects.toMatchObject(unavailable);
    expect(error).toHaveBeenCalledWith(
      expect.stringContaining('[DAGON_CONFIG]'),
      expect.objectContaining({ reason: 'fetch_failed' })
    );
  });

  it('answers 503 when the circuit is open and no copy is cached', async () => {
    providerCall.mockRejectedValueOnce(
      Object.assign(new Error('open'), { statusCode: 503, errorCode: 'upstream_unavailable' })
    );

    await expect(config.getConfig(locals)).rejects.toMatchObject(unavailable);
  });

  it('serves the cached copy for 5 minutes, then refreshes', async () => {
    axios.get.mockResolvedValue({ data: copy() });

    await config.getConfig(locals);
    jest.setSystemTime(T0 + 5 * MINUTE - 1);
    await config.getConfig(locals);
    expect(axios.get).toHaveBeenCalledTimes(1);

    jest.setSystemTime(T0 + 5 * MINUTE + 1);
    await config.getConfig(locals);
    expect(axios.get).toHaveBeenCalledTimes(2);
  });

  it('keeps the last good copy when a refresh fails', async () => {
    axios.get.mockResolvedValueOnce({ data: copy() });
    await config.getConfig(locals);

    jest.setSystemTime(T0 + 6 * MINUTE);
    axios.get.mockRejectedValueOnce(new Error('timeout'));

    await expect(config.getConfig(locals)).resolves.toMatchObject({ epoch: 2 });
  });

  it('keeps the last good copy when a refresh is refused', async () => {
    axios.get.mockResolvedValueOnce({ data: copy() });
    await config.getConfig(locals);

    jest.setSystemTime(T0 + 6 * MINUTE);
    axios.get.mockResolvedValueOnce({
      data: copy((d) => {
        d.epoch = 3;
        d.programs.pcSwap = OTHER_KEY;
      }),
    });

    await expect(config.getConfig(locals)).resolves.toMatchObject({
      epoch: 2,
      programs: FIXTURE.programs,
    });
  });

  it('replaces the cached copy with a new epoch on the same programs', async () => {
    axios.get.mockResolvedValueOnce({ data: copy() });
    await config.getConfig(locals);

    jest.setSystemTime(T0 + 6 * MINUTE);
    const next = copy((d) => {
      d.epoch = 3;
      d.pool.address = OTHER_KEY;
    });
    axios.get.mockResolvedValueOnce({ data: next });

    await expect(config.getConfig(locals)).resolves.toMatchObject({
      epoch: 3,
      pool: { address: OTHER_KEY },
    });
  });

  it('ignores the remote layout block and rpcEndpoint', async () => {
    axios.get.mockResolvedValue({
      data: copy((d) => {
        d.layout = { ciphertextVerifiedFlagByte: 7 };
        d.rpcEndpoint = 'https://rpc.example.com';
      }),
    });

    const accepted = await config.getConfig(locals);

    expect(accepted).not.toHaveProperty('layout');
    expect(accepted).not.toHaveProperty('rpcEndpoint');
  });
});
