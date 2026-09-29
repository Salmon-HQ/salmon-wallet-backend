'use strict';

const memo = require('../memo');

const PAYER = '86xCnPeV69n6t3DnyGvkKobf9FdN2H9oiVDdaMpo2MMY';

describe('memo adapter', () => {
  it('requires a non-empty string note within the size cap', () => {
    expect(memo.validate({ publicKey: PAYER })).toMatchObject({ error: 'missing_parameter' });
    expect(memo.validate({ publicKey: PAYER, note: '' })).toMatchObject({
      error: 'missing_parameter',
    });
    expect(memo.validate({ publicKey: PAYER, note: ['x'] })).toMatchObject({
      error: 'invalid_parameter',
    });
    expect(memo.validate({ publicKey: PAYER, note: 'é'.repeat(200) })).toMatchObject({
      error: 'note_too_long',
    });
    expect(memo.validate({ publicKey: PAYER, note: 'gm' })).toEqual({
      params: { note: 'gm', publicKey: PAYER },
    });
  });

  it('builds one Memo instruction signed by the caller and typed display fields', async () => {
    const result = await memo.build({ note: 'gm', publicKey: PAYER });

    expect(result.instructions).toHaveLength(1);
    const [ix] = result.instructions;
    expect(ix.programId.toBase58()).toBe(memo.MEMO_PROGRAM_ID);
    expect(ix.keys).toEqual([expect.objectContaining({ isSigner: true, isWritable: false })]);
    expect(ix.keys[0].pubkey.toBase58()).toBe(PAYER);
    expect(ix.data.toString('utf8')).toBe('gm');
    expect(result.display).toEqual({ note: 'gm', noteBytes: 2 });
    expect(result.provider).toMatchObject({ id: 'memo' });
  });
});
