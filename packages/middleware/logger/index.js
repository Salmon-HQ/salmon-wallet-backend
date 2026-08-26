const { resolveClientIp } = require('../../network-utils');
const { maskUrl } = require('./mask-url');

module.exports = async (req, res, next) => {
  const { method, requestContext } = req;
  const url = maskUrl(req.originalUrl);
  const { requestTimeEpoch: startTime } = requestContext;
  const ip = resolveClientIp(req);

  console.log(`Request: ${ip} - ${method} ${url}`);
  console.log(`Hostname: ${req.hostname}`);

  res.on('finish', () => {
    const { statusCode: status } = res;
    const duration = new Date() - startTime;
    console.log(`Response: ${ip} - ${method} ${url} Status: ${status} Duration: ${duration} ms`);
  });

  await next();
};
