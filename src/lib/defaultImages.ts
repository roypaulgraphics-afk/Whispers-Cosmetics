import lotionImg from '../assets/images/product_shea_lotion_1794581812566.jpg';
import hairOilImg from '../assets/images/product_hair_oil_1794581812898.jpg';
import beautyCreamImg from '../assets/images/product_beauty_cream_1794581812991.jpg';
import beautySoapImg from '../assets/images/product_beauty_soap_1794581813295.jpg';
import bodySprayImg from '../assets/images/product_body_spray_1794581813119.jpg';

export const PRESET_PRODUCT_IMAGES: Record<string, { label: string; src: string }> = {
  'preset:lotion': {
    label: 'Shea Body Lotion',
    src: lotionImg,
  },
  'preset:hair_oil': {
    label: 'Botanical Hair Oil',
    src: hairOilImg,
  },
  'preset:beauty_cream': {
    label: 'Radiance Face Cream',
    src: beautyCreamImg,
  },
  'preset:beauty_soap': {
    label: 'Artisanal Beauty Soap',
    src: beautySoapImg,
  },
  'preset:body_spray': {
    label: 'Botanical Body Mist',
    src: bodySprayImg,
  },
};

export function resolveProductImage(imageUrl?: string): string | null {
  if (!imageUrl) return null;
  if (imageUrl.startsWith('preset:')) {
    return PRESET_PRODUCT_IMAGES[imageUrl]?.src ?? null;
  }
  return imageUrl;
}
