# Contract: platform header

Every request from a Salmon app carries:

```
X-Salmon-Platform: ios | android | extension
```

- Set once in `createApiClient` (frontend `packages/shared/src/api/client.ts`) from the build's platform; never user-editable.
- Backend: `src/availability/platform.js` maps the header to one of the three values; any other value or a missing header → `ios`.
- The header is a caller-supplied signal and is documented as such (spec 011 FR-010). It selects which platform's table rows apply; it cannot open a country that is unavailable on every platform.
