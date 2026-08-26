'use strict';

const {
  score,
  countNames,
  isSpamScore,
  SPAM_THRESHOLD,
  REASON_WEIGHTS,
  SPAM_REASON_CODES,
} = require('../nft-spam-detector');

const baseClean = {
  name: 'Mad Lads #1234',
  description: 'A Mad Lad NFT from the genesis collection.',
  image: 'https://arweave.net/clean.png',
  collectionName: 'Mad Lads',
  attributes: [{ trait_type: 'Background', value: 'Blue' }],
};

describe('nft-spam-detector scoring model', () => {
  test("spamScore is the sum of the fired reasons' weights", () => {
    const result = score({ ...baseClean, name: '$GIFT.LOL #1' });
    expect(result.spamReasons).toEqual(['domain_in_name', 'ticker_name', 'lure_word']);
    expect(result.spamScore).toBe(
      REASON_WEIGHTS.domain_in_name + REASON_WEIGHTS.ticker_name + REASON_WEIGHTS.lure_word
    );
  });

  test('a single strong reason hides on its own', () => {
    expect(isSpamScore(score({ ...baseClean, name: '$GIFT #1' }).spamScore)).toBe(true);
  });

  test('isSpamScore is the threshold gate and rejects non-numbers', () => {
    expect(isSpamScore(SPAM_THRESHOLD - 1)).toBe(false);
    expect(isSpamScore(SPAM_THRESHOLD)).toBe(true);
    expect(isSpamScore(undefined)).toBe(false);
  });

  test('every reason code has a weight', () => {
    expect(Object.keys(REASON_WEIGHTS)).toEqual([...SPAM_REASON_CODES]);
  });
});

describe('nft-spam-detector.score', () => {
  test('returns score 0 with empty reasons for a clean NFT', () => {
    expect(score(baseClean)).toEqual({ spamScore: 0, spamReasons: [] });
  });

  test('flags URLs in attribute values', () => {
    const result = score({
      ...baseClean,
      attributes: [{ trait_type: 'Link', value: 'https://scam.lol/claim' }],
    });
    expect(result.spamReasons).toContain('url_in_attributes');
    expect(result.spamScore).toBeGreaterThanOrEqual(1);
  });

  test('flags phishing keywords combined with a URL in description', () => {
    const result = score({
      ...baseClean,
      description: 'Claim your airdrop at https://airdrop.lol/claim',
    });
    expect(result.spamReasons).toContain('phishing_description');
  });

  test('flags barebones NFT with URL content', () => {
    const result = score({
      name: 'Free Drop',
      description: 'Visit https://claim.xyz now',
      image: '',
      collectionName: undefined,
      attributes: [],
    });
    expect(result.spamReasons).toContain('barebones_with_urls');
  });

  test('flags domain pattern in NFT name', () => {
    const result = score({ ...baseClean, name: 'JUP.PRO Drop Pass' });
    expect(result.spamReasons).toContain('domain_in_name');
  });

  test('flags a domain spelled with spaced dots (`jupcash . com`)', () => {
    expect(score({ ...baseClean, name: 'Visit jupcash . com' }).spamReasons).toContain(
      'domain_in_name'
    );
    expect(
      score({ ...baseClean, description: 'Check jupcash . com and claim your $1000' }).spamReasons
    ).toContain('phishing_description');
  });

  test('a sentence-ending dot followed by a TLD-looking word is not a domain', () => {
    const result = score({ ...baseClean, description: 'Best in class. Top tier art.' });
    expect(result.spamReasons).not.toContain('phishing_description');
  });

  test('a lure word alone is a weak reason that does not hide', () => {
    const result = score({ ...baseClean, name: 'Golden Ticket' });
    expect(result.spamReasons).toEqual(['lure_word']);
    expect(isSpamScore(result.spamScore)).toBe(false);
  });

  test('"box" is not a lure word (loot boxes are ordinary)', () => {
    expect(score({ ...baseClean, name: 'Okay Bears Loot Box' }).spamReasons).toEqual([]);
  });

  describe('mixed-script homoglyphs', () => {
    test('a Latin word padded with Cyrillic lookalikes hides on its own', () => {
      const result = score({ ...baseClean, name: '🎁WEN NFT Vоuchеr' });
      expect(result.spamReasons).toContain('mixed_script');
      expect(isSpamScore(result.spamScore)).toBe(true);
    });

    test('lookalikes in the description count too', () => {
      const result = score({ ...baseClean, name: '#17', description: 'Unlock 1000 $ТRUMР now' });
      expect(result.spamReasons).toContain('mixed_script');
    });

    test('a purely Cyrillic name, or scripts mixed across words, is fine', () => {
      expect(score({ ...baseClean, name: 'Медведь #12' }).spamReasons).toEqual([]);
      expect(score({ ...baseClean, name: 'Медведь by Okay Bears' }).spamReasons).toEqual([]);
    });

    test('a Cyrillic suffix that does not look Latin (`NFTы`) is fine', () => {
      expect(score({ ...baseClean, name: 'NFTы #1' }).spamReasons).toEqual([]);
    });
  });

  describe('weak per-item reasons', () => {
    const weakOnly = (nft, reason) => {
      const result = score({ ...baseClean, ...nft });
      expect(result.spamReasons).toEqual([reason]);
      expect(isSpamScore(result.spamScore)).toBe(false);
    };

    test('empty_name: nothing readable in the name', () => {
      weakOnly({ name: '' }, 'empty_name');
      weakOnly({ name: '\u0001' }, 'empty_name');
    });

    test('emoji_in_name', () => weakOnly({ name: '💎 Blue Gem' }, 'emoji_in_name'));

    test('qr_code_lure: the description asks to scan a code', () => {
      weakOnly({ description: 'Scan the Box to unlock your special offer!' }, 'qr_code_lure');
    });

    test('url_in_description: a bare URL without a phishing phrase', () => {
      weakOnly({ description: 'Random event! https://WORMHOLEBOX.com' }, 'url_in_description');
    });

    test('url_in_description never stacks on phishing_description', () => {
      const result = score({
        ...baseClean,
        description: 'Claim your airdrop at https://airdrop.lol/claim',
      });
      expect(result.spamReasons).toContain('phishing_description');
      expect(result.spamReasons).not.toContain('url_in_description');
    });

    test('two weak reasons together hide', () => {
      const result = score({
        ...baseClean,
        name: '🎁 Gift #030',
        description: 'Scan the Code to unlock your special offer!',
      });
      expect(result.spamReasons).toEqual(['lure_word', 'emoji_in_name', 'qr_code_lure']);
      expect(isSpamScore(result.spamScore)).toBe(true);
    });
  });

  describe('duplicate_name (wallet-level, via context)', () => {
    const page = [
      { name: 'Limited Drop' },
      { name: 'limited drop' },
      { name: 'Limited  Drop' },
      { name: 'BOX#43' },
      { name: 'BOX #64' },
      { name: 'BOX#8' },
      { name: '' },
      { name: '' },
      { name: '' },
      { name: 'Mad Lads #1' },
    ];

    test('countNames folds case, whitespace and trailing edition numbers; skips empty', () => {
      expect(countNames(page)).toEqual({ 'limited drop': 3, box: 3, 'mad lads': 1 });
    });

    test('is a weak reason that needs the page context and three repeats', () => {
      const nameCounts = countNames(page);
      expect(score({ ...baseClean, name: 'Mad Lads #1' }, { nameCounts }).spamReasons).toEqual([]);
      expect(score({ ...baseClean, name: 'BOX #64' }, { nameCounts }).spamReasons).toEqual([
        'duplicate_name',
      ]);
      expect(score({ ...baseClean, name: 'BOX #64' }).spamReasons).toEqual([]);
    });

    test('a repeated lure name hides', () => {
      const result = score(
        { ...baseClean, name: 'Limited Drop' },
        { nameCounts: countNames(page) }
      );
      expect(result.spamReasons).toEqual(['lure_word', 'duplicate_name']);
      expect(isSpamScore(result.spamScore)).toBe(true);
    });
  });

  test('flags ticker-style $SYMBOL prefix in name', () => {
    const result = score({ ...baseClean, name: '$GIFT #1' });
    expect(result.spamReasons).toContain('ticker_name');
  });

  test('flags spam keywords in name (airdrop / free mint / etc.)', () => {
    const result = score({ ...baseClean, name: 'Airdrop Pass #5' });
    expect(result.spamReasons).toContain('spam_name_keyword');
  });

  test('flags barebones NFT (no description, collection, attributes)', () => {
    const result = score({
      name: 'Random',
      description: '',
      image: 'https://arweave.net/x.png',
      collectionName: null,
      attributes: [],
    });
    expect(result.spamReasons).toContain('barebones_nft');
  });

  test('aggregates multiple heuristics into spamScore', () => {
    const result = score({
      name: '$JUP.LOL Airdrop',
      description: 'Claim your free mint at https://drop.xyz',
      image: '',
      collectionName: '',
      attributes: [],
    });
    expect(result.spamScore).toBeGreaterThanOrEqual(4);
    const expectedScore = result.spamReasons.reduce((sum, r) => sum + REASON_WEIGHTS[r], 0);
    expect(result.spamScore).toBe(expectedScore);
  });

  test('every emitted reason is a member of the closed set declared by SPAM_REASON_CODES', () => {
    const allReasons = new Set();
    const fixtures = [
      { attributes: [{ trait_type: 'link', value: 'https://x.lol' }] },
      { description: 'Claim your free mint at https://x.lol' },
      { name: '', description: 'visit https://x.lol', attributes: [] },
      { name: 'JUP.PRO Drop' },
      { name: '$GIFT #1' },
      { name: 'Airdrop pass' },
      { name: 'Plain' },
    ];
    fixtures.forEach((fixture) => {
      const result = score({ name: fixture.name ?? 'X', ...fixture });
      result.spamReasons.forEach((reason) => allReasons.add(reason));
    });

    const closedSet = new Set(SPAM_REASON_CODES);
    allReasons.forEach((reason) => {
      expect(closedSet.has(reason)).toBe(true);
    });
  });

  // A DAS asset carries its collection in `grouping`, never inside the
  // off-chain `json`. Scoring only `collectionName` made every NFT from the
  // index look collectionless, which was enough on its own to hide it.
  describe('collection membership from the on-chain grouping', () => {
    const dasShaped = {
      name: 'Mindfolk Founder #5154',
      description: undefined,
      image: undefined,
      collectionName: undefined,
      attributes: undefined,
      metadataResolved: true,
    };

    test('does not call a grouped NFT barebones even with no off-chain fields', () => {
      const result = score({ ...dasShaped, hasCollection: true });
      expect(result.spamReasons).not.toContain('barebones_nft');
      expect(result).toEqual({ spamScore: 0, spamReasons: [] });
    });

    test('still calls an ungrouped NFT with no off-chain fields barebones', () => {
      const result = score({ ...dasShaped, hasCollection: false });
      expect(result.spamReasons).toContain('barebones_nft');
    });

    test('a verified grouping also clears barebones_with_urls', () => {
      const result = score({
        name: 'Genuine #1',
        description: 'Mint site: https://genuine.io',
        image: undefined,
        hasCollection: true,
        metadataResolved: true,
      });
      expect(result.spamReasons).not.toContain('barebones_with_urls');
    });
  });

  // Failing to fetch an off-chain document tells us nothing about the NFT.
  // Dead IPFS pins are routine, and treating one as spam would hide an NFT
  // from the person who owns it.
  describe('unresolved metadata fails open', () => {
    const unresolved = {
      name: 'Salmon Logo',
      description: undefined,
      image: undefined,
      collectionName: undefined,
      hasCollection: false,
      attributes: undefined,
      metadataResolved: false,
    };

    test('does not emit barebones_nft when the metadata could not be fetched', () => {
      const result = score(unresolved);
      expect(result.spamReasons).not.toContain('barebones_nft');
      expect(result.spamScore).toBe(0);
    });

    test('name-based heuristics still fire on unresolved metadata', () => {
      const result = score({ ...unresolved, name: 'MAGICEDEN.LOL REWARD' });
      expect(result.spamReasons).toContain('domain_in_name');
      expect(result.spamReasons).not.toContain('barebones_nft');
    });
  });

  // A real phishing NFT held by a Salmon test wallet. Every character of its
  // name and description is separated by a zero-width space (193 of them), which
  // is what let it score 0 and sit in the collectibles tab looking legitimate:
  // `.lol`, the domain, and every keyword were unmatchable as literals.
  describe('invisible-character evasion', () => {
    const ZWSP = '​';
    const pad = (text) => text.split('').join(ZWSP);

    const jup = {
      name: pad('JUP'),
      description: pad(
        "🎁 Congratulations! You've been selected for an exclusive JUP reward drop. " +
          '💰 Your Allocation: 2,500 $JUP tokens ' +
          '⏰ Claim within 48 hours or forfeit your spot ' +
          '✅ Verify & claim now:jupbonus.lol'
      ),
      image: 'https://ipfs.io/ipfs/QmSgLW',
      hasCollection: true,
      attributes: [],
      metadataResolved: true,
    };

    test('the padded phishing NFT no longer scores zero', () => {
      const result = score(jup);
      expect(result.spamScore).toBeGreaterThan(0);
    });

    test('normalization exposes the phishing description the padding was hiding', () => {
      expect(score(jup).spamReasons).toContain('phishing_description');
    });

    test('the padding itself is flagged', () => {
      expect(score(jup).spamReasons).toContain('hidden_char_obfuscation');
    });

    test('stripping the padding does not save it — the keywords are then plain', () => {
      const unpadded = {
        ...jup,
        name: 'JUP',
        description: '✅ Verify & claim now:jupbonus.lol',
      };
      const result = score(unpadded);
      expect(result.spamReasons).toContain('phishing_description');
      expect(result.spamReasons).not.toContain('hidden_char_obfuscation');
      expect(result.spamScore).toBeGreaterThan(0);
    });

    test('padding also unmasks a domain hidden in the name', () => {
      const result = score({
        ...jup,
        name: pad('MAGICEDEN.LOL REWARD'),
        description: undefined,
        metadataResolved: true,
      });
      expect(result.spamReasons).toContain('domain_in_name');
    });

    test('fullwidth homoglyphs are folded before matching', () => {
      const result = score({
        name: 'ＪＵＰ．ＬＯＬ',
        description: undefined,
        image: 'https://arweave.net/x.png',
        hasCollection: true,
        metadataResolved: true,
      });
      expect(result.spamReasons).toContain('domain_in_name');
    });

    // Emoji ZWJ sequences and Persian/Arabic ZWNJ are legitimate uses of
    // zero-width characters. Flagging them would hide real NFTs.
    test('an emoji ZWJ sequence is not treated as obfuscation', () => {
      const result = score({
        ...baseClean,
        name: 'Family 👨‍👩‍👧‍👦 #1',
      });
      expect(result.spamReasons).toEqual(['emoji_in_name']);
      expect(isSpamScore(result.spamScore)).toBe(false);
    });

    test('a clean NFT survives normalization untouched', () => {
      expect(score(baseClean)).toEqual({ spamScore: 0, spamReasons: [] });
    });
  });
});
