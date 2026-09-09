'use strict';

const handleError = (action) => async (req, res, next) => {
  try {
    await action(req, res, next);
  } catch (err) {
    next(err);
  }
};

const safe = (action) => {
  if (Array.isArray(action)) {
    return action.map((element) =>
      typeof element === 'function' ? handleError(element) : element
    );
  }
  return handleError(action);
};

const parseInclude = (req) => {
  const { include } = req.query;
  if (!include) {
    return {};
  }

  const str = Array.isArray(include) ? include.join(',') : include;
  const groups = str.split(',').map((s) => s.trim());

  const result = {};

  for (const group of groups) {
    const keys = group.split('.').map((str) => str.trim());

    let obj = result;

    for (const key of keys) {
      if (!obj.hasOwnProperty(key)) {
        obj[key] = {};
      }
      obj = obj[key];
    }
  }

  return result;
};

const isPaginated = (obj) => obj.hasOwnProperty('meta') && Array.isArray(obj.data);

const handleSort = (sort, data) => (sort ? data.sort(sort) : data);

const decorator = async (decorate, target, options) => {
  if (!target) {
    return target;
  }

  const { req, res, sort } = options || {};
  const locals = res?.locals || options?.locals || {};
  const include = req ? parseInclude(req) : options?.include || {};

  const key = 'target';
  const context = { locals };

  if (Array.isArray(target)) {
    context[key] = target;

    const items = [];
    for (const item of target) {
      items.push(await decorate(item, include, key, context));
    }
    return handleSort(sort, items);
  } else if (isPaginated(target)) {
    context[key] = target.data;

    const items = [];
    for (const item of target.data) {
      items.push(await decorate(item, include, key, context));
    }
    target.data = handleSort(sort, items);
    return target;
  } else {
    context[key] = [target];

    return decorate(target, include, key, context);
  }
};

const includeProperty = async (resource, property, eagerLoad, select, include, key, context) => {
  if (include.hasOwnProperty(property)) {
    const childKey = `${key}.${property}`;

    if (!context.hasOwnProperty(childKey)) {
      context[childKey] = await eagerLoad(context[key]);
    }

    const values = context[childKey];
    if (values) {
      resource[property] = select(values);
    }
  }
};

module.exports = {
  safe,
  decorator,
  includeProperty,
};
