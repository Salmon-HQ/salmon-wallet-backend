'use strict';

const reconnectStrategy = (maxRetries = 0, delay = 0) => {
  return (retries) => (retries < maxRetries ? delay : new Error('Redis max reconnection retries'));
};

module.exports = { reconnectStrategy };
