'use strict';

/**
 * The availability table: where each capability is offered, per platform
 * and country, and by which routing provider (spec 018, data-model.md).
 *
 * It is configuration, not code. In production it is the SSM parameter
 * named by `AVAILABILITY_TABLE_PARAMETER`, read at runtime and cached for a
 * few minutes so a country change is a parameter edit, never a release.
 * Outside prod `AVAILABILITY_TABLE_JSON` overrides it for local runs. The
 * built-in `DEFAULT_TABLE` is the spec's initial rows and is what serves
 * when nothing is configured or a read fails: a failure never opens a
 * country.
 */

const PROVIDERS = ['jupiter', '0x'];
const PLATFORMS = ['ios', 'android', 'extension'];
const COUNTRY_CODE = /^[A-Z]{2}$/;
/** How long a table that cannot be refreshed may keep serving before the default takes over. */
const MAX_STALE_MS = 60 * 60 * 1000;
const TTL_MS = 5 * 60 * 1000;

/**
 * Jupiter's Terms of Use, "Prohibited Localities": wallets Jupiter "does not
 * interact with". A table row may never send one of these to Jupiter.
 */
const JUPITER_PROHIBITED = Object.freeze([
  'US',
  'CN',
  'SG',
  'MM',
  'CI',
  'CU',
  'CD',
  'IR',
  'IQ',
  'LY',
  'ML',
  'NI',
  'KP',
  'SO',
  'SD',
  'SY',
  'YE',
  'ZW',
]);

/** Comprehensively embargoed territories: unavailable everywhere. */
const EMBARGOED = Object.freeze(['CU', 'IR', 'KP', 'SY']);

const DEFAULT_TABLE = Object.freeze({
  version: 1,
  capabilities: {
    swap: {
      default: 'jupiter',
      // Owner decision 2026-09-30: the United States is off until confirmed.
      unavailable: [...EMBARGOED, 'US'],
      providers: {
        '0x': JUPITER_PROHIBITED.filter((c) => !EMBARGOED.includes(c) && c !== 'US'),
      },
      platforms: { ios: {} },
    },
  },
});

const isStringList = (value) => Array.isArray(value) && value.every((v) => typeof v === 'string');

/**
 * The effective rows of a capability on a platform: the platform override
 * replaces each of `default`, `unavailable`, `providers` it names.
 */
const rowsFor = (capability, platform) => {
  const override = capability.platforms?.[platform] || {};
  return {
    default: override.default ?? capability.default ?? null,
    unavailable: override.unavailable ?? capability.unavailable ?? [],
    providers: override.providers ?? capability.providers ?? {},
  };
};

const validateRows = (name, platform, rows, problems) => {
  const where = platform ? `${name}.platforms.${platform}` : name;
  if (rows.default !== null && !PROVIDERS.includes(rows.default)) {
    problems.push(`${where}.default: unknown provider "${rows.default}"`);
  }
  if (!isStringList(rows.unavailable)) {
    problems.push(`${where}.unavailable: must be a list of country codes`);
    return;
  }
  for (const [provider, countries] of Object.entries(rows.providers)) {
    if (!PROVIDERS.includes(provider))
      problems.push(`${where}.providers: unknown provider "${provider}"`);
    if (!isStringList(countries)) problems.push(`${where}.providers.${provider}: must be a list`);
  }
  const all = [...rows.unavailable, ...Object.values(rows.providers).flat()];
  for (const code of all) {
    if (!COUNTRY_CODE.test(code))
      problems.push(`${where}: "${code}" is not an ISO 3166-1 alpha-2 code`);
  }
  // Jupiter may only serve outside its prohibited list, wherever it ends up serving.
  // The embargoed countries are unavailable on every row, whoever the provider.
  for (const country of EMBARGOED) {
    if (!rows.unavailable.includes(country)) {
      problems.push(`${where}.unavailable: must include embargoed ${country}`);
    }
  }
  const servedByJupiter = (country) => {
    if (rows.unavailable.includes(country)) return false;
    for (const [provider, countries] of Object.entries(rows.providers)) {
      if (countries.includes(country)) return provider === 'jupiter';
    }
    return rows.default === 'jupiter';
  };
  for (const country of JUPITER_PROHIBITED) {
    if (servedByJupiter(country)) problems.push(`${where}: Jupiter may not serve ${country}`);
  }
};

/**
 * @param {unknown} table
 * @returns {string[]} problems; empty when the table is valid.
 */
const validateTable = (table) => {
  const problems = [];
  if (!table || typeof table !== 'object') return ['table: must be an object'];
  if (table.version !== 1) problems.push(`version: expected 1, got ${table.version}`);
  const capabilities = table.capabilities;
  if (!capabilities || typeof capabilities !== 'object')
    return [...problems, 'capabilities: missing'];
  for (const [name, capability] of Object.entries(capabilities)) {
    if (!capability || typeof capability !== 'object') {
      problems.push(`${name}: must be an object`);
      continue;
    }
    validateRows(name, null, rowsFor(capability, '__none__'), problems);
    for (const platform of Object.keys(capability.platforms || {})) {
      if (!PLATFORMS.includes(platform)) {
        problems.push(`${name}.platforms: unknown platform "${platform}"`);
        continue;
      }
      validateRows(name, platform, rowsFor(capability, platform), problems);
    }
  }
  return problems;
};

const parse = (text, source) => {
  let doc;
  try {
    doc = JSON.parse(text);
  } catch (error) {
    return { problems: [`${source}: ${error.message}`] };
  }
  try {
    return { doc, problems: validateTable(doc) };
  } catch (error) {
    // A shape the validator did not foresee is an invalid table, never a crash.
    return { problems: [`${source}: ${error.message}`] };
  }
};

/** Default SSM reader: the SDK the Lambda runtime ships, loaded lazily. */
const fetchFromSsm = async () => {
  const name = process.env.AVAILABILITY_TABLE_PARAMETER;
  if (!name) return null;
  const { SSMClient, GetParameterCommand } = require('@aws-sdk/client-ssm');
  const client = new SSMClient({});
  const { Parameter } = await client.send(new GetParameterCommand({ Name: name }));
  return Parameter?.Value ?? null;
};

/**
 * @param {{ fetchParameter?: () => Promise<string|null>, now?: () => number, ttlMs?: number }} [options]
 * @returns {() => Promise<object>} the current table, never throws.
 */
const createTableLoader = ({
  fetchParameter = fetchFromSsm,
  now = Date.now,
  ttlMs = TTL_MS,
  maxStaleMs = MAX_STALE_MS,
} = {}) => {
  let current = DEFAULT_TABLE;
  let fetchedAt = -Infinity;
  let goodAt = -Infinity;

  // Keep-last-good has a ceiling: a table that could not be refreshed for
  // `maxStaleMs` reverts to the built-in default, which is the restrictive
  // one, so an SSM outage or a typo in an edit never keeps an old, looser
  // table serving indefinitely.
  const lastGood = (outcome) => {
    if (current !== DEFAULT_TABLE && now() - goodAt > maxStaleMs) {
      console.error('[AVAILABILITY_TABLE]', { outcome: 'reverted_to_default', after: outcome });
      current = DEFAULT_TABLE;
    }
    return current;
  };

  return async () => {
    if (process.env.NODE_ENV !== 'prod' && process.env.AVAILABILITY_TABLE_JSON) {
      const { doc, problems } = parse(
        process.env.AVAILABILITY_TABLE_JSON,
        'AVAILABILITY_TABLE_JSON'
      );
      if (problems.length === 0) return doc;
      console.error('[AVAILABILITY_TABLE]', { outcome: 'invalid', source: 'env', problems });
      return current;
    }
    if (now() - fetchedAt < ttlMs) return current;
    fetchedAt = now();
    let text;
    try {
      text = await fetchParameter();
    } catch (error) {
      console.error('[AVAILABILITY_TABLE]', { outcome: 'fetch_failed', message: error.message });
      return lastGood('fetch_failed');
    }
    if (text === null || text === undefined) {
      if (process.env.NODE_ENV === 'prod') {
        console.error('[AVAILABILITY_TABLE]', { outcome: 'no_parameter' });
      }
      return lastGood('no_parameter');
    }
    const { doc, problems } = parse(text, 'ssm');
    if (problems.length > 0) {
      console.error('[AVAILABILITY_TABLE]', { outcome: 'invalid', source: 'ssm', problems });
      return lastGood('invalid');
    }
    current = doc;
    goodAt = now();
    return current;
  };
};

const loadTable = createTableLoader();

module.exports = {
  DEFAULT_TABLE,
  JUPITER_PROHIBITED,
  EMBARGOED,
  PROVIDERS,
  validateTable,
  createTableLoader,
  loadTable,
  rowsFor,
};
