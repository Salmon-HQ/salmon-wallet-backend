'use strict';

module.exports = (directive) => {
  return async (req, res, next) => {
    res.setHeader('Cache-Control', directive);
    next();
  };
};
