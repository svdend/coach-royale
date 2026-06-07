import { useEffect, useRef, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Brain, Send, Crown, Square, Wrench, AlertCircle } from 'lucide-react';
import { useSubscription } from '@/hooks/useSubscription';
import { UpgradeCard } from '@/components/UpgradeButton';
import {
  askCoachQuestion,
  fetchCoachAgentBetaState,
  setCoachAgentBetaOptIn,
  streamCoachAgent,
  type AgentStreamEvent,
} from '@/lib/api';

interface CoachChatProps {
  playerTag: string;
}

interface ToolTraceEntry {
  toolUseId: string;
  name: string;
  isError: boolean;
  /** Present once the tool_result arrives; undefined while dispatch in flight. */
  content?: string;
  latencyMs?: number;
}

interface ChatMessage {
  role: 'user' | 'coach';
  text: string;
  /** Tools the coach invoked while producing this message. Empty for user messages. */
  trace?: ToolTraceEntry[];
  /**
   * Non-empty when the agent loop failed (e.g. anthropic_error, aborted).
   * Distinct from `text` so the UI can style it as a problem state.
   */
  errorReason?: string;
}

const exampleQuestions = [
  'What deck changes would help me push past 6000 trophies?',
  'How should I play against Lavaloon matchups?',
];

/**
 * Feature flag. When unset or not "true" we keep using the legacy
 * single-shot path (askCoachQuestion). Flip VITE_COACH_AGENT_ENABLED=true
 * in the web build env to exercise the agentic path. See AG7 for the
 * per-user beta rollout plan; this flag is a kill-switch, not the final
 * gate.
 *
 * Evaluated at call time (not module load) so tests can override via
 * vi.stubEnv after the component has already been imported.
 */
function agentEnabled(): boolean {
  return import.meta.env.VITE_COACH_AGENT_ENABLED === 'true';
}

/** localStorage key for thread-id persistence, scoped per player tag. */
function threadStorageKey(playerTag: string): string {
  return `coach_thread_${playerTag}`;
}

function loadThreadId(playerTag: string): string | null {
  try {
    return localStorage.getItem(threadStorageKey(playerTag));
  } catch {
    return null;
  }
}

function persistThreadId(playerTag: string, threadId: string): void {
  try {
    localStorage.setItem(threadStorageKey(playerTag), threadId);
  } catch {
    /* storage unavailable (private browsing, quota) — fine, just don't persist */
  }
}

function TypingDots() {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-label="Coach is typing"
      className="mt-1 flex items-center gap-1"
    >
      <span
        className="h-2 w-2 rounded-full bg-primary animate-bounce"
        style={{ animationDelay: '0ms' }}
      />
      <span
        className="h-2 w-2 rounded-full bg-primary animate-bounce"
        style={{ animationDelay: '150ms' }}
      />
      <span
        className="h-2 w-2 rounded-full bg-primary animate-bounce"
        style={{ animationDelay: '300ms' }}
      />
    </div>
  );
}

/**
 * Collapsible tool-trace summary for a single coach turn. Expands to show
 * the raw tool_result payload which is useful for debugging but too noisy
 * for the default view.
 */
function ToolTrace({ entries }: { entries: ToolTraceEntry[] }) {
  const [expanded, setExpanded] = useState(false);
  if (entries.length === 0) return null;
  const hasErrors = entries.some((entry) => entry.isError);

  return (
    <div className="mt-2 border-t border-border/20 pt-2">
      <button
        type="button"
        onClick={() => setExpanded((prev) => !prev)}
        className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground hover:text-foreground transition-colors"
        aria-expanded={expanded}
        aria-controls="coach-tool-trace-details"
      >
        <Wrench className="h-3 w-3" />
        <span>
          {entries.length} tool call{entries.length === 1 ? '' : 's'}
          {hasErrors ? ' (with errors)' : ''}
        </span>
        <span className="opacity-60">{expanded ? '▾' : '▸'}</span>
      </button>
      <ul id="coach-tool-trace-details" className="mt-1.5 space-y-1">
        {entries.map((entry) => (
          <li
            key={entry.toolUseId}
            className="text-[11px] text-muted-foreground flex items-start gap-1.5"
          >
            {entry.isError ? (
              <AlertCircle className="h-3 w-3 text-destructive mt-0.5 flex-shrink-0" />
            ) : (
              <Wrench className="h-3 w-3 text-primary/60 mt-0.5 flex-shrink-0" />
            )}
            <div className="flex-1 min-w-0">
              <span className="font-mono">{entry.name}</span>
              {entry.latencyMs !== undefined && (
                <span className="ml-1.5 text-muted-foreground/60">({entry.latencyMs}ms)</span>
              )}
              {expanded && entry.content && (
                <pre className="mt-0.5 p-1.5 bg-secondary/30 rounded text-xs overflow-x-auto whitespace-pre-wrap break-words">
                  {entry.content}
                </pre>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function CoachChat({ playerTag }: CoachChatProps) {
  const { isPro } = useSubscription();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [pendingTrace, setPendingTrace] = useState<ToolTraceEntry[]>([]);
  const [threadId, setThreadId] = useState<string | null>(() => loadThreadId(playerTag));
  // AG7 beta opt-in state. null = not yet fetched; {opted_in, eligible}
  // once known. Legacy single-shot path is used whenever this isn't
  // {opted_in: true}. Fetched once per mount for Pro users.
  const [betaState, setBetaState] = useState<{ optedIn: boolean; eligible: boolean } | null>(null);
  const [betaToggling, setBetaToggling] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const latestCoachMessageRef = useRef<HTMLDivElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Reset thread state when the player tag changes (user searched for a
  // different player). Keeps conversations siloed per account.
  useEffect(() => {
    setThreadId(loadThreadId(playerTag));
    setMessages([]);
    setPendingTrace([]);
  }, [playerTag]);

  // Cancel any in-flight request on unmount to prevent setState-after-unmount
  // and to close the server-side Anthropic connection early.
  useEffect(() => {
    return () => abortRef.current?.abort();
  }, []);

  // Fetch the beta opt-in state for Pro users when the master flag is on.
  // Free users and flag-off sessions skip the round-trip entirely.
  useEffect(() => {
    if (!agentEnabled() || !isPro) {
      setBetaState(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const state = await fetchCoachAgentBetaState();
        if (cancelled || !state) return;
        setBetaState({ optedIn: state.opted_in, eligible: state.eligible });
      } catch {
        // Degrade silently: a failed fetch just leaves the user on
        // the legacy path, which is the safe default.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isPro]);

  async function handleToggleBeta(next: boolean) {
    if (betaToggling) return;
    setBetaToggling(true);
    try {
      const result = await setCoachAgentBetaOptIn(next);
      setBetaState({ optedIn: result.opted_in, eligible: result.eligible });
    } catch {
      // Leave state unchanged on failure; the user can retry.
    } finally {
      setBetaToggling(false);
    }
  }

  // Streaming path is only active when the master flag, Pro tier, AND
  // the per-user beta opt-in all line up. Anything else stays on the
  // legacy single-shot path.
  function streamingActive(): boolean {
    return agentEnabled() && isPro && betaState?.optedIn === true;
  }

  useEffect(() => {
    const latestMessage = messages.at(-1);
    if (latestMessage?.role === 'coach') {
      latestCoachMessageRef.current?.focus();
    }
  }, [messages]);

  async function handleSendStreaming(question: string) {
    const controller = new AbortController();
    abortRef.current = controller;
    // Capture the trace for this turn in a local array because
    // React state updates lag the event loop.
    const trace: ToolTraceEntry[] = [];
    setPendingTrace([]);
    let finalText = '';
    let errorReason: string | undefined;

    try {
      const result = await streamCoachAgent(playerTag, question, {
        threadId: threadId ?? undefined,
        signal: controller.signal,
        onEvent: (event: AgentStreamEvent) => {
          if (event.type === 'thread') {
            setThreadId(event.thread_id);
            persistThreadId(playerTag, event.thread_id);
            return;
          }
          if (event.type === 'tool_call') {
            trace.push({
              toolUseId: event.toolUseId,
              name: event.name,
              isError: false,
            });
            setPendingTrace([...trace]);
            return;
          }
          if (event.type === 'tool_result') {
            const entry = trace.find((t) => t.toolUseId === event.toolUseId);
            if (entry) {
              entry.isError = event.isError;
              entry.content = event.content;
              entry.latencyMs = event.latencyMs;
              setPendingTrace([...trace]);
            }
            return;
          }
          if (event.type === 'assistant_text') {
            // Non-final assistant text is typically the coach's
            // "let me check…" narration before a tool call. Keep the
            // latest — `final` will replace it anyway if Claude ends
            // with a definitive answer.
            finalText = event.text;
            return;
          }
          if (event.type === 'final') {
            finalText = event.text;
            return;
          }
          if (event.type === 'error') {
            errorReason = event.reason;
            return;
          }
        },
      });
      // result.thread_id is advisory — the thread frame already fired.
      if (result.thread_id) {
        setThreadId(result.thread_id);
      }
    } catch (error) {
      // Network failure or HTTP 4xx/5xx that couldn't produce a stream.
      // Distinguish abort (user clicked Stop) from a real error.
      if (controller.signal.aborted) {
        errorReason = 'aborted';
      } else {
        errorReason = error instanceof Error ? error.message : 'unknown_error';
      }
    } finally {
      if (abortRef.current === controller) {
        abortRef.current = null;
      }
    }

    const text =
      finalText ||
      (errorReason === 'aborted'
        ? 'Cancelled.'
        : 'Sorry, I had trouble answering. Please try again.');

    setMessages((prev) => [
      ...prev,
      {
        role: 'coach',
        text,
        trace: trace.length > 0 ? trace : undefined,
        errorReason,
      },
    ]);
    setPendingTrace([]);
  }

  async function handleSendLegacy(question: string) {
    try {
      const data = await askCoachQuestion(playerTag, question);
      setMessages((prev) => [...prev, { role: 'coach', text: data.answer }]);
    } catch {
      setMessages((prev) => [
        ...prev,
        { role: 'coach', text: 'Sorry, I had trouble answering. Please try again.' },
      ]);
    }
  }

  async function handleSend() {
    const question = input.trim();
    if (!question || loading) return;

    inputRef.current?.blur();
    setInput('');
    setMessages((prev) => [...prev, { role: 'user', text: question }]);
    setLoading(true);

    try {
      if (streamingActive()) {
        await handleSendStreaming(question);
      } else {
        await handleSendLegacy(question);
      }
    } finally {
      setLoading(false);
    }
  }

  function handleStop() {
    abortRef.current?.abort();
  }

  function handleExampleClick(question: string) {
    if (!isPro || loading) return;
    setInput(question);
  }

  if (!isPro) {
    return (
      <Card className="glass-card border-border/50">
        <CardContent className="p-4">
          <div className="flex items-center gap-2 mb-3">
            <Brain className="h-4 w-4 text-chart-5 opacity-50" />
            <h3 className="text-sm font-semibold text-foreground/50">Ask the Coach</h3>
          </div>

          {/* Example questions as greyed-out placeholders */}
          <div className="space-y-2 mb-4">
            {exampleQuestions.map((q, i) => (
              <div
                key={i}
                className="flex items-start gap-2 rounded-lg bg-secondary/20 border border-border/20 p-2.5 opacity-50"
              >
                <Crown className="h-3.5 w-3.5 text-primary/40 mt-0.5 flex-shrink-0" />
                <p className="text-xs text-muted-foreground italic">&ldquo;{q}&rdquo;</p>
              </div>
            ))}
          </div>

          <UpgradeCard feature="Coach Chat" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="glass-card border-primary/30">
      <CardContent className="p-4">
        <div className="flex items-center gap-2 mb-3">
          <Brain className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-semibold text-foreground">Ask the Coach</h3>
          <span className="inline-flex items-center rounded-md bg-primary/20 px-1.5 py-0.5 text-xs font-bold text-primary ring-1 ring-inset ring-primary/30">
            PRO
          </span>
          {agentEnabled() && (
            <span
              className="inline-flex items-center rounded-md bg-amber-500/20 px-1.5 py-0.5 text-xs font-bold text-amber-500 ring-1 ring-inset ring-amber-500/30"
              title="Experimental agentic coach chat with tool use"
            >
              BETA
            </span>
          )}
        </div>

        {/* AG7: per-user beta opt-in invitation. Shown only when the master
            flag is on, the user is Pro, and they haven't opted in yet. */}
        {agentEnabled() && betaState && betaState.eligible && !betaState.optedIn && (
          <div className="mb-3 rounded-lg border border-amber-500/30 bg-amber-500/5 p-3">
            <p className="text-xs text-foreground/90">
              <span className="font-semibold">Try the beta agent.</span> It can look at your recent
              battles and decks while answering you. Slower and more experimental — you can turn it
              off anytime.
            </p>
            <Button
              type="button"
              size="sm"
              onClick={() => handleToggleBeta(true)}
              disabled={betaToggling}
              className="mt-2 bg-amber-500/20 hover:bg-amber-500/30 text-amber-500 border border-amber-500/40"
            >
              {betaToggling ? 'Enabling…' : 'Enable beta'}
            </Button>
          </div>
        )}
        {agentEnabled() && betaState?.optedIn && (
          <div className="mb-3 flex items-center justify-between text-[11px] text-muted-foreground">
            <span>Agent beta is on. Responses may be slower.</span>
            <button
              type="button"
              onClick={() => handleToggleBeta(false)}
              disabled={betaToggling}
              className="text-[11px] underline hover:text-foreground"
            >
              {betaToggling ? 'Disabling…' : 'Disable'}
            </button>
          </div>
        )}

        {/* Chat messages */}
        {messages.length > 0 && (
          <div
            role="log"
            aria-live="polite"
            aria-relevant="additions"
            className="mb-4 space-y-3 md:max-h-80 md:overflow-y-auto"
          >
            {messages.map((msg, i) => (
              <div
                key={i}
                ref={
                  msg.role === 'coach' && i === messages.length - 1 ? latestCoachMessageRef : null
                }
                tabIndex={msg.role === 'coach' ? -1 : undefined}
                className={`rounded-lg p-3 text-sm ${
                  msg.role === 'user'
                    ? 'bg-primary/10 border border-primary/20 ml-8'
                    : msg.errorReason
                      ? 'bg-destructive/10 border border-destructive/30 mr-8'
                      : 'bg-secondary/50 border border-border/30 mr-8'
                }`}
              >
                {msg.role === 'coach' && (
                  <div className="flex items-center gap-1.5 mb-1">
                    {msg.errorReason ? (
                      <AlertCircle className="h-3 w-3 text-destructive" />
                    ) : (
                      <Brain className="h-3 w-3 text-primary" />
                    )}
                    <span
                      className={`text-xs font-semibold ${
                        msg.errorReason ? 'text-destructive' : 'text-primary'
                      }`}
                    >
                      {msg.errorReason ? 'Coach (error)' : 'Coach'}
                    </span>
                  </div>
                )}
                <p className="text-foreground/90 leading-relaxed whitespace-pre-wrap">
                  {msg.role === 'user' && <span className="sr-only">You: </span>}
                  {msg.text}
                </p>
                {msg.role === 'coach' && msg.trace && msg.trace.length > 0 && (
                  <ToolTrace entries={msg.trace} />
                )}
              </div>
            ))}
            {loading && (
              <div className="bg-secondary/50 border border-border/30 mr-8 rounded-lg p-3">
                <div className="flex items-center gap-1.5 mb-1">
                  <Brain className="h-3 w-3 text-primary" />
                  <span className="text-xs font-semibold text-primary">Coach</span>
                </div>
                <TypingDots />
                {pendingTrace.length > 0 && <ToolTrace entries={pendingTrace} />}
              </div>
            )}
          </div>
        )}

        {/* Example questions */}
        {messages.length === 0 && (
          <div className="space-y-2 mb-4">
            {exampleQuestions.map((q, i) => (
              <button
                key={i}
                onClick={() => handleExampleClick(q)}
                className="flex items-start gap-2 rounded-lg bg-secondary/30 border border-border/30 p-2.5 w-full text-left hover:bg-secondary/50 transition-colors"
              >
                <Crown className="h-3.5 w-3.5 text-primary mt-0.5 flex-shrink-0" />
                <p className="text-xs text-foreground/70">&ldquo;{q}&rdquo;</p>
              </button>
            ))}
          </div>
        )}

        {/* Input */}
        <div className="flex gap-2">
          <Input
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleSend();
            }}
            placeholder="Ask your coach..."
            className="bg-secondary/30 border-border/40 text-sm"
            disabled={loading}
          />
          {loading && streamingActive() ? (
            <Button
              size="sm"
              onClick={handleStop}
              variant="secondary"
              className="px-3"
              aria-label="Stop coach"
            >
              <Square aria-hidden="true" className="h-4 w-4" />
            </Button>
          ) : (
            <Button
              size="sm"
              onClick={handleSend}
              disabled={loading || !input.trim()}
              className="bg-primary text-primary-foreground px-3 hover:bg-primary/90"
              aria-label="Send coach question"
            >
              <Send aria-hidden="true" className="h-4 w-4" />
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
