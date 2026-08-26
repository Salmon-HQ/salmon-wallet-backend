'use strict';

const fs = require('fs');
const path = require('path');
const { BITCOIN, SOLANA, ETHEREUM, BLOCKCHAINS } = require('../blockchains');

describe('blockchains constants', () => {
  it('exports a BLOCKCHAINS array containing the canonical chain ids', () => {
    expect(BLOCKCHAINS).toEqual([BITCOIN, SOLANA, ETHEREUM]);
  });

  it('has a routes/<chain>/index.js for every entry in BLOCKCHAINS', () => {
    BLOCKCHAINS.forEach((chain) => {
      const routerPath = path.resolve(__dirname, `../../routes/${chain}/index.js`);
      expect(fs.existsSync(routerPath)).toBe(true);
    });
  });
});
