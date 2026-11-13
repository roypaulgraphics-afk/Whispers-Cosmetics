import React, { useState } from 'react';
import { Package } from 'lucide-react';
import { resolveProductImage } from '../lib/defaultImages';

interface ProductThumbnailProps {
  imageUrl?: string;
  name: string;
  category?: string;
  className?: string;
}

export const ProductThumbnail: React.FC<ProductThumbnailProps> = ({
  imageUrl,
  name,
  category,
  className = 'w-12 h-12 rounded-lg',
}) => {
  const [errored, setErrored] = useState(false);
  const resolved = resolveProductImage(imageUrl);

  if (!resolved || errored) {
    const initials = name
      .split(' ')
      .slice(0, 2)
      .map((w) => w[0])
      .join('')
      .toUpperCase();
    return (
      <div
        className={`${className} flex flex-col items-center justify-center shrink-0 border border-stone-200 dark:border-zinc-800 bg-gradient-to-br from-stone-100 to-stone-200/70 dark:from-zinc-800 dark:to-zinc-900 text-stone-500 dark:text-zinc-400 select-none overflow-hidden`}
        title={category ? `${name} (${category})` : name}
      >
        {initials ? (
          <span className="font-display text-sm font-semibold tracking-wider">{initials}</span>
        ) : (
          <Package className="w-4 h-4" />
        )}
      </div>
    );
  }

  return (
    <img
      src={resolved}
      alt={name}
      referrerPolicy="no-referrer"
      onError={() => setErrored(true)}
      className={`${className} object-cover shrink-0 border border-stone-200 dark:border-zinc-800 bg-stone-100 dark:bg-zinc-900`}
    />
  );
};
