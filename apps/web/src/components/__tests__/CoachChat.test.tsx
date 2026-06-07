import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CoachChat } from '../CoachChat';
import {
  askCoachQuestion,
  fetchCoachAgentBetaState,
  setCoachAgentBetaOptIn,
  streamCoachAgent,
  type AgentStreamEvent,
  type StreamCoachAgentOptions,
} from '@/lib/api';

const mockUseSubscription = vi.fn();

vi.mock('@/hooks/useSubscription', () => ({
  useSubscription: () => mockUseSubscription(),
}));

vi.mock('@/lib/api', () => ({
  askCoachQuestion: vi.fn(),
  streamCoachAgent: vi.fn(),
  fetchCoachAgentBetaState: vi.fn(),
  setCoachAgentBetaOptIn: vi.fn(),
}));

describe('CoachChat', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseSubscription.mockReturnValue({ isPro: true });
    localStorage.clear();
    // Default the env flag to off so legacy tests are unaffected.
    vi.stubEnv('VITE_COACH_AGENT_ENABLED', 'false');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  // --- legacy single-shot path ----------------------------------------

  describe('legacy (non-agent) path', () => {
    it('announces typing status and includes a visually hidden user label', async () => {
      vi.mocked(askCoachQuestion).mockReturnValue(new Promise<{ answer: string }>(() => {}));

      const user = userEvent.setup();
      render(<CoachChat playerTag="PLAYER123" />);

      await user.type(screen.getByPlaceholderText(/ask your coach/i), 'How do I counter Lavaloon?');
      await user.click(screen.getByRole('button', { name: /send coach question/i }));

      expect(screen.getByRole('status', { name: /coach is typing/i })).toBeInTheDocument();
      expect(screen.getByText('You:')).toHaveClass('sr-only');
    });

    it('calls askCoachQuestion and renders the answer', async () => {
      vi.mocked(askCoachQuestion).mockResolvedValue({
        answer: 'Use inferno tower and log.',
      });

      const user = userEvent.setup();
      render(<CoachChat playerTag="PLAYER123" />);
      await user.type(screen.getByPlaceholderText(/ask your coach/i), 'hi');
      await user.click(screen.getByRole('button', { name: /send coach question/i }));

      expect(await screen.findByText(/inferno tower/i)).toBeInTheDocument();
      expect(vi.mocked(askCoachQuestion)).toHaveBeenCalledOnce();
      expect(vi.mocked(streamCoachAgent)).not.toHaveBeenCalled();
    });

    it('does not render the BETA badge when the agent flag is off', () => {
      render(<CoachChat playerTag="PLAYER123" />);
      expect(screen.queryByText('BETA')).not.toBeInTheDocument();
    });
  });

  // --- agentic streaming path -----------------------------------------

  describe('agentic streaming path', () => {
    beforeEach(() => {
      vi.stubEnv('VITE_COACH_AGENT_ENABLED', 'true');
      // AG7: streaming only fires when the user has opted into the beta.
      // Existing streaming tests assume the user is already in the beta.
      vi.mocked(fetchCoachAgentBetaState).mockResolvedValue({
        opted_in: true,
        eligible: true,
      });
    });

    /**
     * Wait for the CoachChat component's beta-state fetch to resolve
     * and render the "Agent beta is on" affordance. The streaming
     * tests below rely on streamingActive() being true by the time
     * they submit, which only happens after this fetch completes.
     */
    async function waitForBetaLoaded() {
      await waitFor(() => {
        expect(screen.getByText(/Agent beta is on/i)).toBeInTheDocument();
      });
    }

    /**
     * Helper that drives streamCoachAgent's onEvent callback with a
     * scripted sequence of AgentStreamEvents and resolves with the
     * expected { thread_id } shape.
     */
    function scriptStream(events: AgentStreamEvent[]) {
      vi.mocked(streamCoachAgent).mockImplementation(
        async (_tag: string, _question: string, options: StreamCoachAgentOptions) => {
          let threadId: string | null = null;
          for (const event of events) {
            if (options.signal?.aborted) throw new DOMException('aborted', 'AbortError');
            if (event.type === 'thread') threadId = event.thread_id;
            options.onEvent(event);
          }
          return { thread_id: threadId };
        },
      );
    }

    it('renders the BETA badge when enabled', () => {
      render(<CoachChat playerTag="PLAYER123" />);
      expect(screen.getByText('BETA')).toBeInTheDocument();
    });

    it('streams a zero-tool answer and displays the final text', async () => {
      scriptStream([
        { type: 'thread', thread_id: 'thread-1', player_tag: 'PLAYER123' },
        {
          type: 'final',
          text: 'Your trophies look good.',
          turns: 0,
          usage: { input_tokens: 10, output_tokens: 5 },
        },
      ]);

      const user = userEvent.setup();
      render(<CoachChat playerTag="PLAYER123" />);
      await waitForBetaLoaded();
      await user.type(screen.getByPlaceholderText(/ask your coach/i), 'how am i?');
      await user.click(screen.getByRole('button', { name: /send coach question/i }));

      expect(await screen.findByText(/trophies look good/i)).toBeInTheDocument();
      expect(localStorage.getItem('coach_thread_PLAYER123')).toBe('thread-1');
      expect(vi.mocked(askCoachQuestion)).not.toHaveBeenCalled();
    });

    it('renders a tool trace when the coach calls tools', async () => {
      scriptStream([
        { type: 'thread', thread_id: 'thread-2', player_tag: 'PLAYER123' },
        {
          type: 'tool_call',
          toolUseId: 'tu_1',
          name: 'get_player_profile',
          input: {},
        },
        {
          type: 'tool_result',
          toolUseId: 'tu_1',
          name: 'get_player_profile',
          isError: false,
          content: '{"tag":"PLAYER123","trophies":6000}',
          latencyMs: 42,
        },
        {
          type: 'final',
          text: 'You are at 6000 trophies.',
          turns: 1,
          usage: { input_tokens: 10, output_tokens: 5 },
        },
      ]);

      const user = userEvent.setup();
      render(<CoachChat playerTag="PLAYER123" />);
      await waitForBetaLoaded();
      await user.type(screen.getByPlaceholderText(/ask your coach/i), 'check');
      await user.click(screen.getByRole('button', { name: /send coach question/i }));

      await screen.findByText(/6000 trophies/i);
      const traceSummary = screen.getByRole('button', { name: /1 tool call/i });
      expect(traceSummary).toBeInTheDocument();
      expect(screen.getByText('get_player_profile')).toBeInTheDocument();
      expect(screen.getByText(/\(42ms\)/)).toBeInTheDocument();

      // Expand to show raw content.
      await user.click(traceSummary);
      expect(screen.getByText(/trophies":6000/)).toBeInTheDocument();
    });

    it('renders an error state for anthropic_error events', async () => {
      scriptStream([
        { type: 'thread', thread_id: 'thread-3', player_tag: 'PLAYER123' },
        { type: 'error', reason: 'anthropic_error', detail: '503' },
      ]);

      const user = userEvent.setup();
      render(<CoachChat playerTag="PLAYER123" />);
      await waitForBetaLoaded();
      await user.type(screen.getByPlaceholderText(/ask your coach/i), 'hi');
      await user.click(screen.getByRole('button', { name: /send coach question/i }));

      expect(await screen.findByText(/Coach \(error\)/i)).toBeInTheDocument();
      expect(screen.getByText(/trouble answering/i)).toBeInTheDocument();
    });

    it('reuses a persisted thread id when resuming', async () => {
      localStorage.setItem('coach_thread_PLAYER123', 'thread-existing');
      scriptStream([
        { type: 'thread', thread_id: 'thread-existing', player_tag: 'PLAYER123' },
        {
          type: 'final',
          text: 'resuming',
          turns: 0,
          usage: { input_tokens: 1, output_tokens: 1 },
        },
      ]);

      const user = userEvent.setup();
      render(<CoachChat playerTag="PLAYER123" />);
      await waitForBetaLoaded();
      await user.type(screen.getByPlaceholderText(/ask your coach/i), 'resume');
      await user.click(screen.getByRole('button', { name: /send coach question/i }));

      await waitFor(() => {
        expect(vi.mocked(streamCoachAgent)).toHaveBeenCalledOnce();
      });
      const callArgs = vi.mocked(streamCoachAgent).mock.calls[0];
      expect(callArgs[2].threadId).toBe('thread-existing');
    });

    it('clears thread state when the player tag changes', async () => {
      localStorage.setItem('coach_thread_PLAYER1', 'thread-player-1');
      localStorage.setItem('coach_thread_PLAYER2', 'thread-player-2');

      const { rerender } = render(<CoachChat playerTag="PLAYER1" />);
      rerender(<CoachChat playerTag="PLAYER2" />);

      scriptStream([
        { type: 'thread', thread_id: 'thread-player-2', player_tag: 'PLAYER2' },
        {
          type: 'final',
          text: 'ok',
          turns: 0,
          usage: { input_tokens: 1, output_tokens: 1 },
        },
      ]);

      const user = userEvent.setup();
      await waitForBetaLoaded();
      await user.type(screen.getByPlaceholderText(/ask your coach/i), 'hi');
      await user.click(screen.getByRole('button', { name: /send coach question/i }));

      await waitFor(() => {
        expect(vi.mocked(streamCoachAgent)).toHaveBeenCalledOnce();
      });
      const callArgs = vi.mocked(streamCoachAgent).mock.calls[0];
      expect(callArgs[2].threadId).toBe('thread-player-2');
    });

    it('shows a Stop button while streaming and aborts on click', async () => {
      // Never-resolving stream so we can assert the Stop button is present.
      let capturedSignal: AbortSignal | undefined;
      vi.mocked(streamCoachAgent).mockImplementation(async (_tag, _question, options) => {
        capturedSignal = options.signal;
        return new Promise<{ thread_id: string | null }>((_, reject) => {
          options.signal?.addEventListener('abort', () => {
            reject(new DOMException('aborted', 'AbortError'));
          });
        });
      });

      const user = userEvent.setup();
      render(<CoachChat playerTag="PLAYER123" />);
      await waitForBetaLoaded();
      await user.type(screen.getByPlaceholderText(/ask your coach/i), 'hi');
      await user.click(screen.getByRole('button', { name: /send coach question/i }));

      const stopButton = await screen.findByRole('button', { name: /stop coach/i });
      expect(stopButton).toBeInTheDocument();

      await user.click(stopButton);
      expect(capturedSignal?.aborted).toBe(true);
      expect(await screen.findByText(/Cancelled\./i)).toBeInTheDocument();
    });
  });

  // --- AG7 beta opt-in flow ---------------------------------------------

  describe('beta opt-in flow (AG7)', () => {
    beforeEach(() => {
      vi.stubEnv('VITE_COACH_AGENT_ENABLED', 'true');
    });

    it('shows an "Enable beta" invitation to eligible Pro users who have not opted in', async () => {
      vi.mocked(fetchCoachAgentBetaState).mockResolvedValue({
        opted_in: false,
        eligible: true,
      });
      render(<CoachChat playerTag="PLAYER123" />);
      expect(await screen.findByRole('button', { name: /enable beta/i })).toBeInTheDocument();
    });

    it('calls setCoachAgentBetaOptIn(true) when Enable beta is clicked, then switches to the "beta on" affordance', async () => {
      vi.mocked(fetchCoachAgentBetaState).mockResolvedValue({
        opted_in: false,
        eligible: true,
      });
      vi.mocked(setCoachAgentBetaOptIn).mockResolvedValue({
        opted_in: true,
        eligible: true,
      });
      const user = userEvent.setup();
      render(<CoachChat playerTag="PLAYER123" />);
      const enable = await screen.findByRole('button', { name: /enable beta/i });
      await user.click(enable);

      await waitFor(() => {
        expect(vi.mocked(setCoachAgentBetaOptIn)).toHaveBeenCalledWith(true);
      });
      expect(await screen.findByText(/Agent beta is on/i)).toBeInTheDocument();
    });

    it('sends via the legacy single-shot path when Pro user has not opted in', async () => {
      vi.mocked(fetchCoachAgentBetaState).mockResolvedValue({
        opted_in: false,
        eligible: true,
      });
      vi.mocked(askCoachQuestion).mockResolvedValue({ answer: 'legacy answer' });

      const user = userEvent.setup();
      render(<CoachChat playerTag="PLAYER123" />);
      // Wait for the opt-in invitation to appear so we know the beta
      // fetch resolved.
      await screen.findByRole('button', { name: /enable beta/i });

      await user.type(screen.getByPlaceholderText(/ask your coach/i), 'hi');
      await user.click(screen.getByRole('button', { name: /send coach question/i }));

      expect(await screen.findByText(/legacy answer/i)).toBeInTheDocument();
      expect(vi.mocked(streamCoachAgent)).not.toHaveBeenCalled();
      expect(vi.mocked(askCoachQuestion)).toHaveBeenCalledOnce();
    });

    it('lets an opted-in user disable the beta', async () => {
      vi.mocked(fetchCoachAgentBetaState).mockResolvedValue({
        opted_in: true,
        eligible: true,
      });
      vi.mocked(setCoachAgentBetaOptIn).mockResolvedValue({
        opted_in: false,
        eligible: true,
      });
      const user = userEvent.setup();
      render(<CoachChat playerTag="PLAYER123" />);
      await screen.findByText(/Agent beta is on/i);
      const disable = screen.getByRole('button', { name: /disable/i });
      await user.click(disable);
      await waitFor(() => {
        expect(vi.mocked(setCoachAgentBetaOptIn)).toHaveBeenCalledWith(false);
      });
      expect(await screen.findByRole('button', { name: /enable beta/i })).toBeInTheDocument();
    });
  });
});
