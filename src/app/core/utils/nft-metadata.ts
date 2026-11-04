import { NftAttribute, NftMetadata } from '../models/nft.model';
import { cleanContractText } from './contract-text';
import { mediaUrl } from './media-hosts';

const MAX_LINK_LENGTH = 2048;
const MAX_NAME = 100;
const MAX_DESCRIPTION = 2000;
const MAX_ATTRIBUTES = 50;
const MAX_TRAIT = 60;
const MAX_VALUE = 120;

/**
 * The usual NFT metadata JSON → NftMetadata; null when it isn't a JSON object.
 * Its image is kept only on MEDIA_HOSTS (mediaUrl).
 */
export function parseNftMetadata(json: unknown): NftMetadata | null {
  if (!json || typeof json !== 'object' || Array.isArray(json)) return null;
  const data = json as Record<string, unknown>;
  const attributes = Array.isArray(data['attributes']) ? data['attributes'] : [];
  return {
    name: text(data['name'], MAX_NAME),
    description: text(data['description'], MAX_DESCRIPTION),
    image: mediaUrl(text(data['image'], MAX_LINK_LENGTH)),
    attributes: attributes
      .slice(0, MAX_ATTRIBUTES)
      .filter((a): a is Record<string, unknown> => !!a && typeof a === 'object')
      .map((a): NftAttribute => ({
        trait: text(a['trait_type'], MAX_TRAIT),
        value: text(a['value'], MAX_VALUE),
      }))
      .filter((a) => a.trait !== '' && a.value !== ''),
  };
}

function text(value: unknown, maxLength: number): string {
  if (typeof value === 'string') return cleanContractText(value, maxLength);
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return '';
}
