// Wallet addresses are PII; keep them out of request logs. Local regexes so
// packages/ stays free of src/ imports.
const SOLANA = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const BITCOIN = /^(?:[123mn][a-km-zA-HJ-NP-Z1-9]{25,34}|(?:bc1|tb1)[a-z0-9]{25,62})$/;
const MASKED_PARAM = /(^|&)(publicKey|owner|destination|address|to|viewer|requestAcct)=([^&]*)/g;
// Amounts and fresh keys next to a wallet are what a confidential-balance build hides.
const HIDDEN_PARAM = /(^|&)(amount|amountIn|minAmountOut|freshSigners)=([^&]*)/g;

const mask = (s) => (SOLANA.test(s) || BITCOIN.test(s) ? `${s.slice(0, 4)}…${s.slice(-4)}` : s);

const maskUrl = (url) => {
  const [path, query] = url.split('?', 2);
  const maskedPath = path.split('/').map(mask).join('/');
  if (!query) return maskedPath;
  const maskedQuery = query
    .replace(MASKED_PARAM, (_, sep, key, value) => `${sep}${key}=${mask(value)}`)
    .replace(HIDDEN_PARAM, (_, sep, key) => `${sep}${key}=*`);
  return `${maskedPath}?${maskedQuery}`;
};

module.exports = { maskUrl };
