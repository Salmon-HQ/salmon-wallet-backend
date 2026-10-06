'use strict';

/**
 * The platform a request comes from, read from the `X-Salmon-Platform`
 * header every Salmon app sends (spec 018, contracts/platform-header.md).
 *
 * The header is a caller-supplied signal and that is acceptable: the stores'
 * rules bind the build they reviewed, and a claimed platform cannot open a
 * country that is unavailable on every platform. A missing or unknown value
 * is evaluated as the most restrictive platform, so an old client that never
 * sends it gets the iOS answer.
 */

const PLATFORMS = ['ios', 'android', 'extension'];
const MOST_RESTRICTIVE = 'ios';
const HEADER = 'x-salmon-platform';

/**
 * @param {import('express').Request} req
 * @returns {'ios'|'android'|'extension'}
 */
const platformOf = (req) => {
  const raw = req.headers?.[HEADER];
  const value = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  return PLATFORMS.includes(value) ? value : MOST_RESTRICTIVE;
};

module.exports = { platformOf, PLATFORMS, MOST_RESTRICTIVE, HEADER };
