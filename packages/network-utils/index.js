'use strict';

const resolveClientIp = (req) => {
  if (req.ips?.length > 0) {
    return req.ips[0];
  }
  if (req.connection?.remoteAddress) {
    const ips = req.connection.remoteAddress.split(',');
    if (ips.length > 0) {
      return ips[0].trim();
    }
  }
  return undefined;
};

module.exports = {
  resolveClientIp,
};
