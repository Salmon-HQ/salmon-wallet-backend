'use strict';

/**
 * Public shape of one entry of `GET /powerups/availability`
 * (`capability-availability` contract): `reason` only when disabled,
 * `provider` only when enabled and the capability routes through one.
 */

module.exports = ({ id, enabled, reason, provider }) => ({
  id,
  enabled,
  ...(enabled ? {} : { reason }),
  ...(enabled && provider ? { provider } : {}),
});
