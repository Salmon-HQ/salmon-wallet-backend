# @4m/api-utils

Workspace-internal utility helpers for Express-based handlers in
`salmon-api`. Provides an async error wrapper and a generic resource
decorator with a property-eager-loading helper used by the resource layer.

This package is not published to npm. It is consumed via the local
workspace from `salmon-api/src/`:

```js
const { safe, decorator, includeProperty } = require('@4m/api-utils');
```

## Exports

### `safe(action)`

Wraps an async handler (or array of middlewares) so any thrown error is
forwarded to `next(err)` instead of crashing the request. Accepts a
function or an array — array entries that are not functions are passed
through untouched.

```js
router.get(
  '/',
  safe(async (req, res) => {
    /* may throw */
  })
);
```

### `decorator(decorate, target, options)`

Generic resource decorator. Accepts a single resource, an array, or a
paginated `{ data, meta }` envelope. For each item it calls
`decorate(item, include, key, context)`, where `include` comes from
`req` (`?include=a,b.c` parsed into `{ a: {}, b: { c: {} } }`) or `options.include`, and `context` carries
`{ locals, target }` plus per-relation memo slots. Optional
`options.sort` is applied after decoration.

### `includeProperty(resource, property, eagerLoad, select, include, key, context)`

Inside a `decorate` function — if the requested `include` contains
`property`, runs `eagerLoad(context[key])` once (memoized on
`context[key.property]`), then assigns `select(items)` to
`resource[property]`.
