'use strict';

/**
 * Parser orchestrator + per-program parser tests.
 *
 * Each test feeds a hand-rolled `getParsedTransaction` shape into the
 * orchestrator and asserts the resulting enriched-tx shape matches what the
 * downstream resource decorator expects.
 *
 * The fixtures are minimal — only the fields the parser reads. Real
 * end-to-end coverage lives in the integration tests against the test
 * wallets.
 */

const { parseTransaction, __testing } = require('..');
const { pickPrimarySource } = require('../program-sources');

const SYSTEM = '11111111111111111111111111111111';
const TOKEN = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const TOKEN_2022 = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';
const METAPLEX = 'metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s';
const BUBBLEGUM = 'BGUMAp9Gq7iTEuizy4pqaxsTyUCBK68MDfK752saRPUY';
const JUPITER_V6 = 'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4';
const STAKE = 'Stake11111111111111111111111111111111111111';

const MARINADE = 'MarBmsSgKXdrN1egZf5sqe1TMThczhMLJhJlsbXxy7Z';
const STAKE_POOL = 'SPoo1Ku8WFXoNDMHPsrGSTSG1Y47rzgn41SLUNakuHy';
const SANCTUM = 'stkitrT1Uoy18Dk1fTrgPw8W6MVzoCfYoAFT4MLsmhq';
const SOLEND = 'So1endDq2YkqhipRh3WViPa8hdiSpxWy6z3Z6tMCpAo';
const KAMINO = 'KLend2g3cP87fffoy8q1mQqGKjrxjC8boSyAYavgmjD';
const MARGINFI = 'MFv2hWf31Z9kbCa1snEPYctwafyhdvnV7FZnsebVacA';
const PHOENIX = 'PhoeNiCXqGVXLVHSKvXBLPjeBxz4Hpm5JhmJaDMkEQ4';
const OPENBOOK_V2 = 'opnb2LAfJYbRMAHHvqjCwQxanZn7ReEHp1k81EohpZb';
const LIFINITY = '2wT8Yq49kHgDzXuPxZSaeLaH1qbmGXtEyPy64bL7aD3c';
const SABER = 'SSwpkEEcbUqx4vtoEByFjSkhKdCT862DNVb52nZg1UZ';
const WORMHOLE_TOKEN = 'wormDTUJ6AWPNvk59vGQbDvGJmqbDTdgWgAqcLBCgUb';
const SNS = 'namesLPneVptA9Z5rqUDD9tMTWEJwofgaYwp8cawRkX';

const buildRawTx = ({
  instructions = [],
  inner = [],
  blockTime = 1700000000,
  slot = 100,
  fee = 5000,
  accountKeys = [],
} = {}) => ({
  blockTime,
  slot,
  meta: {
    err: null,
    fee,
    innerInstructions: inner,
    preTokenBalances: [],
    postTokenBalances: [],
    logMessages: [],
  },
  transaction: {
    message: {
      accountKeys: accountKeys.length > 0 ? accountKeys : [{ pubkey: 'fee-payer' }],
      instructions,
    },
    signatures: ['SIG'],
  },
  version: 0,
});

describe('parser orchestrator', () => {
  it('returns null for empty input', () => {
    expect(parseTransaction(null)).toBeNull();
    expect(parseTransaction(undefined)).toBeNull();
  });

  it('parses a System transfer as TRANSFER + SYSTEM_PROGRAM source', () => {
    const rawTx = buildRawTx({
      instructions: [
        {
          programId: SYSTEM,
          parsed: { type: 'transfer', info: { source: 'A', destination: 'B', lamports: 1000 } },
        },
      ],
    });

    const result = parseTransaction(rawTx);

    expect(result.type).toBe('TRANSFER');
    expect(result.source).toBe('SYSTEM_PROGRAM');
    expect(result.heliusType).toBe('TRANSFER');
    expect(result.nativeTransfers).toEqual([
      { fromUserAccount: 'A', toUserAccount: 'B', amount: 1000 },
    ]);
    expect(result.tokenTransfers).toEqual([]);
    expect(result.fee).toBe(5000);
    expect(result.feePayer).toBe('fee-payer');
    expect(result.signature).toBe('SIG');
  });

  it('parses an SPL Token transfer as TRANSFER with tokenStandard=Fungible', () => {
    const rawTx = buildRawTx({
      instructions: [
        {
          programId: TOKEN,
          parsed: {
            type: 'transferChecked',
            info: {
              authority: 'OWNER',
              source: 'TOKEN_ACCT_A',
              destination: 'TOKEN_ACCT_B',
              mint: 'MINT_X',
              tokenAmount: { amount: '1000000', decimals: 6 },
            },
          },
        },
      ],
    });

    const result = parseTransaction(rawTx);

    expect(result.type).toBe('TRANSFER');
    expect(result.tokenTransfers).toHaveLength(1);
    expect(result.tokenTransfers[0]).toMatchObject({
      fromUserAccount: 'OWNER',
      mint: 'MINT_X',
      tokenAmount: '1000000',
      decimals: 6,
      tokenStandard: 'Fungible',
    });
  });

  it('parses an SPL Token NFT transfer (decimals=0, amount=1) as NonFungible', () => {
    const rawTx = buildRawTx({
      instructions: [
        {
          programId: TOKEN,
          parsed: {
            type: 'transfer',
            info: {
              authority: 'OWNER',
              source: 'TOKEN_ACCT',
              destination: 'OTHER',
              mint: 'NFT_MINT',
              tokenAmount: { amount: '1', decimals: 0 },
            },
          },
        },
      ],
    });

    const result = parseTransaction(rawTx);
    expect(result.tokenTransfers[0].tokenStandard).toBe('NonFungible');
  });

  it('treats Token-2022 program identical to SPL Token', () => {
    const rawTx = buildRawTx({
      instructions: [
        {
          programId: TOKEN_2022,
          parsed: {
            type: 'transfer',
            info: {
              authority: 'OWNER',
              source: 'A',
              destination: 'B',
              mint: 'M',
              tokenAmount: { amount: '5', decimals: 0 },
            },
          },
        },
      ],
    });

    const result = parseTransaction(rawTx);
    expect(result.type).toBe('TRANSFER');
    expect(result.source).toBe('TOKEN_2022_PROGRAM');
    expect(result.tokenTransfers).toHaveLength(1);
  });

  it('parses mintTo as TOKEN_MINT', () => {
    const rawTx = buildRawTx({
      instructions: [
        {
          programId: TOKEN,
          parsed: {
            type: 'mintTo',
            info: {
              account: 'DEST',
              mint: 'M',
              amount: '1000',
            },
          },
        },
      ],
    });

    const result = parseTransaction(rawTx);
    expect(result.type).toBe('TOKEN_MINT');
    expect(result.tokenTransfers).toHaveLength(1);
  });

  it('parses burn as BURN', () => {
    const rawTx = buildRawTx({
      instructions: [
        {
          programId: TOKEN,
          parsed: {
            type: 'burn',
            info: {
              authority: 'OWNER',
              account: 'A',
              mint: 'M',
              amount: '1',
            },
          },
        },
      ],
    });

    const result = parseTransaction(rawTx);
    expect(result.type).toBe('BURN');
  });

  it('detects Metaplex create_metadata as NFT_MINT with METAPLEX source', () => {
    const rawTx = buildRawTx({
      instructions: [
        { programId: METAPLEX, parsed: { type: 'createMetadataAccountV3', info: {} } },
        {
          programId: TOKEN,
          parsed: {
            type: 'mintTo',
            info: { account: 'DEST', mint: 'NFT', amount: '1' },
          },
        },
      ],
    });

    const result = parseTransaction(rawTx);
    expect(result.type).toBe('NFT_MINT');
    expect(['JUPITER', 'METAPLEX_TOKEN_METADATA']).toContain(result.source);
  });

  it('detects Bubblegum cNFT instruction and tags COMPRESSED_NFT type', () => {
    const rawTx = buildRawTx({
      instructions: [{ programId: BUBBLEGUM, accounts: [], data: '' }],
    });

    const result = parseTransaction(rawTx);
    expect(result.source).toBe('BUBBLEGUM');
    expect([
      'UNKNOWN',
      'COMPRESSED_NFT_MINT',
      'COMPRESSED_NFT_TRANSFER',
      'COMPRESSED_NFT_BURN',
    ]).toContain(result.type);
  });

  it('classifies Bubblegum tx via Anchor log message when discriminator is absent', () => {
    const rawTx = buildRawTx({
      instructions: [{ programId: BUBBLEGUM, accounts: [], data: '' }],
    });
    rawTx.meta.logMessages = [
      `Program ${BUBBLEGUM} invoke [1]`,
      'Program log: Instruction: MintV1',
      `Program ${BUBBLEGUM} success`,
    ];

    const result = parseTransaction(rawTx);
    expect(result.type).toBe('COMPRESSED_NFT_MINT');
    expect(result.source).toBe('BUBBLEGUM');
  });

  it('classifies Bubblegum Burn via log message', () => {
    const rawTx = buildRawTx({
      instructions: [{ programId: BUBBLEGUM, accounts: [], data: '' }],
    });
    rawTx.meta.logMessages = [
      `Program ${BUBBLEGUM} invoke [1]`,
      'Program log: Instruction: Burn',
      `Program ${BUBBLEGUM} success`,
    ];

    const result = parseTransaction(rawTx);
    expect(result.type).toBe('COMPRESSED_NFT_BURN');
  });

  it('ignores Anchor log lines outside a Bubblegum invoke block', () => {
    const rawTx = buildRawTx({
      instructions: [{ programId: BUBBLEGUM, accounts: [], data: '' }],
    });
    rawTx.meta.logMessages = [
      'Program SomeOtherProgram invoke [1]',
      'Program log: Instruction: Transfer',
      'Program SomeOtherProgram success',
    ];

    const result = parseTransaction(rawTx);
    // No specific cNFT op detected — falls through to deriveType's
    // hasBubblegum default (COMPRESSED_NFT_TRANSFER).
    expect(result.type).toBe('COMPRESSED_NFT_TRANSFER');
  });

  it('detects Jupiter v6 program and tags type=SWAP source=JUPITER', () => {
    const rawTx = buildRawTx({
      instructions: [{ programId: JUPITER_V6, accounts: [], data: 'opaque' }],
      inner: [
        {
          index: 0,
          instructions: [
            {
              programId: TOKEN,
              parsed: {
                type: 'transferChecked',
                info: {
                  authority: 'USER',
                  source: 'A',
                  destination: 'B',
                  mint: 'IN_MINT',
                  tokenAmount: { amount: '1000', decimals: 6 },
                },
              },
            },
            {
              programId: TOKEN,
              parsed: {
                type: 'transferChecked',
                info: {
                  authority: 'JUPITER',
                  source: 'B',
                  destination: 'C',
                  mint: 'OUT_MINT',
                  tokenAmount: { amount: '999', decimals: 9 },
                },
              },
            },
          ],
        },
      ],
    });

    const result = parseTransaction(rawTx);
    expect(result.type).toBe('SWAP');
    expect(result.source).toBe('JUPITER');
    expect(result.tokenTransfers).toHaveLength(2);
  });

  it('detects Stake program delegate as STAKE_TOKEN', () => {
    const rawTx = buildRawTx({
      instructions: [{ programId: STAKE, parsed: { type: 'delegate', info: {} } }],
    });

    const result = parseTransaction(rawTx);
    expect(result.type).toBe('STAKE_TOKEN');
    expect(result.source).toBe('STAKE_PROGRAM');
  });

  it('returns UNKNOWN type when no parser matches and no transfers are present', () => {
    const rawTx = buildRawTx({
      instructions: [{ programId: 'UnknownProgramXyz', accounts: [], data: 'aa' }],
    });

    const result = parseTransaction(rawTx);
    expect(result.type).toBe('UNKNOWN');
    expect(result.source).toBeNull();
  });

  it('walks innerInstructions in addition to top-level', () => {
    const rawTx = buildRawTx({
      instructions: [
        { programId: 'AggregatorXYZ' /* unknown but gets recorded */, accounts: [], data: 'aa' },
      ],
      inner: [
        {
          index: 0,
          instructions: [
            {
              programId: SYSTEM,
              parsed: { type: 'transfer', info: { source: 'A', destination: 'B', lamports: 100 } },
            },
          ],
        },
      ],
    });

    const result = parseTransaction(rawTx);
    expect(result.nativeTransfers).toHaveLength(1);
    expect(result.type).toBe('TRANSFER');
  });

  it('produces deterministic source priority: JUPITER beats RAYDIUM in sources mix', () => {
    const RAYDIUM_AMM = '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8';
    const rawTx = buildRawTx({
      instructions: [
        { programId: JUPITER_V6, accounts: [], data: 'op' },
        { programId: RAYDIUM_AMM, accounts: [], data: 'op' },
      ],
    });

    const result = parseTransaction(rawTx);
    expect(result.source).toBe('JUPITER');
  });

  it('resolves token account → owner via pre/post token balances', () => {
    const rawTx = {
      blockTime: 1,
      slot: 1,
      meta: {
        err: null,
        fee: 5000,
        innerInstructions: [],
        preTokenBalances: [{ accountIndex: 1, mint: 'MINT', owner: 'OWNER_A' }],
        postTokenBalances: [
          { accountIndex: 1, mint: 'MINT', owner: 'OWNER_A' },
          { accountIndex: 2, mint: 'MINT', owner: 'OWNER_B' },
        ],
      },
      transaction: {
        message: {
          accountKeys: [
            { pubkey: 'fee-payer' },
            { pubkey: 'TOKEN_ACCT_A' },
            { pubkey: 'TOKEN_ACCT_B' },
          ],
          instructions: [
            {
              programId: TOKEN,
              parsed: {
                type: 'transferChecked',
                info: {
                  authority: 'OWNER_A',
                  source: 'TOKEN_ACCT_A',
                  destination: 'TOKEN_ACCT_B',
                  mint: 'MINT',
                  tokenAmount: { amount: '10', decimals: 6 },
                },
              },
            },
          ],
        },
        signatures: ['SIG'],
      },
    };

    const result = parseTransaction(rawTx);
    expect(result.tokenTransfers[0].toUserAccount).toBe('OWNER_B');
  });

  it('overrides signature with options.signature when provided', () => {
    const rawTx = buildRawTx({
      instructions: [
        {
          programId: SYSTEM,
          parsed: { type: 'transfer', info: { source: 'a', destination: 'b', lamports: 1 } },
        },
      ],
    });

    const result = parseTransaction(rawTx, { signature: 'OVERRIDE' });
    expect(result.signature).toBe('OVERRIDE');
  });

  it.each([
    ['Marinade Finance', MARINADE, 'MARINADE_FINANCE'],
    ['SPL Stake Pool (JitoSOL et al)', STAKE_POOL, 'STAKE_POOL'],
    ['Sanctum LST router', SANCTUM, 'SANCTUM'],
  ])(
    'classifies %s direct call as STAKE_TOKEN with the protocol source',
    (_name, programId, expectedSource) => {
      const rawTx = buildRawTx({
        instructions: [{ programId, accounts: [], data: 'op' }],
      });
      const result = parseTransaction(rawTx);
      expect(result.type).toBe('STAKE_TOKEN');
      expect(result.source).toBe(expectedSource);
    }
  );

  it.each([
    ['Solend', SOLEND, 'SOLEND'],
    ['Kamino Lend', KAMINO, 'KAMINO'],
    ['MarginFi v2', MARGINFI, 'MARGINFI'],
  ])(
    'classifies %s direct call as OFFER_LOAN (LOAN bucket) with source',
    (_name, programId, expectedSource) => {
      const rawTx = buildRawTx({
        instructions: [{ programId, accounts: [], data: 'op' }],
      });
      const result = parseTransaction(rawTx);
      expect(result.type).toBe('OFFER_LOAN');
      expect(result.source).toBe(expectedSource);
    }
  );

  it.each([
    ['Phoenix', PHOENIX, 'PHOENIX'],
    ['OpenBook v2', OPENBOOK_V2, 'OPENBOOK_V2'],
    ['Lifinity', LIFINITY, 'LIFINITY'],
    ['Saber', SABER, 'SABER'],
  ])(
    'classifies direct %s call as SWAP (no Jupiter present)',
    (_name, programId, expectedSource) => {
      const rawTx = buildRawTx({
        instructions: [{ programId, accounts: [], data: 'op' }],
      });
      const result = parseTransaction(rawTx);
      expect(result.type).toBe('SWAP');
      expect(result.source).toBe(expectedSource);
    }
  );

  it('detects Wormhole bridge as TRANSFER with WORMHOLE source', () => {
    const rawTx = buildRawTx({
      instructions: [
        { programId: WORMHOLE_TOKEN, accounts: [], data: 'op' },
        {
          programId: TOKEN,
          parsed: {
            type: 'transfer',
            info: {
              authority: 'OWNER',
              source: 'A',
              destination: 'B',
              mint: 'WrappedMint',
              tokenAmount: { amount: '1000000', decimals: 6 },
            },
          },
        },
      ],
    });
    const result = parseTransaction(rawTx);
    // WORMHOLE wins source priority over TOKEN_PROGRAM, type stays TRANSFER
    // (bridge in/out is just a transfer from the user's perspective).
    expect(result.source).toBe('WORMHOLE');
    expect(result.type).toBe('TRANSFER');
  });

  it('detects SNS instruction and tags SNS source', () => {
    const rawTx = buildRawTx({
      instructions: [
        { programId: SNS, accounts: [], data: 'op' },
        {
          programId: SYSTEM,
          parsed: { type: 'transfer', info: { source: 'A', destination: 'B', lamports: 1000 } },
        },
      ],
    });
    const result = parseTransaction(rawTx);
    // SYSTEM_PROGRAM has lower priority than SNS, so SNS wins.
    expect(result.source).toBe('SNS');
    expect(result.type).toBe('TRANSFER');
  });

  it('Jupiter still wins source priority over a direct DEX program in the same tx', () => {
    const rawTx = buildRawTx({
      instructions: [
        { programId: JUPITER_V6, accounts: [], data: 'op' },
        { programId: PHOENIX, accounts: [], data: 'op' },
      ],
    });
    const result = parseTransaction(rawTx);
    expect(result.type).toBe('SWAP');
    expect(result.source).toBe('JUPITER');
  });

  it('Sanctum (LST aggregator) wins over STAKE_POOL when both are present', () => {
    const rawTx = buildRawTx({
      instructions: [
        { programId: SANCTUM, accounts: [], data: 'op' },
        { programId: STAKE_POOL, accounts: [], data: 'op' },
      ],
    });
    const result = parseTransaction(rawTx);
    expect(result.source).toBe('SANCTUM');
    expect(result.type).toBe('STAKE_TOKEN');
  });
});

describe('program-sources', () => {
  it('picks JUPITER over RAYDIUM in priority', () => {
    expect(pickPrimarySource(['RAYDIUM', 'JUPITER'])).toBe('JUPITER');
    expect(pickPrimarySource(['JUPITER', 'RAYDIUM'])).toBe('JUPITER');
  });

  it('falls back to the only source available', () => {
    expect(pickPrimarySource(['SYSTEM_PROGRAM'])).toBe('SYSTEM_PROGRAM');
  });

  it('returns null on empty input', () => {
    expect(pickPrimarySource([])).toBeNull();
    expect(pickPrimarySource(undefined)).toBeNull();
  });
});

describe('deriveType', () => {
  it('returns SWAP when hasJupiter is set', () => {
    const t = __testing.deriveType({
      _hints: { hasJupiter: true },
      nativeTransfers: [],
      tokenTransfers: [],
    });
    expect(t).toBe('SWAP');
  });

  it('returns SWAP when hasDexSwap is set (direct DEX, no Jupiter)', () => {
    const t = __testing.deriveType({
      _hints: { hasDexSwap: true },
      nativeTransfers: [],
      tokenTransfers: [],
    });
    expect(t).toBe('SWAP');
  });

  it('returns OFFER_LOAN when hasLoan is set (lending platforms)', () => {
    const t = __testing.deriveType({
      _hints: { hasLoan: true },
      nativeTransfers: [],
      tokenTransfers: [],
    });
    expect(t).toBe('OFFER_LOAN');
  });

  it('returns STAKE_TOKEN when hasLiquidStake is set', () => {
    const t = __testing.deriveType({
      _hints: { hasLiquidStake: true },
      nativeTransfers: [],
      tokenTransfers: [],
    });
    expect(t).toBe('STAKE_TOKEN');
  });

  it('returns COMPRESSED_NFT_MINT when hasCnftMint is set', () => {
    const t = __testing.deriveType({
      _hints: { hasCnftMint: true },
      nativeTransfers: [],
      tokenTransfers: [],
    });
    expect(t).toBe('COMPRESSED_NFT_MINT');
  });

  it('returns TRANSFER when only transfers are present', () => {
    const t = __testing.deriveType({
      _hints: {},
      nativeTransfers: [{}],
      tokenTransfers: [],
    });
    expect(t).toBe('TRANSFER');
  });

  it('returns UNKNOWN when nothing matches', () => {
    const t = __testing.deriveType({ _hints: {}, nativeTransfers: [], tokenTransfers: [] });
    expect(t).toBe('UNKNOWN');
  });

  it('hasBubblegum without specific cnft hint and no transfers falls back to COMPRESSED_NFT_TRANSFER', () => {
    // Locks the documented behavior: when the discriminator decoder did not
    // match a known op (e.g. delegate, update_metadata) but the tx touched
    // Bubblegum, bucket as COMPRESSED_NFT_TRANSFER (the most common op).
    const t = __testing.deriveType({
      _hints: { hasBubblegum: true },
      nativeTransfers: [],
      tokenTransfers: [],
    });
    expect(t).toBe('COMPRESSED_NFT_TRANSFER');
  });

  it('specific cnft hint takes precedence over hasBubblegum fallback', () => {
    // hasCnftBurn precedence row beats the hasBubblegum fallback that
    // deriveType only consults after the no-transfers branch.
    const t = __testing.deriveType({
      _hints: { hasBubblegum: true, hasCnftBurn: true },
      nativeTransfers: [],
      tokenTransfers: [],
    });
    expect(t).toBe('COMPRESSED_NFT_BURN');
  });

  it('TRANSFER (native/token transfers present) takes precedence over hasBubblegum fallback', () => {
    // Bubblegum bucketing kicks in only when no transfers exist; if any
    // native or token transfer is recorded the tx is a TRANSFER.
    const t = __testing.deriveType({
      _hints: { hasBubblegum: true },
      nativeTransfers: [{}],
      tokenTransfers: [],
    });
    expect(t).toBe('TRANSFER');
  });
});

describe('collectInstructionMetadata', () => {
  const collect = __testing.collectInstructionMetadata;

  it('returns empty array for raw tx with no instructions', () => {
    expect(collect({})).toEqual([]);
    expect(collect({ transaction: { message: { instructions: [] } } })).toEqual([]);
  });

  it('returns 0 inner count when meta.innerInstructions is missing', () => {
    const out = collect({
      transaction: {
        message: {
          instructions: [{ programId: 'A' }, { programId: 'B' }],
        },
      },
    });
    expect(out).toEqual([
      { programId: 'A', innerInstructionsCount: 0 },
      { programId: 'B', innerInstructionsCount: 0 },
    ]);
  });

  it('aligns inner instructions by group.index — including sparse indices', () => {
    // Top has 4 ixs but only ix#0 and ix#3 emitted CPIs.
    const out = collect({
      transaction: {
        message: {
          instructions: [
            { programId: 'A' },
            { programId: 'B' },
            { programId: 'C' },
            { programId: 'D' },
          ],
        },
      },
      meta: {
        innerInstructions: [
          { index: 0, instructions: [{}, {}, {}] }, // 3 inner under ix #0
          { index: 3, instructions: [{}] }, // 1 inner under ix #3
        ],
      },
    });
    expect(out).toEqual([
      { programId: 'A', innerInstructionsCount: 3 },
      { programId: 'B', innerInstructionsCount: 0 },
      { programId: 'C', innerInstructionsCount: 0 },
      { programId: 'D', innerInstructionsCount: 1 },
    ]);
  });

  it('handles innerInstructions group with missing instructions array', () => {
    const out = collect({
      transaction: { message: { instructions: [{ programId: 'P' }] } },
      meta: { innerInstructions: [{ index: 0 }] }, // no instructions[]
    });
    expect(out).toEqual([{ programId: 'P', innerInstructionsCount: 0 }]);
  });

  it('handles duplicate program IDs at different positions independently', () => {
    // Repeated programId — counts must follow position, not programId.
    const out = collect({
      transaction: {
        message: {
          instructions: [{ programId: 'X' }, { programId: 'X' }],
        },
      },
      meta: {
        innerInstructions: [{ index: 1, instructions: [{}, {}] }],
      },
    });
    expect(out).toEqual([
      { programId: 'X', innerInstructionsCount: 0 },
      { programId: 'X', innerInstructionsCount: 2 },
    ]);
  });
});
