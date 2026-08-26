'use strict';

module.exports = () => {
  return async (req, res, next) => {
    const { query } = req;

    if (query) {
      const keys = Object.keys(query);
      for (const key of keys) {
        const value = query[key];
        if (Array.isArray(value) && value.length === 1 && value[0] === '') {
          query[key] = [];
        }
      }
    }

    next();
  };
};
