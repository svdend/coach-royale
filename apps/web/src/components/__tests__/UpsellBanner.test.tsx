import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { UpsellBanner } from '../UpsellBanner';

const mockUseAuth = vi.fn();
const mockUseSubscription = vi.fn();

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => mockUseAuth(),
}));

vi.mock('@/hooks/useSubscription', () => ({
  useSubscription: () => mockUseSubscription(),
}));

describe('UpsellBanner', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the daily limit reason and calls upgrade', async () => {
    const upgrade = vi.fn();
    mockUseAuth.mockReturnValue({ user: { id: 'u1', email: 'coach@example.com' } });
    mockUseSubscription.mockReturnValue({ upgrade });

    const user = userEvent.setup();
    render(
      <UpsellBanner
        upsell={{
          reason: 'daily_limit',
          cta: 'Upgrade to Pro for unlimited coaching.',
          upgrade_url: '/?upgrade=pro',
        }}
      />,
    );

    expect(screen.getByText(/reached today's free ai coaching limit/i)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /upgrade to pro/i }));
    expect(upgrade).toHaveBeenCalledOnce();
  });

  it('renders a sign-in hint for anonymous users', () => {
    mockUseAuth.mockReturnValue({ user: null });
    mockUseSubscription.mockReturnValue({ upgrade: vi.fn() });

    render(
      <UpsellBanner
        upsell={{
          reason: 'pool_exhausted',
          cta: 'The shared free AI pool is busy.',
          upgrade_url: '/?upgrade=pro',
        }}
      />,
    );

    expect(screen.getAllByText(/shared free ai pool is busy/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/sign in to upgrade/i)).toBeInTheDocument();
  });
});
