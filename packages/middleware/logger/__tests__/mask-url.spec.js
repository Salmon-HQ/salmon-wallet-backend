const { maskUrl } = require('../mask-url');

describe('maskUrl', () => {
  it('masks a Solana address path segment', () => {
    expect(maskUrl('/v1/solana/account/DYw8jCTfwHNRJhhmFcbXvVDTqWMEVFBX6ZKUmG5CNSKK/nft')).toBe(
      '/v1/solana/account/DYw8…NSKK/nft'
    );
  });

  it('masks a Bitcoin address path segment', () => {
    expect(maskUrl('/v1/bitcoin/account/bc1qar0srrr7xfkvy5l643lydnw9re59gtzzwf5mdq/utxo')).toBe(
      '/v1/bitcoin/account/bc1q…5mdq/utxo'
    );
  });

  it('masks address-bearing query params only', () => {
    expect(
      maskUrl('/v1/solana/nft?owner=DYw8jCTfwHNRJhhmFcbXvVDTqWMEVFBX6ZKUmG5CNSKK&page=2')
    ).toBe('/v1/solana/nft?owner=DYw8…NSKK&page=2');
  });

  it('leaves a normal path untouched', () => {
    expect(maskUrl('/v1/networks?stage=prod')).toBe('/v1/networks?stage=prod');
  });
});
