'use strict';

/**
 * Dagon's Encrypt executor: `createInput` over unary gRPC-web, and the wait
 * for the inputs it creates to commit on chain.
 *
 * The request and response are tiny and fixed, so the bytes are written
 * here instead of pulling in a protobuf runtime (research R3). Pre-alpha has
 * no encryption: the amount travels in plaintext to the executor, so it is
 * never logged here.
 */

const axios = require('axios');
const { PublicKey } = require('@solana/web3.js');
const { providerCall } = require('../../../../../infrastructure/providers/provider-client');
const { remainingMs } = require('../../../../../infrastructure/providers/request-deadline');
const { toSafeError } = require('../../../../../infrastructure/log-redaction');
const { sleep } = require('../../../../../infrastructure/rate-limiting/rate-limiter');
const { PowerupError } = require('../../powerup-errors');

const CREATE_INPUT_PATH = '/encrypt.v1.EncryptService/CreateInput';
const DATA_FRAME = 0x00;
const TRAILER_FLAG = 0x80;
const GRPC_UNAVAILABLE = ['14', '4'];
const POLL_MS = 750;
/** Budget kept for compile + simulate after the wait. */
const RESERVE_MS = 5000;
const STATUS_BYTE = 99;

const badResponse = (reason) => {
  console.error('[DAGON_EXECUTOR] createInput answer refused', {
    outcome: 'executor_bad_response',
    reason,
  });
  return new PowerupError(
    'The Encrypt executor answered unexpectedly',
    502,
    'executor_bad_response'
  );
};

const unavailable = (detail) => {
  console.error('[DAGON_EXECUTOR] createInput failed', {
    outcome: 'executor_unavailable',
    ...detail,
  });
  return new PowerupError(
    'The Encrypt executor is unavailable, please retry',
    503,
    'executor_unavailable'
  );
};

/** `[fheType, value as 16-byte little-endian]`, the pre-alpha plaintext "ciphertext". */
const encodeValue = (value, fheType) => {
  const bytes = Buffer.alloc(17);
  bytes[0] = fheType;
  bytes.writeBigUInt64LE(value, 1);
  return bytes;
};

/** CreateInputRequest (chain SOLANA = 0 and the empty proof are default, so omitted), framed. */
const encodeRequest = (value, authorized, config) => {
  const ciphertext = encodeValue(value, config.fheTypeU64);
  const message = Buffer.concat([
    Buffer.from([0x12, 2 + ciphertext.length + 2, 0x0a, ciphertext.length]),
    ciphertext,
    Buffer.from([0x10, config.fheTypeU64, 0x22, 0x20]),
    new PublicKey(authorized).toBuffer(),
    Buffer.from([0x2a, 0x20]),
    Buffer.from(config.networkKeyHex, 'hex'),
  ]);
  const header = Buffer.alloc(5);
  header[0] = DATA_FRAME;
  header.writeUInt32BE(message.length, 1);
  return Buffer.concat([header, message]);
};

const readVarint = (bytes, at) => {
  let value = 0;
  for (let shift = 0, i = at; i < bytes.length && shift < 35; shift += 7, i += 1) {
    value += (bytes[i] & 0x7f) * 2 ** shift;
    if (bytes[i] < 0x80) return [value, i + 1];
  }
  throw badResponse('varint');
};

/** Field 1 (repeated bytes) of CreateInputResponse; any other wire type is malformed. */
const decodeIds = (message) => {
  const found = [];
  let at = 0;
  while (at < message.length) {
    const [tag, next] = readVarint(message, at);
    if ((tag & 7) === 0) {
      [, at] = readVarint(message, next);
      continue;
    }
    if ((tag & 7) !== 2) throw badResponse('wire_type');
    const [length, start] = readVarint(message, next);
    if (start + length > message.length) throw badResponse('truncated_field');
    if (tag >>> 3 === 1) found.push(message.subarray(start, start + length));
    at = start + length;
  }
  return found;
};

/** Splits the body into its message and trailer text; a trailers-only answer has neither. */
const decodeFrames = (body) => {
  const messages = [];
  let trailers = '';
  let at = 0;
  while (at < body.length) {
    if (at + 5 > body.length) throw badResponse('truncated_frame');
    const length = body.readUInt32BE(at + 1);
    const payload = body.subarray(at + 5, at + 5 + length);
    if (payload.length !== length) throw badResponse('truncated_frame');
    if (body[at] & TRAILER_FLAG) trailers += payload.toString('latin1');
    else if (body[at] === DATA_FRAME) messages.push(payload);
    else throw badResponse('frame_flag');
    at += 5 + length;
  }
  return { messages, trailers };
};

const grpcStatusOf = (headers, trailers) => {
  if (headers?.['grpc-status'] !== undefined) return String(headers['grpc-status']);
  const line = trailers.split(/\r?\n/).find((entry) => /^grpc-status\s*:/i.test(entry));
  return line ? line.split(':')[1].trim() : undefined;
};

const parseAnswer = ({ data, headers }) => {
  const { messages, trailers } = decodeFrames(Buffer.from(data));
  const status = grpcStatusOf(headers, trailers);
  if (GRPC_UNAVAILABLE.includes(status)) throw unavailable({ grpcStatus: status });
  if (status !== '0') throw badResponse(status === undefined ? 'no_status' : 'grpc_status');
  const found = messages.flatMap(decodeIds);
  if (found.length !== 1 || found[0].length !== 32) throw badResponse('id_count');
  return new PublicKey(found[0]);
};

const createInput = async (value, authorized, config, locals) => {
  let answer;
  try {
    answer = await providerCall(
      'encrypt-executor',
      ({ timeout, signal }) =>
        axios.post(
          new URL(CREATE_INPUT_PATH, config.encryptGrpcUrl).toString(),
          encodeRequest(value, authorized, config),
          {
            timeout,
            signal,
            responseType: 'arraybuffer',
            headers: {
              'content-type': 'application/grpc-web+proto',
              accept: 'application/grpc-web+proto',
              'x-grpc-web': '1',
            },
          }
        ),
      { locals }
    );
  } catch (error) {
    if (error.errorCode && error.errorCode !== 'upstream_unavailable') throw error;
    const status = error.response?.status;
    if (status && status < 500) {
      console.error('[DAGON_EXECUTOR] createInput refused', { status });
      throw badResponse('http_status');
    }
    throw unavailable({ error: toSafeError(error) });
  }
  return parseAnswer(answer);
};

/**
 * One executor input per value, created in parallel, each authorized to
 * `authorized` (the program that will read it). No retry: a retried call
 * can mint a second input.
 * @param {bigint[]} values
 * @param {string} authorized - program id
 * @param {Object} config - accepted `devnet.json`
 * @param {Object} locals
 * @returns {Promise<PublicKey[]>} the input ciphertext accounts, in order
 */
const createInputs = (values, authorized, config, locals) =>
  Promise.all(values.map((value) => createInput(value, authorized, config, locals)));

const isCommitted = (info) =>
  Boolean(info && info.data.length > STATUS_BYTE && info.data[STATUS_BYTE] === 1);

/**
 * Waits until every input and reserve ciphertext is committed (status byte
 * 1). A transaction sent while one is pending computes on nothing, so the
 * build never returns before. Gives up while `RESERVE_MS` of the budget is
 * still left for compiling.
 * @throws {PowerupError} 503 `executor_pending` (an input) or `pool_unavailable` (a reserve)
 */
const waitCommitted = async (connection, inputs, reserves, locals) => {
  const accounts = [...inputs, ...reserves];
  for (;;) {
    const infos = await connection.getMultipleAccountsInfo(accounts, 'confirmed');
    const pending = accounts.map((_, index) => !isCommitted(infos[index]));
    if (!pending.includes(true)) return;
    if (remainingMs(locals) - POLL_MS < RESERVE_MS) {
      const inputPending = pending.slice(0, inputs.length).includes(true);
      const code = inputPending ? 'executor_pending' : 'pool_unavailable';
      console.error('[DAGON_EXECUTOR] ciphertexts not committed in time', {
        outcome: code,
        pending: pending.filter(Boolean).length,
      });
      throw new PowerupError(
        inputPending
          ? 'The Encrypt executor has not committed the inputs yet, please retry'
          : 'The Dagon pool is still settling, please retry',
        503,
        code
      );
    }
    await sleep(POLL_MS);
  }
};

module.exports = { createInputs, waitCommitted, isCommitted };
