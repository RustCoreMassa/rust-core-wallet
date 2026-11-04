import { parseNftMetadata } from './nft-metadata';

const CID = 'bafybeigdyrzt5sfp7udm7hu76uh7y26nf3efuylqabf3oclgtqy55fbzdi';

describe('parseNftMetadata', () => {
  it('keeps the known fields as plain text', () => {
    expect(
      parseNftMetadata({
        name: 'Keeper​ #7‮',
        description: '  A  crab \n with rust ',
        image: `ipfs://${CID}/7.png`,
        attributes: [
          { trait_type: 'Shell', value: 'Copper' },
          { trait_type: 'Level', value: 3 },
          { trait_type: 'Shiny', value: true },
          { trait_type: '', value: 'no trait' },
          { trait_type: 'No value' },
          'junk',
          null,
        ],
        external_url: 'https://elsewhere',
        animation_url: 'https://elsewhere/video.mp4',
      }),
    ).toEqual({
      name: 'Keeper #7',
      description: 'A crab with rust',
      image: `https://ipfs.io/ipfs/${CID}/7.png`,
      attributes: [
        { trait: 'Shell', value: 'Copper' },
        { trait: 'Level', value: '3' },
        { trait: 'Shiny', value: 'true' },
      ],
    });
  });

  it('drops unusable images and odd field types', () => {
    expect(
      parseNftMetadata({ name: { x: 1 }, image: 'http://plain.example/1.png', attributes: 'x' }),
    ).toEqual({ name: '', description: '', image: '', attributes: [] });
    expect(parseNftMetadata({ image: 'https://tracker.example/pixel.png' })).toEqual({
      name: '',
      description: '',
      image: '',
      attributes: [],
    });
  });

  it('caps names and the number of traits', () => {
    const metadata = parseNftMetadata({
      name: 'n'.repeat(500),
      attributes: Array.from({ length: 80 }, (_, i) => ({ trait_type: `t${i}`, value: i })),
    })!;
    expect([...metadata.name].length).toBe(100);
    expect(metadata.attributes).toHaveLength(50);
  });

  it('refuses anything but a JSON object', () => {
    for (const json of [null, undefined, 'text', 42, [], [{ name: 'x' }]]) {
      expect(parseNftMetadata(json)).toBeNull();
    }
  });
});
