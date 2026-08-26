'use strict';

/**
 * Regression over real wallets, captured from
 * `GET /nft?includeSpam=true&debug=1&limit=100&offset=<n>` (2026-08-25, Triton
 * DAS). Each fixture pins the hidden count so a heuristic change shows up as a
 * number, not a surprise in the wallet.
 *
 * - `nft-spam-wallet-*`: airdrop-spam dumps (every item is a lure).
 * - `nft-healthy-wallet-*`: Mad Lads / Okay Bears holders found through DAS
 *   `getAssetsByGroup`. Their spam share is small and reviewed by name; the
 *   invariant below is that nothing they held visible at capture time gets
 *   hidden by a later heuristic unless it is listed in `REVIEWED_SPAM`.
 * - `nft-mixed-wallet-*`: a Mad Lads holder drowning in spam — the realistic
 *   case, held to the same invariant.
 */

const { score, countNames, isSpamScore } = require('../nft-spam-detector');

const FIXTURES = {
  'nft-spam-wallet-6xUK9': { hidden: 94 },
  'nft-spam-wallet-6xUK9-300': { hidden: 96 },
  'nft-spam-wallet-6xUK9-900': { hidden: 94 },
  'nft-spam-wallet-vu1sG-0': { hidden: 96 },
  'nft-spam-wallet-Btsmi-0': { hidden: 94 },
  'nft-healthy-wallet-p9LLP-0': { hidden: 1, total: 19, healthy: true },
  'nft-healthy-wallet-Byyv-0': { hidden: 3, total: 22, healthy: true },
  'nft-healthy-wallet-Bzmih-0': { hidden: 5, healthy: true },
  'nft-healthy-wallet-AyYa-0': { hidden: 7, healthy: true },
  'nft-healthy-wallet-4hqq-0': { hidden: 12, healthy: true },
  'nft-mixed-wallet-5LTWn-0': { hidden: 21, healthy: true },
};

/**
 * Items on healthy fixtures that were visible at capture time but are spam on
 * inspection (name → why). Anything else newly hidden on a healthy fixture is a
 * regression.
 */
const REVIEWED_SPAM = new Map([
  ['TENSOR.MARKETS PASS', 'lure pass carrying a lookalike domain; no metadata'],
  ['#9', 'description spells $TRUMP with Cyrillic lookalikes'],
  ['Slеrf #2276', 'Cyrillic е — spoof of the Slerf collection'],
  ['Clоuds #2718', 'Cyrillic о — spoof of the Clouds collection'],
  ['A WОLF #2157', 'Cyrillic О — spoof of the A WOLF collection'],
  ['Bоnkеr #130', 'Cyrillic о/е — spoof of the Bonkers collection'],
  ['BOX#{numbers}', 'QR lure ("scan the Box to unlock your special offer"), four copies'],
]);

const load = (name) => require(`./fixtures/${name}.json`).data;

const toDetectorInput = (item, hasCollection = item.collectionVerified === true) => ({
  name: item.name,
  description: item.description,
  image: item.media,
  collectionName: item.collection?.name,
  hasCollection,
  attributes: item.extras?.attributes,
  metadataResolved: item.metadataResolved !== false,
});

const BAREBONES_RULES = ['barebones_nft', 'barebones_with_urls'];

describe.each(Object.entries(FIXTURES))('nft-spam-detector over %s', (name, expected) => {
  const items = load(name);
  const context = { nameCounts: countNames(items) };
  const scoreOf = (item) => score(toDetectorInput(item), context).spamScore;

  test('fixture is a full debug page', () => {
    expect(items).toHaveLength(expected.total ?? 100);
    expect(items.every((i) => 'collectionVerified' in i && 'metadataResolved' in i)).toBe(true);
  });

  test(`hides ${expected.hidden} of ${items.length}`, () => {
    const hidden = items.filter((item) => isSpamScore(scoreOf(item)));
    expect(hidden.length).toBe(expected.hidden);
  });

  if (expected.healthy) {
    test('nothing visible at capture is newly hidden unless reviewed as spam', () => {
      const newlyHidden = items
        .filter((item) => item.spamScore === 0)
        .filter((item) => isSpamScore(scoreOf(item)))
        .map((item) => item.name)
        .filter((itemName) => !REVIEWED_SPAM.has(itemName));

      expect(newlyHidden).toEqual([]);
    });
  }
});

describe('nft-spam-detector over the 6xUK9 wallet fixture', () => {
  const items = load('nft-spam-wallet-6xUK9');
  const context = { nameCounts: countNames(items) };

  test('re-scoring keeps every captured spamReason (recall never regresses)', () => {
    items.forEach((item) => {
      const { spamReasons } = score(toDetectorInput(item));
      expect(spamReasons).toEqual(expect.arrayContaining(item.spamReasons));
    });
  });

  test('hidden count is the same whether any grouping or only a verified one shields', () => {
    // Every grouping on this wallet is verified on-chain — spammers verify
    // their own collections — so gating on `verified` moves nothing here.
    const hidden = (shield) =>
      items.filter((item) =>
        isSpamScore(score(toDetectorInput(item, shield(item)), context).spamScore)
      ).length;

    expect(hidden((item) => item.collectionVerified !== null)).toBe(94);
    expect(hidden((item) => item.collectionVerified === true)).toBe(94);
  });

  test('no verified, resolved, described NFT is flagged by a barebones rule', () => {
    const offenders = items.filter((item) => {
      if (item.collectionVerified !== true || !item.metadataResolved || !item.description) {
        return false;
      }
      const { spamReasons } = score(toDetectorInput(item, true));
      return spamReasons.some((reason) => BAREBONES_RULES.includes(reason));
    });

    expect(offenders).toEqual([]);
  });
});
