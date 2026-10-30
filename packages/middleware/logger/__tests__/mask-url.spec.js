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

  it('masks Dagon recipient and viewer addresses and hides amounts and fresh keys', () => {
    const key = 'DYw8jCTfwHNRJhhmFcbXvVDTqWMEVFBX6ZKUmG5CNSKK';
    expect(
      maskUrl(
        `/v1/solana-devnet/powerups/dagon/build?action=send&amount=1000&to=${key}&viewer=${key}&amountIn=5&minAmountOut=4&freshSigners=${key},${key}`
      )
    ).toBe(
      '/v1/solana-devnet/powerups/dagon/build?action=send&amount=*&to=DYw8…NSKK&viewer=DYw8…NSKK&amountIn=*&minAmountOut=*&freshSigners=*'
    );
  });

  it('leaves a normal path untouched', () => {
    expect(maskUrl('/v1/networks?stage=prod')).toBe('/v1/networks?stage=prod');
  });
});
