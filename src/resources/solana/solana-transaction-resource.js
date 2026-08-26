'use strict';

const {
  SEND,
  RECEIVE,
  SWAP,
  INTERACTION,
  UNKNOWN,
  MINT,
} = require('../../constants/transaction-types');
const {
  SOL_NAME,
  SOL_SYMBOL,
  SOL_DECIMALS,
  SOL_ADDRESS,
  SOL_LOGO,
} = require('../../constants/solana-constants');

const {
  JUPITER_PROGRAM_IDS,
  JUPITER_LIMIT_PROGRAM_IDS,
  BUBBLEGUM_PROGRAM_ID,
} = require('../../constants/solana-program-ids');
const { normalizeIpfsUrl } = require('./content-urls');

const PROGRAMS = {
  JUPITER: [...JUPITER_PROGRAM_IDS, ...JUPITER_LIMIT_PROGRAM_IDS],
  BUBBLEGUM: BUBBLEGUM_PROGRAM_ID,
};

const TRANSFER_TYPES = ['transfer', 'transferChecked'];
const INTERACTION_TYPES = ['getAccountDataSize', 'createAccount', 'closeAccount', 'create'];

/** Returns the SOL fee object when `address` is the first signer, else `undefined`. */
const getFee = (address, meta, transaction) => {
  if (meta?.fee) {
    const signers = transaction?.message?.accountKeys
      ?.filter(({ signer }) => signer)
      ?.map(({ pubkey }) => pubkey.toBase58());

    if (signers?.[0] === address) {
      return { amount: meta.fee, decimals: SOL_DECIMALS, symbol: SOL_SYMBOL };
    }
  }
  return undefined;
};

/** Returns the source pubkey from the first transfer-style instruction. */
const getSource = (transaction) => {
  const { instructions } = transaction?.message || {};

  return (
    instructions?.[0]?.parsed?.info?.authority ||
    instructions?.[0]?.parsed?.info?.source ||
    instructions?.[1]?.parsed?.info?.source
  );
};

/** Returns the destination pubkey of the first transfer instruction (or first instruction with a destination). */
const getDestination = (transaction) => {
  const { instructions } = transaction?.message || {};

  return [
    instructions?.filter((ins) => ins?.parsed?.type === 'transfer')?.[0],
    instructions?.[0],
    instructions?.[1],
    instructions?.[2],
  ]
    .map((instruction) => instruction?.parsed?.info?.destination)
    .filter(Boolean)?.[0];
};

/** Strips the internal `_source` flag from an already-enriched tx payload before returning. */
const cleanHeliusTransaction = (transactionInfo) => {
  const cleanTransaction = { ...transactionInfo };
  delete cleanTransaction._source;
  return cleanTransaction;
};

/** Assembles the bare-RPC fallback resource: id, timestamp, status, fee, type, inputs, outputs. */
const buildResource = async (transactionInfo, context) => {
  const { address, signature, blockTime, meta, transaction } = transactionInfo;
  const source = getSource(transaction);
  const destination = getDestination(transaction);
  const nft = getNft(signature, context);
  const type = getType(address, meta, transaction, destination);

  return {
    id: signature,
    timestamp: blockTime,
    status: meta?.err ? 'failed' : 'completed',
    fee: getFee(address, meta, transaction),
    type,
    inputs: await getInputs(address, type, meta, transaction, source, destination, nft, context),
    outputs: await getOutputs(address, type, meta, transaction, source, destination, nft, context),
  };
};

/** Classifies the tx as `SWAP` | `MINT` | `RECEIVE` | `SEND` | `INTERACTION` | `UNKNOWN`. */
const getType = (address, meta, transaction, destination) => {
  const logMessages = meta?.logMessages || [];
  const instructions = transaction?.message?.instructions || [];
  const innerInstructions = meta?.innerInstructions?.flatMap((inner) => inner.instructions) || [];

  // Helper: Check if log messages contain a specific program ID
  const containsProgramInLogs = (programId) => logMessages.some((msg) => msg.includes(programId));

  // 1. Check for SWAP
  if (
    containsProgramInLogs('SetTokenLedger') ||
    instructions.some(({ programId }) => PROGRAMS.JUPITER.includes(programId?.toString()))
  ) {
    return SWAP;
  }

  // 2. Check for MINT
  if (containsProgramInLogs(PROGRAMS.BUBBLEGUM)) {
    return MINT;
  }

  // Combine all instructions (transaction + inner)
  const allInstructions = [...instructions, ...innerInstructions];
  const types = allInstructions.map((instruction) => instruction?.parsed?.type).filter(Boolean);

  // 3. Check for TRANSFER
  if (TRANSFER_TYPES.some((t) => types.includes(t))) {
    return destination === address ? RECEIVE : SEND;
  }

  // 4. Check for INTERACTION
  if (INTERACTION_TYPES.some((t) => types.includes(t))) {
    return INTERACTION;
  }

  // 5. Default to UNKNOWN
  return UNKNOWN;
};

/**
 * Returns the preloaded NFT for this tx (if any) from
 * `context.locals.rpcNftBySignature` — populated by the service-layer
 * `solana-rpc-enrichment` loader. Only NFTs with collection metadata count.
 */
const getNft = (signature, context) => {
  const nft = context.locals.rpcNftBySignature?.[signature];
  return nft?.json?.collection ? nft : undefined;
};

/** Returns the `parsed.info` payloads for inner instructions at `meta.innerInstructions[index]`. */
const getParsedInstructionInfos = (meta, index = -1) => {
  return meta?.innerInstructions
    ?.at(index)
    ?.instructions?.map(({ parsed }) => parsed)
    ?.filter(Boolean)
    ?.map(({ info }) => info);
};

/** Returns the mint of the parsed instruction whose destination is one of the user's token accounts (falls back to the last instruction). */
const getMatchedMint = (parsedInstructions, tokenAccounts) => {
  return (
    parsedInstructions?.filter((info) => tokenAccounts?.includes(info?.destination))?.[0] ||
    parsedInstructions?.at(-1) ||
    {}
  ).mint;
};

/** Returns the lamport amount transferred by the first system-program instruction (or first inner instruction). */
const getLamports = (transaction, meta) => {
  return (
    transaction?.message?.instructions[1]?.parsed?.info?.lamports ||
    transaction?.message?.instructions[0]?.parsed?.info?.lamports ||
    meta?.innerInstructions?.[0]?.instructions?.[0]?.parsed?.info?.lamports
  );
};

/** Builds an NFT transfer leg (`amount: 1, decimals: 0`) tagged with `directionField → directionValue`. */
const buildNftTransfer = (nft, directionField, directionValue) => ({
  amount: 1,
  decimals: 0,
  symbol: nft.symbol,
  name: nft.json.collection?.name,
  logo: normalizeIpfsUrl(nft.json.image),
  contract: nft.mint?.address?.toBase58(),
  [directionField]: directionValue,
});

/** Builds a native SOL transfer leg in lamports tagged with `directionField → directionValue`. */
const buildNativeTransfer = (amount, directionField, directionValue) => ({
  amount,
  decimals: SOL_DECIMALS,
  symbol: SOL_SYMBOL,
  name: SOL_NAME,
  logo: SOL_LOGO,
  contract: SOL_ADDRESS,
  [directionField]: directionValue,
});

/** Builds an SPL-token transfer leg from a `transferToken` metadata record tagged with `directionField → directionValue`. */
const buildTokenTransfer = (transferToken, amount, directionField, directionValue) => {
  const { symbol, name, decimals, logoURI: logo, address: contract } = transferToken;

  return {
    amount,
    decimals,
    symbol,
    name,
    logo: normalizeIpfsUrl(logo),
    contract,
    [directionField]: directionValue,
  };
};

/** Looks up a token in `context.locals.tokens` by mint, falling back to a token-account address. */
const getTransferToken = async (fallbackAddress, mint, context) => {
  const { tokens } = context.locals;
  return tokens?.find((token) => token.address === mint || token.address === fallbackAddress);
};

/** Returns the input leg(s) of a SWAP — the token credited to one of the user's token accounts (or the last parsed instruction as fallback). */
const getSwapInputs = async (meta, source, context) => {
  const parsedInstructions = getParsedInstructionInfos(meta);
  const { tokenAccounts } = context.locals;
  const {
    destination: tokenAddress,
    mint,
    amount,
  } = parsedInstructions?.filter((info) => tokenAccounts?.includes(info?.destination))?.[0] ||
  parsedInstructions?.at(-1) ||
  {};

  const { tokens } = context.locals;
  const {
    address: contract,
    symbol,
    name,
    decimals,
    logoURI,
  } = tokens?.find((token) => token.address === tokenAddress || token.address === mint) || {};

  return [
    {
      amount,
      decimals,
      symbol,
      name,
      logo: normalizeIpfsUrl(logoURI),
      contract,
      source,
    },
  ];
};

/** Returns the input leg(s) of a RECEIVE — NFT, SPL token (using `postTokenBalances`), or native SOL lamports. */
const getReceiveInputs = async (address, meta, transaction, source, destination, nft, context) => {
  if (nft) {
    return [buildNftTransfer(nft, 'source', source)];
  }

  const parsedInstructions = getParsedInstructionInfos(meta);
  const { tokenAccounts } = context.locals;
  const mint = getMatchedMint(parsedInstructions, tokenAccounts);
  const transferToken = await getTransferToken(destination, mint, context);

  if (transferToken) {
    const transferAmount = meta?.postTokenBalances?.filter(({ owner }) => owner === address)?.[0]
      ?.uiTokenAmount;

    if (transferAmount) {
      return [buildTokenTransfer(transferToken, transferAmount.amount, 'source', source)];
    }
  }

  const lamports = getLamports(transaction, meta);
  return lamports ? [buildNativeTransfer(lamports, 'source', source)] : [];
};

/** Dispatches to `getSwapInputs` / `getReceiveInputs` based on `type`, or returns `[]` for SEND/INTERACTION/UNKNOWN/MINT. */
const getInputs = async (address, type, meta, transaction, source, destination, nft, context) => {
  if (type === SWAP) {
    return getSwapInputs(meta, source, context);
  }

  if (type === RECEIVE) {
    return getReceiveInputs(address, meta, transaction, source, destination, nft, context);
  }

  return [];
};

/** Returns the output leg(s) of a SWAP — the token authority-debited from `address`, taken from one of the last two inner-instruction groups. */
const getSwapOutputs = async (address, meta, destination, context) => {
  const {
    destination: tokenAddress,
    mint,
    amount,
  } = meta.innerInstructions
    ?.at(-2)
    ?.instructions?.find(({ parsed }) => parsed?.info?.authority === address)?.parsed?.info ||
  meta.innerInstructions
    ?.at(-1)
    ?.instructions?.find(({ parsed }) => parsed?.info?.authority === address)?.parsed?.info ||
  {};

  const { tokens } = context.locals;
  const {
    address: contract,
    symbol,
    decimals,
    logoURI,
  } = tokens?.find((token) => token.address === tokenAddress || token.address === mint) || {};

  return [
    {
      amount,
      decimals,
      symbol,
      logo: normalizeIpfsUrl(logoURI),
      contract,
      destination,
    },
  ];
};

/** Returns the output leg(s) of a SEND — NFT, SPL token (using `preTokenBalances`), or native SOL lamports. */
const getSendOutputs = async (address, meta, transaction, destination, nft, context) => {
  if (nft) {
    return [buildNftTransfer(nft, 'destination', destination)];
  }

  const parsedInstructions = getParsedInstructionInfos(meta);
  const { tokenAccounts } = context.locals;
  const mint = getMatchedMint(parsedInstructions, tokenAccounts);
  const transferToken = await getTransferToken(destination, mint, context);

  if (transferToken) {
    const transferAmount = meta?.preTokenBalances?.filter(({ owner }) => owner === address)?.[0]
      ?.uiTokenAmount;

    if (transferAmount) {
      return [buildTokenTransfer(transferToken, transferAmount.amount, 'destination', destination)];
    }
  }

  const lamports = getLamports(transaction, meta);
  return lamports ? [buildNativeTransfer(lamports, 'destination', destination)] : [];
};

/** Dispatches to `getSwapOutputs` / `getSendOutputs` based on `type`, or returns `[]` for RECEIVE/INTERACTION/UNKNOWN/MINT. */
const getOutputs = async (address, type, meta, transaction, source, destination, nft, context) => {
  if (type === SWAP) {
    return getSwapOutputs(address, meta, destination, context);
  }

  if (type === SEND) {
    return getSendOutputs(address, meta, transaction, destination, nft, context);
  }

  return [];
};

/**
 * Solana transaction resource — top-level dispatcher for a single tx.
 *
 * When `transactionInfo._source === 'enriched'` (Triton-parsed or Helius
 * Enhanced API, already normalized upstream via `buildEnhancedTransaction`),
 * strips the internal `_source` marker and returns the payload as-is.
 * Otherwise builds the bare-RPC fallback shape via `buildResource`.
 *
 * Pure mapper: performs no I/O. The lookup data it reads —
 * `locals.tokens`, `locals.tokenAccounts`, `locals.rpcNftBySignature` — is
 * preloaded by `src/services/solana/solana-rpc-enrichment.js` before the
 * controller decorates the payload.
 *
 * DESIGN NOTE — two-stage shaping, deliberate:
 * Enriched transactions are already shaped inside the service by
 * `helius-transaction-resource` (the canonical enriched mapper, which needs
 * the service's per-page enrichment context); this resource only strips the
 * internal `_source` tag from them. Bare-RPC transactions are shaped here,
 * at the controller layer. The `_source` discriminator is the seam between
 * the two paths. Do not merge the two mappers or move the enriched shaping
 * to the controller — see the design note in `helius-transaction-resource.js`
 * and `docs/ARCHITECTURE.md` (Solana slice).
 *
 * @param {Object} transactionInfo - Either an already-enriched tx payload
 *   (`_source: 'enriched'`) or a bare-RPC `{ address, signature, blockTime,
 *   meta, transaction }` record.
 * @param {Object} include - relation include map
 * @param {string} key - decorator chain key
 * @param {Object} context - per-request context (`locals.tokens` /
 *   `locals.tokenAccounts` / `locals.rpcNftBySignature` are read here for
 *   the bare-RPC path)
 * @returns {Promise<Object>} resource - enriched passthrough, or the
 *   bare-RPC shape `{ id, timestamp, status, fee, type, inputs, outputs }`
 *   built by `buildResource`
 */
module.exports = async (transactionInfo, include, key, context) => {
  const { _source } = transactionInfo;

  // 'enriched' covers both Triton-parsed (current primary) and Helius
  // Enhanced API (fallback) — both flow through buildEnhancedTransaction in
  // the service layer.
  if (_source === 'enriched') {
    return cleanHeliusTransaction(transactionInfo);
  }

  return buildResource(transactionInfo, context);
};
