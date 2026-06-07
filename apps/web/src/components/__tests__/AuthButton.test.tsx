import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { AuthButton } from '../AuthButton';

const mockUseAuth = vi.fn();

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => mockUseAuth(),
}));

describe('AuthButton', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('labels social sign-in buttons even when visible text is hidden responsively', async () => {
    const signInWithDiscord = vi.fn();
    const signInWithGoogle = vi.fn();

    mockUseAuth.mockReturnValue({
      user: null,
      profile: null,
      loading: false,
      signInWithDiscord,
      signInWithGoogle,
      signOut: vi.fn(),
      refreshProfile: vi.fn(),
    });

    const user = userEvent.setup();
    render(<AuthButton />);

    await user.click(screen.getByRole('button', { name: /sign in with discord/i }));
    await user.click(screen.getByRole('button', { name: /sign in with google/i }));

    expect(signInWithDiscord).toHaveBeenCalledOnce();
    expect(signInWithGoogle).toHaveBeenCalledOnce();
  });

  it('labels the sign-out action for authenticated users', async () => {
    const signOut = vi.fn();

    mockUseAuth.mockReturnValue({
      user: { id: 'user-1' },
      profile: { display_name: 'Coach Nova', avatar_url: null },
      loading: false,
      signInWithDiscord: vi.fn(),
      signInWithGoogle: vi.fn(),
      signOut,
      refreshProfile: vi.fn(),
    });

    const user = userEvent.setup();
    render(<AuthButton />);

    await user.click(screen.getByRole('button', { name: /sign out/i }));

    expect(signOut).toHaveBeenCalledOnce();
    expect(screen.getByText('Coach Nova')).toBeInTheDocument();
  });

  it('falls back to the default avatar shell when the remote avatar fails', () => {
    mockUseAuth.mockReturnValue({
      user: { id: 'user-1' },
      profile: { display_name: 'Coach Nova', avatar_url: 'https://example.com/avatar.png' },
      loading: false,
      signInWithDiscord: vi.fn(),
      signInWithGoogle: vi.fn(),
      signOut: vi.fn(),
      refreshProfile: vi.fn(),
    });

    render(<AuthButton />);

    fireEvent.error(screen.getByAltText('Coach Nova avatar'));

    expect(screen.getByText('Coach Nova')).toBeInTheDocument();
    expect(screen.queryByAltText('Coach Nova avatar')).not.toBeInTheDocument();
  });
});
