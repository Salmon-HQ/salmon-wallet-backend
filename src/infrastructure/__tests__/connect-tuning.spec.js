'use strict';

const net = require('net');
const { CONNECT_ATTEMPT_TIMEOUT_MS, applyConnectTuning } = require('../connect-tuning');

describe('connect-tuning', () => {
  const original = net.getDefaultAutoSelectFamilyAttemptTimeout();

  afterEach(() => {
    net.setDefaultAutoSelectFamilyAttemptTimeout(original);
  });

  it('raises the happy-eyeballs per-attempt timeout above Node’s 250ms default', () => {
    net.setDefaultAutoSelectFamilyAttemptTimeout(250);

    applyConnectTuning();

    expect(net.getDefaultAutoSelectFamilyAttemptTimeout()).toBe(CONNECT_ATTEMPT_TIMEOUT_MS);
    expect(CONNECT_ATTEMPT_TIMEOUT_MS).toBeGreaterThan(250);
  });

  it('leaves address-family auto-selection enabled', () => {
    applyConnectTuning();

    expect(net.getDefaultAutoSelectFamily()).toBe(true);
  });

  it('is idempotent', () => {
    applyConnectTuning();
    applyConnectTuning();

    expect(net.getDefaultAutoSelectFamilyAttemptTimeout()).toBe(CONNECT_ATTEMPT_TIMEOUT_MS);
  });
});
