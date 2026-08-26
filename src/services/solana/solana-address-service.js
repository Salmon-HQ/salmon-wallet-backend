/**
 * Solana address service.
 *
 * Helpers for deriving SPL associated token addresses (ATAs) and reading
 * basic on-chain account state. Wraps `@solana/web3.js` and
 * `@solana/spl-token` so callers don't have to assemble PublicKeys or
 * Connections themselves.
 */

const { Connection, PublicKey } = require('@solana/web3.js');
const { TOKEN_PROGRAM_ID, getAssociatedTokenAddress } = require('@solana/spl-token');

const SPL_ASSOCIATED_TOKEN_ACCOUNT_PROGRAM_ID = new PublicKey(
  'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL'
);

/**
 * Derive the associated token account PDA for a wallet/mint pair using the
 * legacy `findProgramAddress` path.
 *
 * @param {string} walletAddress - Owner wallet base58 address.
 * @param {string} tokenMintAddress - SPL token mint base58 address.
 * @returns {Promise<PublicKey|undefined>} Derived ATA PublicKey, or
 *   undefined if derivation fails.
 */
const findAssociatedTokenAddress = async (walletAddress, tokenMintAddress) => {
  const programAddress = await PublicKey.findProgramAddress(
    [
      new PublicKey(walletAddress).toBuffer(),
      TOKEN_PROGRAM_ID.toBuffer(),
      new PublicKey(tokenMintAddress).toBuffer(),
    ],
    SPL_ASSOCIATED_TOKEN_ACCOUNT_PROGRAM_ID
  );

  return programAddress?.[0];
};

/**
 * Compute the associated token account address for a wallet/mint pair via
 * `@solana/spl-token`'s `getAssociatedTokenAddress`.
 *
 * @param {string} walletAddress - Owner wallet base58 address.
 * @param {string} tokenMintAddress - SPL token mint base58 address.
 * @returns {Promise<string>} ATA base58 address.
 */
const getATA = async (walletAddress, tokenMintAddress) => {
  const owner = new PublicKey(walletAddress);
  const mint = new PublicKey(tokenMintAddress);
  const ata = await getAssociatedTokenAddress(mint, owner, false);

  return ata.toBase58();
};

/**
 * Fetch the parsed Solana account info for an address.
 *
 * @param {string} address - Account base58 address.
 * @param {Object} locals - Request locals containing `network.config.nodeUrl`.
 * @returns {Promise<Object>} The web3.js parsed account-info response
 *   (`{context, value}`).
 */
const getAccountInfo = async (address, locals) => {
  const publicKey = new PublicKey(address);
  const commitment = 'confirmed';

  const { nodeUrl } = locals.network.config;
  const connection = new Connection(nodeUrl, commitment);

  return await connection.getParsedAccountInfo(publicKey);
};

/**
 * List the SPL token account pubkeys (base58) owned by a wallet.
 *
 * @param {string} address - Owner wallet base58 address.
 * @param {Object} locals - Request locals containing `network.config.nodeUrl`.
 * @returns {Promise<string[]|undefined>} Array of token account base58
 *   addresses, or undefined if the RPC returned no `value`.
 */
const getTokenAccounts = async (address, locals) => {
  const publicKey = new PublicKey(address);
  const commitment = 'confirmed';

  const { nodeUrl } = locals.network.config;
  const connection = new Connection(nodeUrl, commitment);
  const filter = { programId: TOKEN_PROGRAM_ID };

  const result = await connection.getParsedTokenAccountsByOwner(publicKey, filter, commitment);

  return result?.value?.map(({ pubkey }) => pubkey.toBase58());
};

module.exports = {
  findAssociatedTokenAddress,
  getATA,
  getAccountInfo,
  getTokenAccounts,
};
