# @4m/api-utils

Workspace-internal utility helpers for Express-based handlers in
`salmon-api`. Provides validation/error wrappers, small collection
utilities, and a generic resource decorator with relation-eager-loading
helpers used by the resource layer.

This package is not published to npm. It is consumed via the local
workspace from `salmon-api/src/`:

```js
const { validateAndExecute, safe, decorator } = require('@4m/api-utils');
```

## Exports

### `validateAndExecute(validations, action)`

Returns an Express middleware array that copies `res.locals` onto
`req.locals` (so `express-validator` chains can read them), runs the
provided `validations`, and finally calls `action(req, res)`. Responds
with `422` and the error array if validation fails.

```js
router.post(
  '/',
  validateAndExecute([body('id').isUUID()], async (req, res) => res.json({ ok: true }))
);
```

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

### `unique(items)`

Returns deduplicated array via `Set`. Returns input unchanged when
length is 0 or 1.

### `indexBy(items, field)`

Builds an object keyed by `item[field]`, value is the item. Last write
wins on duplicate keys.

### `groupBy(items, field)`

Builds an object keyed by `item[field]`, value is an array of items
sharing that key.

### `parseInclude(req)`

Parses the `?include=a,b.c,b.d` query string into a nested plain object
shape: `{ a: {}, b: { c: {}, d: {} } }`. Used by `decorator` to pick
which relations to eager-load.

### `decorator(decorate, target, options)`

Generic resource decorator. Accepts a single resource, an array, or a
paginated `{ data, meta }` envelope. For each item it calls
`decorate(item, include, key, context)`, where `include` comes from
`req` (via `parseInclude`) or `options.include`, and `context` carries
`{ locals, target }` plus per-relation memo slots. Optional
`options.sort` is applied after decoration.

### `includeRelation(resource, property, decorate, eagerLoad, select, include, key, context)`

Inside a `decorate` function — if the requested `include` contains
`property`, runs `eagerLoad(context[key])` once (memoized on
`context[key.property]`), then calls `select(items)` to pick the
children for this resource and recursively decorates them.

### `includeProperty(resource, property, eagerLoad, select, include, key, context)`

Same shape as `includeRelation` but assigns the selected value
directly without recursing — for non-resource scalar/object properties.
