const SEND = 'send';
const RECEIVE = 'receive';
const MINT = 'mint';
const BURN = 'burn';
const STAKE = 'stake';
const LOAN = 'loan';
const INTERACTION = 'interaction';
const UNKNOWN = 'unknown';
// A transaction whose only effect is a note written on-chain (SPL Memo).
const MEMO = 'memo';

module.exports = { SEND, RECEIVE, MINT, BURN, STAKE, LOAN, INTERACTION, UNKNOWN, MEMO };
