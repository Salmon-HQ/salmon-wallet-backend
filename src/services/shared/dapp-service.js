'use strict';

/**
 * dApp metadata service.
 *
 * Fetches OpenGraph tags for a third-party dApp URL so the wallet UI can
 * render its name and icon when the user is connecting or signing a
 * request from that origin.
 *
 * The URL comes from an unauthenticated caller, so the fetch is deliberately
 * hand-rolled rather than delegated: every hop is validated by
 * `dapp-url-guard` (see the SSRF rationale there), the request is bounded in
 * time and size, and redirects are followed manually so each target is
 * re-checked. Network failures are reported as a fixed `dapp_unreachable`
 * message — echoing the transport error back would turn this endpoint into a
 * port scanner, since "connection refused" and "socket hang up" distinguish a
 * closed port from an open one.
 */

const http = require('axios');
const { assertFetchableUrl, DappUrlError } = require('./dapp-url-guard');

const REQUEST_TIMEOUT = 5000;
const MAX_RESPONSE_BYTES = 1024 * 1024;
const MAX_REDIRECTS = 2;
const MAX_NAME_LENGTH = 64;
// Enough for the <head> of any reasonable page; OG tags live there.
const MAX_PARSED_BYTES = 256 * 1024;

const META_TAG_PATTERN = /<meta\s+[^>]*>/gi;

/**
 * Reads the `property`/`name` and `content` attributes out of a single meta
 * tag. Deliberately a regex rather than a DOM parse: this only needs three
 * well-known OG tags, and a full HTML parser is a dependency (and a parsing
 * surface) that the two fields do not justify.
 *
 * @param {string} tag
 * @returns {{key: string, value: string}|null}
 */
const parseMetaTag = (tag) => {
  const key = tag.match(/(?:property|name)\s*=\s*["']([^"']+)["']/i);
  const value = tag.match(/content\s*=\s*["']([^"']*)["']/i);
  if (!key || !value) return null;
  return { key: key[1].toLowerCase(), value: value[1] };
};

/**
 * Extracts the OpenGraph tags this service cares about from raw HTML.
 * @param {string} html
 * @returns {Object<string, string>}
 */
const extractOpenGraphTags = (html) => {
  const head = html.slice(0, MAX_PARSED_BYTES);
  const tags = {};

  for (const tag of head.match(META_TAG_PATTERN) || []) {
    const parsed = parseMetaTag(tag);
    if (parsed && !(parsed.key in tags)) {
      tags[parsed.key] = parsed.value;
    }
  }

  return tags;
};

/**
 * Fetches a validated URL, following up to `MAX_REDIRECTS` hops and
 * re-validating each target. Every hop connects to the address the guard
 * validated (axios `lookup` pin) while the Host header keeps the hostname,
 * so a rebinding DNS answer cannot swap in a private address between
 * validation and connect.
 *
 * @param {string} rawUrl
 * @returns {Promise<string>} response body
 * @throws {DappUrlError}
 */
const fetchHtml = async (rawUrl) => {
  let pinned = await assertFetchableUrl(rawUrl);

  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const { url: target, address, family } = pinned;
    let response;
    try {
      response = await http.get(target.toString(), {
        lookup: () => [{ address, family }],
        timeout: REQUEST_TIMEOUT,
        maxRedirects: 0,
        maxContentLength: MAX_RESPONSE_BYTES,
        responseType: 'text',
        // 3xx must reach us as a response so the location can be validated
        // before it is followed; anything else is the caller's problem.
        validateStatus: (status) => status < 400,
      });
    } catch (error) {
      if (error instanceof DappUrlError) throw error;
      throw new DappUrlError('The dapp could not be reached.', 'dapp_unreachable', 502);
    }

    if (response.status < 300) {
      return typeof response.data === 'string' ? response.data : '';
    }

    const location = response.headers?.location;
    if (!location) {
      throw new DappUrlError('The dapp could not be reached.', 'dapp_unreachable', 502);
    }

    pinned = await assertFetchableUrl(new URL(location, target).toString());
  }

  throw new DappUrlError('The dapp redirected too many times.', 'dapp_unreachable', 502);
};

/**
 * Resolve a dApp's display metadata (name + icon) from its URL via
 * OpenGraph tags.
 *
 * `icon` is only returned when it is an absolute https URL: the wallet renders
 * it as the dApp's identity on transaction-approval screens, and an http or
 * relative value there is not worth the mixed-content and ambiguity. `name` is
 * length-capped for the same reason — it is attacker-controlled text shown
 * next to a signing prompt.
 *
 * @param {string} url - dApp URL
 * @returns {Promise<{name: string|undefined, icon: string|undefined}>}
 * @throws {DappUrlError} 400 when the URL is missing or not fetchable, 502
 *   when the dapp itself cannot be reached.
 */
const getMetadata = async (url) => {
  const tags = extractOpenGraphTags(await fetchHtml(url));

  const rawName = tags['og:site_name'] || tags['og:title'];
  const rawIcon = tags['og:image'];

  return {
    name: rawName ? rawName.slice(0, MAX_NAME_LENGTH) : undefined,
    icon: rawIcon && rawIcon.startsWith('https://') ? rawIcon : undefined,
  };
};

module.exports = { getMetadata, extractOpenGraphTags };
