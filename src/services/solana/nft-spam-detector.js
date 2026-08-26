'use strict';

/**
 * Solana NFT spam / scam heuristics.
 *
 * Server-side equivalent of the eight client-side heuristics that used to
 * live in salmon-wallet-frontend (`utils/nft-spam-filter.ts`). Centralising the
 * scoring lets the backend hot-fix new attack patterns without an app
 * release and keeps mobile + extension on the same verdict.
 *
 * H1 (blacklist) is owned by the existing blacklist enrichment; this
 * module emits H2–H8 as `spamReasons` codes plus a weighted `spamScore`.
 *
 * Scoring model: every reason carries a weight (`REASON_WEIGHTS`); `spamScore`
 * is their sum and the listing hides an item when
 * `spamScore >= SPAM_THRESHOLD`. A strong reason (weight 2) hides on its own;
 * weak reasons (weight 1) only hide in pairs, so one lure word in an otherwise
 * ordinary NFT never hides it.
 *
 * | reason                   | weight |
 * | ------------------------ | ------ |
 * | url_in_attributes        | 2      |
 * | phishing_description     | 2      |
 * | barebones_with_urls      | 2      |
 * | domain_in_name           | 2      |
 * | ticker_name              | 2      |
 * | spam_name_keyword        | 2      |
 * | hidden_char_obfuscation  | 2      |
 * | barebones_nft            | 2      |
 * | mixed_script             | 2      |
 * | lure_word                | 1      |
 * | empty_name               | 1      |
 * | emoji_in_name            | 1      |
 * | qr_code_lure             | 1      |
 * | url_in_description       | 1      |
 * | duplicate_name           | 1      |
 *
 * `duplicate_name` is the one reason with a known ceiling: a legitimate drop
 * of three same-named lure-worded items on one page ("Raffle Ticket #1..#3")
 * is hidden — visible again under developer mode, which is the accepted
 * trade-off of the MODERATE policy.
 *
 * Measured and rejected as weak reasons (2026-08-25 fixtures): an empty
 * symbol, a missing image and a json_uri outside the big storage hosts. Each
 * is common on legitimate items — Portals loot boxes have all three, and
 * healthy wallets' metadata lives on dozens of per-project CDNs — so any of
 * them next to a lure word would have hidden real NFTs.
 *
 * Every text heuristic runs against `normalizeForScoring`d input, never the raw
 * string. Without that, all of them are trivially bypassed: a live phishing NFT
 * in the wild ("JUP" / jupbonus.lol) ships a description with a zero-width space
 * between every single character — 193 of them — so `claim now`, `.lol` and the
 * domain itself never match as literals. Broadening the keyword list would not
 * have touched it; the attacker beat the matcher, not the vocabulary.
 */

/**
 * Invisible characters stripped before matching. Deliberately excludes U+200C
 * (ZWNJ) and U+200D (ZWJ) from the *flagging* set below — both are legitimate
 * (emoji sequences, Persian/Arabic orthography) — but they are still removed
 * here, since keyword matching is on English text and joining is harmless.
 */
const INVISIBLE_CHARS = /[\u00AD\u180E\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF]/g;

/**
 * The narrow set that actually signals obfuscation. Emoji ZWJ (U+200D) and ZWNJ
 * (U+200C) are excluded so a family emoji or a Persian name cannot trip it.
 */
const OBFUSCATION_CHARS = /[\u00AD\u180E\u200B\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF]/g;

/** Below this, a stray invisible character is more likely an encoding artifact. */
const OBFUSCATION_MIN_COUNT = 3;

/**
 * Domains are matched with an optional space on either side of the dot:
 * `jupcash . com` is how a live lure spells its domain so a literal `.com`
 * never matches, and no legitimate text spaces a dot like that.
 */
const URL_PATTERN = /https?:\/\/|\w ?\. ?(com|io|pro|lol|xyz|net|org|app|vip|site|top|club)\b/i;

const NAME_DOMAIN_PATTERN =
  /\w ?\. ?(com|io|pro|lol|xyz|net|org|app|red|expert|site|fun|club|promo|top|gg|me|cc|pics|bet|vip|markets)\b/i;

const PHISHING_KEYWORDS =
  /claim (your|now|at|here|within|before)|visit the domain|check available claim|airdrop pass|free mint|eligible for|go to|lucky box|drop pass|whitelist|selected for|reward drop|forfeit/i;

const SPAM_NAME_KEYWORDS = /airdrop|free mint|claim your|lucky box|redeem.*voucher/i;

/**
 * Words a lure leans on. Each is also an ordinary NFT word ("Z-Pass", "Golden
 * Ticket"), so this is a weak reason: it only hides alongside a second signal.
 * "box" is deliberately absent: Portals loot boxes ("Okay Bears Loot Box",
 * "Mad Lads Loot Box") are held by the healthy fixtures a dozen times each and
 * pair with almost every other weak signal.
 */
const LURE_WORDS = /\b(voucher|drop|claim|gift|pass|ticket|reward|admit|airdrop)\b/i;

const TICKER_NAME_PATTERN = /^\$[A-Z]{2,}/i;

/**
 * A word that mixes Latin letters with Cyrillic or Greek letters that LOOK
 * Latin (`Vоuchеr`, `ТRUMР`, `Cоngrаtulаtions`). Nothing legitimate spells a
 * word that way — it exists to slip past keyword filters — while a genuinely
 * bilingual name mixes scripts across words, or uses letters outside the
 * confusable set (`NFTы`), and stays clear.
 */
const CONFUSABLE_LETTERS = 'аеіјоѕрсухһԁАВЕНІЈКМОРЅСТУХαεικνορτυχΑΒΕΖΗΙΚΜΝΟΡΤΥΧ';
const MIXED_SCRIPT_WORD = new RegExp(
  `(?=[^\\s]*[A-Za-z])(?=[^\\s]*[${CONFUSABLE_LETTERS}])[^\\s]+`
);

/** "Scan the QR code / box to unlock your special offer": the QR-lure family. */
const QR_LURE_PATTERN = /scan the (qr|code|box)|unlock your special offer/i;

const EMOJI_PATTERN = /\p{Emoji_Presentation}|\uFE0F/u;

/**
 * Collapse a string to what a human actually reads: fold compatibility forms
 * (defeats fullwidth/homoglyph tricks), drop invisible characters, squash
 * whitespace. Used for scoring only — the resource still returns the original
 * name and description untouched.
 */
const normalizeForScoring = (value) => {
  if (typeof value !== 'string' || value === '') return '';
  return value.normalize('NFKC').replace(INVISIBLE_CHARS, '').replace(/\s+/g, ' ').trim();
};

/** A name repeated this often within one listing page reads as a mass drop. */
const DUPLICATE_NAME_MIN_COUNT = 3;

/**
 * Key under which a name is counted for `duplicate_name`: normalized,
 * lowercased, with a trailing edition number dropped so `BOX#43` and `BOX#64`
 * count as one name. Empty names never count — they have their own reason.
 */
const nameKey = (name) =>
  normalizeForScoring(name)
    .toLowerCase()
    .replace(/\s*#\s*\d+$/, '');

/**
 * Count names across one page of provider-normalized assets, for the
 * `context.nameCounts` that `score` reads. Computed once per listing by the
 * service and carried on `locals`, so the detector stays pure per item.
 *
 * @param {Array<{name?: string}>} nfts
 * @returns {Object<string, number>}
 */
const countNames = (nfts) =>
  nfts.reduce((counts, nft) => {
    const key = nameKey(nft?.name);
    return key ? { ...counts, [key]: (counts[key] ?? 0) + 1 } : counts;
  }, {});

const countObfuscationChars = (value) =>
  typeof value === 'string' ? (value.match(OBFUSCATION_CHARS) ?? []).length : 0;

/**
 * Padding text with invisible characters has exactly one purpose: to slip past a
 * filter that reads it. Nothing legitimate does this, which makes the evasion
 * itself a high-precision signal — and one an attacker cannot drop without
 * exposing the keywords they were hiding.
 */
const hasHiddenCharObfuscation = ({ name, description }) =>
  countObfuscationChars(name) + countObfuscationChars(description) >= OBFUSCATION_MIN_COUNT;

/** H2: any trait `value` looks like a URL / bare domain. */
const hasUrlInAttributes = (attributes) => {
  if (!Array.isArray(attributes) || attributes.length === 0) return false;
  return attributes.some((attr) =>
    URL_PATTERN.test(normalizeForScoring(String(attr?.value ?? '')))
  );
};

/** H3: description contains both a phishing-style keyword and a URL. */
const hasPhishingDescription = (description) => {
  if (!description) return false;
  return PHISHING_KEYWORDS.test(description) && URL_PATTERN.test(description);
};

/**
 * Belonging to a collection is the strongest legitimacy signal available. It
 * arrives two ways: as a name inside the off-chain JSON, or as a verified
 * on-chain grouping from DAS (the resource sets `hasCollection` only when
 * `collection.verified === true`). Either counts.
 */
const belongsToCollection = ({ collectionName, hasCollection }) =>
  Boolean(collectionName) || hasCollection === true;

/** H4: no image/collection, but the description or an attribute carries a URL. */
const isBarebonesWithUrls = (nft) => {
  const { image, description, attributes } = nft;
  if (image || belongsToCollection(nft)) return false;
  const descHasUrl = description ? URL_PATTERN.test(description) : false;
  return descHasUrl || hasUrlInAttributes(attributes);
};

/** H5: NFT name itself contains a domain-like string (e.g. `foo.xyz`). */
const hasDomainInName = (name) => Boolean(name) && NAME_DOMAIN_PATTERN.test(name);

/** H6: name looks like a cash-tag ticker (e.g. `$FOO`). */
const hasTickerName = (name) => Boolean(name) && TICKER_NAME_PATTERN.test(name);

/** Strong: a Latin word padded with lookalike Cyrillic/Greek letters. */
const hasMixedScript = ({ name, description }) =>
  MIXED_SCRIPT_WORD.test(name) || MIXED_SCRIPT_WORD.test(description);

/** Weak: nothing readable in the name (empty, or only control/punctuation). */
const isEmptyName = (name) => !/[\p{L}\p{N}]/u.test(name);

/** Weak: an emoji in the name (🎁, 💎, ✅ open most lures). */
const hasEmojiInName = (name) => EMOJI_PATTERN.test(name);

/** Weak: the description asks to scan a code. */
const hasQrLure = (description) => QR_LURE_PATTERN.test(description);

/**
 * Weak: a URL in the description without a phishing phrase next to it. With
 * the phrase it is `phishing_description` instead, so the two never stack.
 */
const hasUrlInDescription = (description) =>
  URL_PATTERN.test(description) && !hasPhishingDescription(description);

/** Weak (wallet-level): the same name appears ≥3 times on this page. */
const isDuplicateName = (name, nameCounts) =>
  Boolean(nameCounts) && (nameCounts[nameKey(name)] ?? 0) >= DUPLICATE_NAME_MIN_COUNT;

/** Weak: name contains a lure word. */
const hasLureWord = (name) => Boolean(name) && LURE_WORDS.test(name);

/** H7: name contains a spam/airdrop-bait keyword. */
const hasSpamNameKeyword = (name) => Boolean(name) && SPAM_NAME_KEYWORDS.test(name);

/** H8: no description, no collection, and no attributes at all. */
const isBarebonesNft = (nft) => {
  // `metadataResolved: false` means the off-chain document could not be
  // fetched, so we do not actually know whether this NFT has a description or
  // attributes. Absence of evidence is not evidence of spam: dead IPFS pins are
  // routine, and scoring one as barebones would hide a legitimate NFT from the
  // person who owns it. Only score what we could actually read.
  if (nft.metadataResolved === false) return false;

  const { description, attributes } = nft;
  const noDescription = !description || description.trim() === '';
  const noAttributes = !Array.isArray(attributes) || attributes.length === 0;
  return noDescription && !belongsToCollection(nft) && noAttributes;
};

/**
 * Score H2–H8 against a normalised NFT object.
 *
 * @param {{
 *   name?: string,
 *   description?: string,
 *   image?: string,
 *   collectionName?: string,
 *   hasCollection?: boolean,
 *   attributes?: Array<{trait_type?: string, value?: unknown}>,
 *   metadataResolved?: boolean
 * }} nft - `hasCollection` carries the verified on-chain grouping from DAS, which
 *   is where a collection actually lives for most assets. `metadataResolved: false`
 *   means the off-chain document could not be fetched; the heuristics that depend
 *   on it are then skipped rather than scored against missing data.
 * @param {{ nameCounts?: Object<string, number> }} [context] - wallet-level
 *   context: `nameCounts` from `countNames` over the page this item belongs to.
 * @returns {{ spamScore: number, spamReasons: string[] }}
 */
const score = (nft, context = {}) => {
  const reasons = [];

  // Text heuristics read the normalized copy. The obfuscation check reads the
  // raw strings, because there the invisible characters ARE the evidence.
  const readable = {
    ...nft,
    name: normalizeForScoring(nft.name),
    description: normalizeForScoring(nft.description),
  };

  if (hasUrlInAttributes(nft.attributes)) reasons.push('url_in_attributes');
  if (hasPhishingDescription(readable.description)) reasons.push('phishing_description');
  if (isBarebonesWithUrls(readable)) reasons.push('barebones_with_urls');
  if (hasDomainInName(readable.name)) reasons.push('domain_in_name');
  if (hasTickerName(readable.name)) reasons.push('ticker_name');
  if (hasSpamNameKeyword(readable.name)) reasons.push('spam_name_keyword');
  if (hasHiddenCharObfuscation(nft)) reasons.push('hidden_char_obfuscation');
  if (isBarebonesNft(readable)) reasons.push('barebones_nft');
  if (hasMixedScript(readable)) reasons.push('mixed_script');
  if (hasLureWord(readable.name)) reasons.push('lure_word');
  if (isEmptyName(readable.name)) reasons.push('empty_name');
  if (hasEmojiInName(readable.name)) reasons.push('emoji_in_name');
  if (hasQrLure(readable.description)) reasons.push('qr_code_lure');
  if (hasUrlInDescription(readable.description)) reasons.push('url_in_description');
  if (isDuplicateName(nft.name, context.nameCounts)) reasons.push('duplicate_name');

  const spamScore = reasons.reduce((sum, reason) => sum + REASON_WEIGHTS[reason], 0);
  return { spamScore, spamReasons: reasons };
};

/** Items scoring at or above this are hidden from the default listing. */
const SPAM_THRESHOLD = 2;

/** True when a `spamScore` (as emitted by `score`) should hide the item. */
const isSpamScore = (spamScore) => typeof spamScore === 'number' && spamScore >= SPAM_THRESHOLD;

/**
 * Closed set of heuristic codes that may appear in `spamReasons`. The
 * `solana-nft-listing` spec pins this set; tests assert no other code
 * leaks out of `score`.
 */
const REASON_WEIGHTS = Object.freeze({
  url_in_attributes: 2,
  phishing_description: 2,
  barebones_with_urls: 2,
  domain_in_name: 2,
  ticker_name: 2,
  spam_name_keyword: 2,
  hidden_char_obfuscation: 2,
  barebones_nft: 2,
  mixed_script: 2,
  lure_word: 1,
  empty_name: 1,
  emoji_in_name: 1,
  qr_code_lure: 1,
  url_in_description: 1,
  duplicate_name: 1,
});

const SPAM_REASON_CODES = Object.freeze(Object.keys(REASON_WEIGHTS));

module.exports = {
  score,
  countNames,
  isSpamScore,
  SPAM_THRESHOLD,
  REASON_WEIGHTS,
  SPAM_REASON_CODES,
  __testing: { normalizeForScoring, hasHiddenCharObfuscation },
};
