import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import { SafeImage } from '../SafeImage';

describe('SafeImage', () => {
  it('applies safe loading defaults and becomes visible after load', async () => {
    render(<SafeImage src="https://example.com/card.png" alt="Card icon" />);

    const image = screen.getByAltText('Card icon');
    expect(image).toHaveAttribute('decoding', 'async');
    expect(image).toHaveAttribute('referrerpolicy', 'no-referrer');
    expect(image).toHaveClass('opacity-0');

    const decode = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(image, 'decode', {
      configurable: true,
      value: decode,
    });

    fireEvent.load(image);

    await waitFor(() => {
      expect(image).not.toHaveClass('opacity-0');
    });
    expect(decode).toHaveBeenCalledOnce();
  });

  it('renders fallback content after an image error', () => {
    render(
      <SafeImage
        src="https://example.com/avatar.png"
        alt="Coach avatar"
        fallback={<div data-testid="fallback-avatar">Fallback avatar</div>}
      />,
    );

    fireEvent.error(screen.getByAltText('Coach avatar'));

    expect(screen.getByTestId('fallback-avatar')).toBeInTheDocument();
    expect(screen.queryByAltText('Coach avatar')).not.toBeInTheDocument();
  });
});
