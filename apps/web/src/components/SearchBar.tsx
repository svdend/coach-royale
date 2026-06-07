import { useId, useMemo, useState, type FormEvent } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Search, Hash, Loader2, ClipboardPaste } from 'lucide-react';

const TAG_REGEX = /^[0289PYLQGRJCUV]+$/;
const TAG_PATTERN = '[0289PYLQGRJCUV]{4,14}';
const MIN_TAG_LENGTH = 4;
const MAX_TAG_LENGTH = 14;

function normalizeTagInput(value: string): string {
  return value.replace(/^#+/, '').toUpperCase();
}

function validateTagInput(value: string): string {
  const normalized = normalizeTagInput(value.trim());
  if (!normalized) {
    return 'Enter a player tag';
  }
  if (normalized.length < MIN_TAG_LENGTH) {
    return `Player tags must be at least ${MIN_TAG_LENGTH} characters`;
  }
  if (normalized.length > MAX_TAG_LENGTH) {
    return `Player tags must be ${MAX_TAG_LENGTH} characters or fewer`;
  }
  if (!TAG_REGEX.test(normalized)) {
    return 'Invalid tag format. Use only: 0289PYLQGRJCUV';
  }

  return '';
}

interface SearchBarProps {
  onSearch: (tag: string) => void;
  isLoading: boolean;
  initialTag?: string;
}

export function SearchBar({ onSearch, isLoading, initialTag = '' }: SearchBarProps) {
  const [tag, setTag] = useState(() => normalizeTagInput(initialTag));
  const [error, setError] = useState('');
  const inputId = useId();
  const canPasteFromClipboard = useMemo(
    () => typeof navigator !== 'undefined' && typeof navigator.clipboard?.readText === 'function',
    [],
  );
  const hintId = `${inputId}-hint`;
  const errorId = `${inputId}-error`;
  const statusId = `${inputId}-status`;
  const descriptionIds = [hintId, error ? errorId : null, isLoading ? statusId : null]
    .filter(Boolean)
    .join(' ');

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const normalizedTag = normalizeTagInput(tag.trim());
    const nextError = validateTagInput(normalizedTag);
    if (nextError) {
      setError(nextError);
      return;
    }
    setError('');
    setTag(normalizedTag);
    onSearch(normalizedTag);
  }

  async function handlePasteClick() {
    if (!canPasteFromClipboard) return;

    try {
      const clipboardText = await navigator.clipboard.readText();
      setTag(normalizeTagInput(clipboardText.trim()));
      if (error) setError('');
    } catch {
      setError('Clipboard access was blocked. Paste your tag manually.');
    }
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="w-full">
      <label htmlFor={inputId} className="sr-only">
        Clash Royale player tag
      </label>
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Hash
            aria-hidden="true"
            className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground"
          />
          <Input
            id={inputId}
            type="text"
            placeholder="Player tag (e.g. GRJCUV)"
            value={tag}
            onChange={(e) => {
              setTag(normalizeTagInput(e.target.value));
              if (error) setError('');
            }}
            inputMode="text"
            autoCapitalize="characters"
            spellCheck={false}
            minLength={MIN_TAG_LENGTH}
            maxLength={MAX_TAG_LENGTH}
            pattern={TAG_PATTERN}
            aria-describedby={descriptionIds || undefined}
            aria-invalid={Boolean(error)}
            className="pl-9 h-12 bg-secondary/50 border-border text-foreground placeholder:text-muted-foreground uppercase tracking-wider font-mono"
            disabled={isLoading}
          />
        </div>
        {canPasteFromClipboard && (
          <button
            type="button"
            onClick={() => {
              void handlePasteClick();
            }}
            disabled={isLoading}
            className="inline-flex h-12 shrink-0 items-center justify-center gap-1 rounded-lg border border-border bg-background px-3 text-[0.8rem] font-medium text-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:border-ring focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50"
          >
            <ClipboardPaste aria-hidden="true" className="h-4 w-4" />
            Paste
          </button>
        )}
        <Button
          type="submit"
          disabled={isLoading}
          className="h-12 min-w-[7.5rem] px-6 bg-primary text-primary-foreground hover:bg-primary/90 font-semibold"
        >
          {isLoading ? (
            <>
              <Loader2 aria-hidden="true" className="h-5 w-5 animate-spin" />
              <span className="ml-2">Searching...</span>
            </>
          ) : (
            <>
              <Search aria-hidden="true" className="h-5 w-5 mr-2" />
              Search
            </>
          )}
        </Button>
      </div>
      <p id={hintId} className="sr-only">
        Enter a Clash Royale player tag. Leading hash characters are removed automatically. Tags
        must be 4 to 14 characters and can only use 0, 2, 8, 9, P, Y, L, Q, G, R, J, C, U, and V.
      </p>
      {isLoading && (
        <p id={statusId} role="status" className="sr-only">
          Searching for player details{tag.trim() ? ` for ${tag.trim().toUpperCase()}` : ''}.
        </p>
      )}
      {error && (
        <p id={errorId} role="alert" className="text-destructive text-sm mt-2 text-left">
          {error}
        </p>
      )}
    </form>
  );
}
