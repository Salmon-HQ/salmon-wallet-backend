'use strict';

const { createClient } = require('redis');

module.exports = (settings) => {
  const client = createClient(settings);

  client.on('connect', () => console.info('Redis is initiating a connection to the server'));
  client.on('ready', () => console.info('Redis successfully connected to the server'));
  client.on('end', () => console.info('Redis disconnected the connection to the server'));
  client.on('error', (error) => console.error('Redis network error has occurred', error));
  client.on('reconnecting', () => console.info('Redis is trying to reconnect to the server'));

  const getClient = () => client;

  let connectPromise, lastConnectTime;

  const handle = async (operation) => {
    if (!client.isOpen) {
      if (connectPromise) {
        await connectPromise;
      } else {
        const { failFastLapse = 0 } = settings?.socket || {};
        if (failFastLapse > 0 && failFastLapse > new Date() - lastConnectTime) {
          throw new Error('Redis fail-fast!');
        }
        lastConnectTime = new Date();
        try {
          await (connectPromise = client.connect());
        } finally {
          connectPromise = undefined;
        }
      }
    }

    return await operation();
  };

  const sendCommand = async (args) => handle(async () => client.sendCommand(args));

  const ping = async () => handle(async () => client.ping());

  const info = async (section) => handle(async () => client.info(section));

  const scan = async (cursor, options = {}) => {
    const { pattern: MATCH, count: COUNT, type: TYPE } = options;
    return handle(async () => client.scan(cursor, { MATCH, COUNT, TYPE }));
  };

  const exists = async (keys) => handle(async () => client.exists(keys));

  const get = async (key) => handle(async () => client.get(key));

  const set = async (key, value, options = {}) => {
    const {
      ex: EX,
      px: PX,
      exAt: EXAT,
      pxAt: PXAT,
      nx: NX,
      xx: XX,
      keepTtl: KEEPTTL,
      get: GET,
    } = options;
    return handle(async () => client.set(key, value, { EX, PX, EXAT, PXAT, NX, XX, KEEPTTL, GET }));
  };

  const touch = async (keys) => handle(async () => client.touch(keys));

  const ttl = async (key) => handle(async () => client.ttl(key));

  const incr = async (key) => handle(async () => client.incr(key));

  const decr = async (key) => handle(async () => client.decr(key));

  const del = async (keys) => handle(async () => client.del(keys));

  const quit = async () => handle(async () => client.quit());

  return {
    getClient,
    sendCommand,
    ping,
    info,
    scan,
    exists,
    get,
    set,
    touch,
    ttl,
    incr,
    decr,
    del,
    quit,
  };
};
