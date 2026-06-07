import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { UpgradeButton } from '../UpgradeButton';

// Mock the hooks
const mockUseAuth = vi.fn();
const mockUseSubscription = vi.fn();

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => mockUseAuth(),
}));

vi.mock('@/hooks/useSubscription', () => ({
  useSubscription: () => mockUseSubscription(),
}));

describe('UpgradeButton', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders nothing when user is pro', () => {
    mockUseAuth.mockReturnValue({ user: { id: 'u1', email: 'a@b.com' } });
    mockUseSubscription.mockReturnValue({ isPro: true, upgrade: vi.fn(), loading: false });

    const { container } = render(<UpgradeButton />);
    expect(container.innerHTML).toBe('');
  });

  it('renders nothing when not logged in', () => {
    mockUseAuth.mockReturnValue({ user: null });
    mockUseSubscription.mockReturnValue({ isPro: false, upgrade: vi.fn(), loading: false });

    const { container } = render(<UpgradeButton />);
    expect(container.innerHTML).toBe('');
  });

  it('renders nothing when loading', () => {
    mockUseAuth.mockReturnValue({ user: { id: 'u1', email: 'a@b.com' } });
    mockUseSubscription.mockReturnValue({ isPro: false, upgrade: vi.fn(), loading: true });

    const { container } = render(<UpgradeButton />);
    expect(container.innerHTML).toBe('');
  });

  it('renders upgrade card when free tier', () => {
    mockUseAuth.mockReturnValue({ user: { id: 'u1', email: 'a@b.com' } });
    mockUseSubscription.mockReturnValue({ isPro: false, upgrade: vi.fn(), loading: false });

    render(<UpgradeButton />);
    expect(screen.getByText(/upgrade to pro/i)).toBeInTheDocument();
    expect(screen.getByText(/\$4\.99\/mo/i)).toBeInTheDocument();
  });

  it('calls upgrade on click', async () => {
    const upgradeFn = vi.fn();
    mockUseAuth.mockReturnValue({ user: { id: 'u1', email: 'a@b.com' } });
    mockUseSubscription.mockReturnValue({ isPro: false, upgrade: upgradeFn, loading: false });

    const user = userEvent.setup();
    render(<UpgradeButton />);

    await user.click(screen.getByRole('button', { name: /upgrade/i }));
    expect(upgradeFn).toHaveBeenCalledOnce();
  });
});
