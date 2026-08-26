'use strict';

/**
 * Outbound-connection tuning applied once per Lambda container, at boot.
 *
 * Node enables happy-eyeballs (`autoSelectFamily`) by default from v20 on: a
 * hostname that resolves to several addresses is dialed one address at a
 * time, alternating IPv4 and IPv6, and each attempt gets
 * `autoSelectFamilyAttemptTimeout` milliseconds before Node abandons it and
 * moves to the next. When every attempt is abandoned the caller gets an
 * `AggregateError` listing one failure per address.
 *
 * Node's default for that per-attempt budget is 250ms, and it silently
 * outranks every request timeout in this service. `blockdaemon-client` asks
 * for 6000ms and `stealthex-client` for 15000ms, but those are response
 * timeouts armed on a socket that already connected — a handshake slower than
 * 250ms never gets that far. Observed here as a 500 raised 518ms into a
 * request nominally allowed 6000: two IPv4 attempts abandoned at 250ms each,
 * flanked by two IPv6 attempts that failed instantly because the runtime had
 * no IPv6 route.
 *
 * So the budget is raised to a value a real transatlantic handshake fits
 * inside. This is not a retry and not a longer overall timeout: a host that is
 * genuinely unreachable still fails, just after enough time to prove it, and
 * the request timeout stays the thing that bounds a slow provider.
 *
 * Auto-selection itself stays on. Turning it off would pin the service to one
 * address family and lose the IPv6 fallback; the default was never the
 * problem, the 250ms was.
 */

const net = require('net');

/**
 * Per-address connect budget, in milliseconds.
 *
 * Sized for the slowest handshake we expect to be legitimate — a cold TCP
 * connection to a provider on another continent, from a container whose
 * network stack has just come up — with headroom, since the cost of being too
 * generous is a slow failure and the cost of being too tight is a false one.
 */
const CONNECT_ATTEMPT_TIMEOUT_MS = 2000;

/**
 * Applies the tuning to the process. Idempotent; call once per entrypoint,
 * before any outbound request is made.
 *
 * @returns {void}
 */
const applyConnectTuning = () => {
  net.setDefaultAutoSelectFamilyAttemptTimeout(CONNECT_ATTEMPT_TIMEOUT_MS);
};

module.exports = { CONNECT_ATTEMPT_TIMEOUT_MS, applyConnectTuning };
