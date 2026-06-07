import { type ImgHTMLAttributes, type ReactNode, useState } from 'react';
import { ImageOff } from 'lucide-react';

import { cn } from '@/lib/utils';

export interface SafeImageProps extends Omit<ImgHTMLAttributes<HTMLImageElement>, 'children'> {
  fallback?: ReactNode;
  fallbackClassName?: string;
}

function defaultFallback(alt: string, fallbackClassName?: string): ReactNode {
  return (
    <div
      role="img"
      aria-label={alt}
      className={cn(
        'flex h-full w-full items-center justify-center bg-muted/60 text-muted-foreground',
        fallbackClassName,
      )}
    >
      <ImageOff aria-hidden="true" className="h-4 w-4" />
    </div>
  );
}

export function SafeImage({
  alt,
  className,
  decoding,
  fallback,
  fallbackClassName,
  fetchPriority,
  loading,
  onError,
  onLoad,
  referrerPolicy,
  src,
  ...props
}: SafeImageProps) {
  const altText = alt ?? 'Image unavailable';
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const [readySrc, setReadySrc] = useState<string | null>(null);
  const hasError = !src || failedSrc === src;

  if (hasError) {
    return <>{fallback ?? defaultFallback(altText, fallbackClassName)}</>;
  }

  return (
    <img
      {...props}
      src={src}
      alt={altText}
      className={cn(className, readySrc !== src && 'opacity-0')}
      decoding={decoding ?? 'async'}
      fetchPriority={fetchPriority}
      loading={loading}
      referrerPolicy={referrerPolicy ?? 'no-referrer'}
      onError={(event) => {
        setReadySrc((current) => (current === src ? null : current));
        setFailedSrc(src);
        onError?.(event);
      }}
      onLoad={(event) => {
        const image = event.currentTarget;
        const markReady = () => {
          setFailedSrc((current) => (current === src ? null : current));
          setReadySrc(src);
        };

        if (typeof image.decode === 'function') {
          void image
            .decode()
            .catch(() => undefined)
            .finally(markReady);
        } else {
          markReady();
        }

        onLoad?.(event);
      }}
    />
  );
}
