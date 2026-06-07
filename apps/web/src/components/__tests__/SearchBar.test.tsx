import { afterEach, describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SearchBar } from '../SearchBar';

const originalClipboard = Object.getOwnPropertyDescriptor(window.navigator, 'clipboard');

function mockClipboardReadText(value: string) {
  if (!window.navigator.clipboard) {
    Object.defineProperty(window.navigator, 'clipboard', {
      configurable: true,
      value: { readText: vi.fn() },
    });
  }

  return vi.spyOn(window.navigator.clipboard, 'readText').mockResolvedValue(value);
}

afterEach(() => {
  vi.restoreAllMocks();
  if (originalClipboard) {
    Object.defineProperty(window.navigator, 'clipboard', originalClipboard);
  } else {
    Reflect.deleteProperty(window.navigator, 'clipboard');
  }
});

describe('SearchBar', () => {
  it('renders input and button', () => {
    render(<SearchBar onSearch={vi.fn()} isLoading={false} />);
    const input = screen.getByRole('textbox', { name: /clash royale player tag/i });
    expect(input).toBeInTheDocument();
    expect(input).toHaveAttribute('inputmode', 'text');
    expect(input).toHaveAttribute('autocapitalize', 'characters');
    expect(input).toHaveAttribute('spellcheck', 'false');
    expect(input).toHaveAttribute('minlength', '4');
    expect(input).toHaveAttribute('maxlength', '14');
    expect(input).toHaveAttribute('pattern', '[0289PYLQGRJCUV]{4,14}');
    expect(input).toHaveAttribute('placeholder', 'Player tag (e.g. GRJCUV)');
    expect(screen.getByRole('button', { name: /search/i })).toBeInTheDocument();
  });

  it('normalizes lowercase tags to uppercase live', async () => {
    const onSearch = vi.fn();
    const user = userEvent.setup();
    render(<SearchBar onSearch={onSearch} isLoading={false} />);

    const input = screen.getByRole('textbox', { name: /clash royale player tag/i });
    await user.type(input, 'grjcuv');

    expect(input).toHaveValue('GRJCUV');
    await user.click(screen.getByRole('button', { name: /search/i }));

    expect(onSearch).toHaveBeenCalledWith('GRJCUV');
    expect(screen.queryByText(/invalid tag/i)).not.toBeInTheDocument();
  });

  it('strips a leading hash live before submit', async () => {
    const onSearch = vi.fn();
    const user = userEvent.setup();
    render(<SearchBar onSearch={onSearch} isLoading={false} />);

    const input = screen.getByRole('textbox', { name: /clash royale player tag/i });
    await user.type(input, '#GRJCUV');

    expect(input).toHaveValue('GRJCUV');
    await user.click(screen.getByRole('button', { name: /search/i }));

    expect(onSearch).toHaveBeenCalledWith('GRJCUV');
  });

  it('rejects invalid tag characters', async () => {
    const onSearch = vi.fn();
    const user = userEvent.setup();
    render(<SearchBar onSearch={onSearch} isLoading={false} />);

    const input = screen.getByRole('textbox', { name: /clash royale player tag/i });
    await user.type(input, 'ZZZZ');
    await user.click(screen.getByRole('button', { name: /search/i }));

    expect(onSearch).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Invalid tag format. Use only: 0289PYLQGRJCUV',
    );
    expect(input).toHaveAttribute('aria-invalid', 'true');
  });

  it('rejects empty input', async () => {
    const onSearch = vi.fn();
    const user = userEvent.setup();
    render(<SearchBar onSearch={onSearch} isLoading={false} />);

    await user.click(screen.getByRole('button', { name: /search/i }));

    expect(onSearch).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent(/enter a player tag/i);
  });

  it('calls onSearch with the trimmed tag', async () => {
    const onSearch = vi.fn();
    const user = userEvent.setup();
    render(<SearchBar onSearch={onSearch} isLoading={false} />);

    const input = screen.getByRole('textbox', { name: /clash royale player tag/i });
    await user.type(input, '  #GRJCUV  ');
    await user.click(screen.getByRole('button', { name: /search/i }));

    expect(onSearch).toHaveBeenCalledWith('GRJCUV');
  });

  it('rejects tags shorter than four characters with a specific message', async () => {
    const onSearch = vi.fn();
    const user = userEvent.setup();
    render(<SearchBar onSearch={onSearch} isLoading={false} />);

    const input = screen.getByRole('textbox', { name: /clash royale player tag/i });
    await user.type(input, '2PP');
    await user.click(screen.getByRole('button', { name: /search/i }));

    expect(onSearch).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Player tags must be at least 4 characters',
    );
  });

  it('pastes and normalizes clipboard text behind a button click', async () => {
    const onSearch = vi.fn();
    const user = userEvent.setup();
    const readText = mockClipboardReadText('##grjcuv');
    render(<SearchBar onSearch={onSearch} isLoading={false} />);

    expect(readText).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: /paste/i }));

    const input = screen.getByRole('textbox', { name: /clash royale player tag/i });
    await waitFor(() => expect(readText).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(input).toHaveValue('GRJCUV'));
  });

  it('rejects pasted tags longer than fourteen characters with a specific message', async () => {
    const onSearch = vi.fn();
    const user = userEvent.setup();
    mockClipboardReadText('##GRJCUVGRJCUVGRJ');
    render(<SearchBar onSearch={onSearch} isLoading={false} />);

    await user.click(screen.getByRole('button', { name: /paste/i }));
    await waitFor(() =>
      expect(screen.getByRole('textbox', { name: /clash royale player tag/i })).toHaveValue(
        'GRJCUVGRJCUVGRJ',
      ),
    );
    await user.click(screen.getByRole('button', { name: /search/i }));

    expect(onSearch).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Player tags must be 14 characters or fewer',
    );
  });

  it('submits a valid normalized tag', async () => {
    const onSearch = vi.fn();
    const user = userEvent.setup();
    render(<SearchBar onSearch={onSearch} isLoading={false} />);

    const input = screen.getByRole('textbox', { name: /clash royale player tag/i });
    await user.type(input, 'GRJCUV');
    await user.click(screen.getByRole('button', { name: /search/i }));

    expect(onSearch).toHaveBeenCalledTimes(1);
    expect(onSearch).toHaveBeenCalledWith('GRJCUV');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('shows loading state', () => {
    render(<SearchBar onSearch={vi.fn()} isLoading={true} />);
    const button = screen.getByRole('button', { name: /search/i });
    expect(button).toBeDisabled();
    // Input should also be disabled during loading
    expect(screen.getByRole('textbox', { name: /clash royale player tag/i })).toBeDisabled();
    expect(screen.getByRole('status')).toHaveTextContent(/searching for player details/i);
  });
});
