'use strict';

/**
 * Lambda handler wrapper shared by every function in this service (the main
 * API in `src/index.js`, and the scheduled jobs under `src/jobs/`).
 *
 * Short-circuits `serverless-plugin-warmup` pings so they don't run the real
 * handler. Errors from `handler` are caught and logged here, not re-thrown.
 *
 * @param {(event: Object, context: Object) => Promise<*>} handler - The real
 *   Lambda handler to wrap.
 * @returns {(event: Object, context: Object) => Promise<*>} The wrapped handler.
 */
module.exports = (handler) => async (event, context) => {
  try {
    if (event.source === 'serverless-plugin-warmup') {
      console.log('Lambda warm up');
      return 'Lambda is warm!';
    }
    return await handler(event, context);
  } catch (err) {
    console.error(err);
  }
};
