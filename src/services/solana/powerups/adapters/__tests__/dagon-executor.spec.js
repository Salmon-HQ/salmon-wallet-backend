'use strict';

jest.mock('axios', () => ({ post: jest.fn() }));
jest.mock('../../../../../infrastructure/providers/provider-client', () => ({
  providerCall: jest.fn((name, fn) => fn({ timeout: 5000, signal: 'signal' })),
}));

const axios = require('axios');
const { PublicKey } = require('@solana/web3.js');
const { providerCall } = require('../../../../../infrastructure/providers/provider-client');
const executor = require('../dagon/executor');
const FIXTURE = require('./fixtures/dagon-devnet-epoch2.json');

const PC_TOKEN = FIXTURE.programs.pcToken;
const ID_A = Buffer.alloc(32, 0xa1);
const ID_B = Buffer.alloc(32, 0xb2);
const AMOUNT = 123456789n;
const locals = { network: { id: 'solana-devnet' } };

/** One gRPC-web frame: flag byte, 4-byte big-endian length, payload. */
const frame = (flag, payload) => {
  const header = Buffer.alloc(5);
  header[0] = flag;
  header.writeUInt32BE(payload.length, 1);
  return Buffer.concat([header, payload]);
};
/** CreateInputResponse: field 1 (repeated bytes) per id. */
const ids = (...list) =>
  Buffer.concat(list.map((id) => Buffer.concat([Buffer.from([0x0a, id.length]), id])));
const trailer = (status) => frame(0x80, Buffer.from(`grpc-status:${status}\r\ngrpc-message:\r\n`));
const answer = (body, headers = {}) => {
  const bytes = Buffer.from(body);
  return { data: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length), headers };
};
const ok = (...list) => answer(Buffer.concat([frame(0x00, ids(...list)), trailer(0)]));

describe('dagon executor createInputs', () => {
  let error;
  beforeEach(() => {
    jest.clearAllMocks();
    error = jest.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => error.mockRestore());

  const expectNoAmountLogged = () =>
    expect(JSON.stringify(error.mock.calls)).not.toContain(AMOUNT.toString());

  it('posts the hand-derived 91-byte CreateInput message in one gRPC-web frame', async () => {
    axios.post.mockResolvedValue(ok(ID_A));

    await executor.createInputs([1000n], PC_TOKEN, FIXTURE, locals);

    const value = Buffer.concat([Buffer.from([0x04, 0xe8, 0x03]), Buffer.alloc(14)]);
    const message = Buffer.concat([
      Buffer.from([0x12, 0x15, 0x0a, 0x11]),
      value,
      Buffer.from([0x10, 0x04, 0x22, 0x20]),
      new PublicKey(PC_TOKEN).toBuffer(),
      Buffer.from([0x2a, 0x20]),
      Buffer.alloc(32, 0x55),
    ]);
    expect(message).toHaveLength(91);
    const [url, body, options] = axios.post.mock.calls[0];
    expect(url).toBe(
      'https://pre-alpha-dev-1.encrypt.ika-network.net/encrypt.v1.EncryptService/CreateInput'
    );
    expect(Buffer.from(body)).toEqual(Buffer.concat([Buffer.from([0, 0, 0, 0, 91]), message]));
    expect(options).toMatchObject({
      timeout: 5000,
      signal: 'signal',
      responseType: 'arraybuffer',
      headers: {
        'content-type': 'application/grpc-web+proto',
        accept: 'application/grpc-web+proto',
        'x-grpc-web': '1',
      },
    });
    expect(providerCall).toHaveBeenCalledWith('encrypt-executor', expect.any(Function), {
      locals,
    });
  });

  it('reads the one id from a data frame followed by a trailer frame', async () => {
    axios.post.mockResolvedValue(ok(ID_A));

    const [input] = await executor.createInputs([AMOUNT], PC_TOKEN, FIXTURE, locals);

    expect(input).toBeInstanceOf(PublicKey);
    expect(input.toBuffer()).toEqual(ID_A);
  });

  it('runs one call per value in parallel and keeps their order', async () => {
    const pending = [];
    axios.post.mockImplementation(() => new Promise((resolve) => pending.push(resolve)));

    const result = executor.createInputs([1n, 2n, 0n], PC_TOKEN, FIXTURE, locals);
    await Promise.resolve();
    await Promise.resolve();
    expect(axios.post).toHaveBeenCalledTimes(3);
    pending[2](ok(Buffer.alloc(32, 3)));
    pending[0](ok(Buffer.alloc(32, 1)));
    pending[1](ok(Buffer.alloc(32, 2)));

    const inputs = await result;
    expect(inputs.map((key) => key.toBuffer()[0])).toEqual([1, 2, 3]);
  });

  it.each([
    ['zero ids', () => ok()],
    ['two ids', () => ok(ID_A, ID_B)],
    ['an id that is not 32 bytes', () => ok(Buffer.alloc(31, 1))],
    ['garbage', () => answer(Buffer.from('<html>nope</html>'))],
    ['a truncated frame', () => answer(Buffer.from([0, 0, 0, 0, 40, 0x0a]))],
    ['no grpc-status at all', () => answer(frame(0x00, ids(ID_A)))],
    ['another grpc-status in the trailer', () => answer(trailer(3))],
    [
      'a trailers-only answer with another status',
      () => answer(Buffer.alloc(0), { 'grpc-status': '7' }),
    ],
    [
      'a trailers-only success with no message',
      () => answer(Buffer.alloc(0), { 'grpc-status': '0' }),
    ],
  ])('answers 502 executor_bad_response on %s', async (_label, response) => {
    axios.post.mockResolvedValue(response());

    await expect(executor.createInputs([AMOUNT], PC_TOKEN, FIXTURE, locals)).rejects.toMatchObject({
      statusCode: 502,
      errorCode: 'executor_bad_response',
    });
    expectNoAmountLogged();
  });

  it.each([
    [
      'HTTP 5xx',
      () => Promise.reject(Object.assign(new Error('x'), { response: { status: 502 } })),
    ],
    [
      'a network error',
      () => Promise.reject(Object.assign(new Error('x'), { code: 'ECONNRESET' })),
    ],
    [
      'grpc-status 14 in the headers',
      () => Promise.resolve(answer(Buffer.alloc(0), { 'grpc-status': '14' })),
    ],
    ['grpc-status 4 in the trailer', () => Promise.resolve(answer(trailer(4)))],
  ])('answers 503 executor_unavailable on %s', async (_label, response) => {
    axios.post.mockImplementation(response);

    await expect(executor.createInputs([AMOUNT], PC_TOKEN, FIXTURE, locals)).rejects.toMatchObject({
      statusCode: 503,
      errorCode: 'executor_unavailable',
    });
    expectNoAmountLogged();
  });

  it('answers 503 executor_unavailable when the circuit is open', async () => {
    providerCall.mockRejectedValueOnce(
      Object.assign(new Error('open'), { statusCode: 503, errorCode: 'upstream_unavailable' })
    );

    await expect(executor.createInputs([AMOUNT], PC_TOKEN, FIXTURE, locals)).rejects.toMatchObject({
      statusCode: 503,
      errorCode: 'executor_unavailable',
    });
  });

  it('lets the request budget answer through unchanged', async () => {
    const spent = Object.assign(new Error('spent'), {
      statusCode: 503,
      errorCode: 'request_budget_exhausted',
    });
    providerCall.mockRejectedValueOnce(spent);

    await expect(executor.createInputs([AMOUNT], PC_TOKEN, FIXTURE, locals)).rejects.toBe(spent);
  });
});

describe('dagon executor waitCommitted', () => {
  const T0 = new Date('2026-11-01T12:00:00Z').getTime();
  const INPUT = new PublicKey(ID_A);
  const RESERVE = new PublicKey(ID_B);
  const ciphertext = (status) => {
    const data = Buffer.alloc(100);
    data.fill(7, 2, 34);
    data[99] = status;
    return { data };
  };
  const connection = { getMultipleAccountsInfo: jest.fn() };
  let error;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers({ now: T0 });
    error = jest.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    jest.useRealTimers();
    error.mockRestore();
  });

  it('resolves at once when every account is committed', async () => {
    connection.getMultipleAccountsInfo.mockResolvedValue([ciphertext(1), ciphertext(1)]);

    await executor.waitCommitted(connection, [INPUT], [RESERVE], { deadline: T0 + 25000 });

    expect(connection.getMultipleAccountsInfo).toHaveBeenCalledTimes(1);
    expect(connection.getMultipleAccountsInfo).toHaveBeenCalledWith([INPUT, RESERVE], 'confirmed');
  });

  it('polls every 750 ms until the inputs commit', async () => {
    connection.getMultipleAccountsInfo
      .mockResolvedValueOnce([null])
      .mockResolvedValueOnce([ciphertext(0)])
      .mockResolvedValueOnce([ciphertext(1)]);

    const waiting = executor.waitCommitted(connection, [INPUT], [], { deadline: T0 + 25000 });
    await jest.advanceTimersByTimeAsync(749);
    expect(connection.getMultipleAccountsInfo).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(1);
    expect(connection.getMultipleAccountsInfo).toHaveBeenCalledTimes(2);
    await jest.advanceTimersByTimeAsync(750);

    await expect(waiting).resolves.toBeUndefined();
    expect(connection.getMultipleAccountsInfo).toHaveBeenCalledTimes(3);
  });

  it('treats an account shorter than 100 bytes as pending', async () => {
    connection.getMultipleAccountsInfo.mockResolvedValue([{ data: Buffer.alloc(99, 1) }]);

    await expect(
      executor.waitCommitted(connection, [INPUT], [], { deadline: T0 + 4000 })
    ).rejects.toMatchObject({ statusCode: 503, errorCode: 'executor_pending' });
  });

  it('stops with 503 executor_pending when less than 5 s of budget would be left', async () => {
    connection.getMultipleAccountsInfo.mockResolvedValue([ciphertext(0), ciphertext(1)]);

    const waiting = executor.waitCommitted(connection, [INPUT], [RESERVE], {
      deadline: T0 + 6000,
    });
    const settled = expect(waiting).rejects.toMatchObject({
      statusCode: 503,
      errorCode: 'executor_pending',
    });
    await jest.advanceTimersByTimeAsync(5000);
    await settled;
    // 6000 left → one sleep leaves 5250; a second would leave 4500, under the 5 s reserve.
    expect(connection.getMultipleAccountsInfo).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(error.mock.calls)).not.toContain(INPUT.toBase58());
  });

  it('answers 503 pool_unavailable when only a reserve is still pending', async () => {
    connection.getMultipleAccountsInfo.mockResolvedValue([ciphertext(1), ciphertext(0)]);

    await expect(
      executor.waitCommitted(connection, [INPUT], [RESERVE], { deadline: T0 + 4000 })
    ).rejects.toMatchObject({ statusCode: 503, errorCode: 'pool_unavailable' });
  });
});
