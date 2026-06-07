import { Suspense, lazy, useState, useCallback, useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Separator } from '@/components/ui/separator';
import { Brain, Zap, Swords, BarChart3, MessageSquare, RefreshCw } from 'lucide-react';
import {
  fetchQuickAnalysis,
  fetchExperimentalDeepAnalysis,
  fetchDeepAnalysis,
  fetchCustomModelAnalysis,
  saveAnalysisHistory,
  syncPlayer,
} from '@/lib/api';
import type { PlayerData, Battle, AiUpsell, PlayerState } from '@/lib/api';
import { useAuth } from '@/hooks/useAuth';
import { useSubscription } from '@/hooks/useSubscription';
import { canUse, incrementUsage, getRemainingUses } from '@/lib/usage';
import { UpgradeCard } from '@/components/UpgradeButton';
import { UpsellBanner } from '@/components/UpsellBanner';
import { DeterministicFallbackCard } from '@/components/DeterministicFallbackCard';
import { ModelConfigPanel } from '@/components/ModelConfigPanel';
import { getModelConfig } from '@/lib/modelConfig';
import { toast } from 'sonner';

interface AnalysisPanelProps {
  player: PlayerData;
  battles?: Battle[];
}

type QuickType = 'quick_stats' | 'deck_tips' | 'battle_summary';

const quickOptions: { type: QuickType; label: string; icon: typeof Zap; prompt: string }[] = [
  {
    type: 'quick_stats',
    label: 'Quick Stats',
    icon: BarChart3,
    prompt:
      "Analyze this player's key statistics and highlight notable achievements or areas for improvement.",
  },
  {
    type: 'deck_tips',
    label: 'Deck Tips',
    icon: Swords,
    prompt: "Analyze the player's current deck and suggest improvements or strategies.",
  },
  {
    type: 'battle_summary',
    label: 'Battle Summary',
    icon: MessageSquare,
    prompt: "Summarize the player's recent battle performance and trends.",
  },
];

const FREE_QUICK_LIMIT = 5;
const FREE_DEEP_LIMIT = 1;
const MarkdownSafe = lazy(() =>
  import('@/components/MarkdownSafe').then((module) => ({ default: module.MarkdownSafe })),
);
const PlayerAnalyticsPanel = lazy(() =>
  import('@/components/PlayerAnalytics').then((module) => ({
    default: module.PlayerAnalyticsPanel,
  })),
);

function SectionPlaceholder({ message }: { message: string }) {
  return (
    <div className="rounded-xl border border-border/50 bg-card/40 p-4 text-sm text-muted-foreground">
      {message}
    </div>
  );
}

export function AnalysisPanel({ player, battles = [] }: AnalysisPanelProps) {
  const [result, setResult] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [activeType, setActiveType] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [upsell, setUpsell] = useState<AiUpsell | null>(null);
  const [fallbackPlayerState, setFallbackPlayerState] = useState<PlayerState | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [isExperimental, setIsExperimental] = useState(false);
  const [customConfig, setCustomConfig] = useState(() => getModelConfig());
  const customAnalysisControllerRef = useRef<AbortController | null>(null);
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const { isPro, limits, usageToday, refresh, loading: subscriptionLoading } = useSubscription();

  const refreshCustomConfig = useCallback(() => {
    setCustomConfig(getModelConfig());
  }, []);

  const quickLimit = isPro ? limits.quick_analysis : FREE_QUICK_LIMIT;
  const deepLimit = isPro ? limits.deep_analysis : FREE_DEEP_LIMIT;

  const quickRemaining = (() => {
    if (isPro) return quickLimit;
    if (user && usageToday) {
      return Math.max(0, quickLimit - usageToday.quick_analysis);
    }
    if (user && subscriptionLoading) {
      return quickLimit;
    }
    return getRemainingUses('quick_analysis', quickLimit);
  })();

  const deepRemaining = (() => {
    if (isPro) return deepLimit;
    if (user && usageToday) {
      return Math.max(0, deepLimit - usageToday.deep_analysis);
    }
    if (user && subscriptionLoading) {
      return deepLimit;
    }
    return getRemainingUses('deep_analysis', deepLimit);
  })();

  useEffect(
    () => () => {
      customAnalysisControllerRef.current?.abort();
    },
    [],
  );

  async function handleSync() {
    setSyncing(true);
    try {
      const data = await syncPlayer(player.tag);
      toast.success(`Synced ${player.tag}`, {
        description: `Updated the profile and ${data.battles_synced} recent battle${data.battles_synced === 1 ? '' : 's'}.`,
      });
    } catch (err) {
      toast.error('Sync failed', {
        description: err instanceof Error ? err.message : 'Sync failed',
      });
    } finally {
      setSyncing(false);
    }
  }

  async function handleQuickAnalysis(option: (typeof quickOptions)[0]) {
    if (!user && !canUse('quick_analysis', quickLimit)) {
      setError('Daily limit reached. Resets at midnight.');
      return;
    }

    setLoading(true);
    setActiveType(option.type);
    setError(null);
    setUpsell(null);
    setFallbackPlayerState(null);
    setResult(null);
    setIsExperimental(false);
    try {
      const data = await fetchQuickAnalysis(
        option.prompt,
        player as unknown as Record<string, unknown>,
        option.type,
        {
          analysisScope: 'quick',
          playerTag: player.tag,
        },
      );
      if (data.upsell) {
        setUpsell(data.upsell);
        setFallbackPlayerState(data.player_state ?? null);
        return;
      }
      const response = data.result.response;
      setResult(response);

      if (!isPro) {
        if (user) {
          await refresh();
        } else {
          incrementUsage('quick_analysis');
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Quick analysis failed');
    } finally {
      setLoading(false);
    }
  }

  async function handleDeepAnalysis() {
    if (!user && !canUse('deep_analysis', deepLimit)) {
      setError('Daily limit reached for Deep Analysis. Come back tomorrow!');
      return;
    }
    setLoading(true);
    setActiveType('deep');
    setError(null);
    setUpsell(null);
    setFallbackPlayerState(null);
    setResult(null);
    setIsExperimental(true);
    try {
      const data = await fetchExperimentalDeepAnalysis(
        player as unknown as Record<string, unknown>,
        battles as unknown as Record<string, unknown>[],
      );
      if (data.upsell) {
        setUpsell(data.upsell);
        setFallbackPlayerState(data.player_state ?? null);
        return;
      }
      const analysis = data.result.response;
      setResult(analysis);
      if (!isPro) {
        if (user) {
          await refresh();
        } else {
          incrementUsage('deep_analysis');
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Experimental deep analysis failed');
    } finally {
      setLoading(false);
    }
  }

  async function handleProDeepAnalysis() {
    setLoading(true);
    setActiveType('pro_deep');
    setError(null);
    setUpsell(null);
    setFallbackPlayerState(null);
    setResult(null);
    setIsExperimental(false);
    try {
      const data = await fetchDeepAnalysis(player.tag);
      if (data.upsell) {
        setUpsell(data.upsell);
        setFallbackPlayerState(data.player_state ?? null);
        return;
      }
      setResult(data.analysis);

      if (user && !isPro) {
        await refresh();
      }

      if (user) {
        saveAnalysisHistory({
          player_tag: player.tag,
          analysis_type: 'deep_analysis',
          result: data.analysis,
          model: 'claude-pro',
        })
          .then(() =>
            queryClient.invalidateQueries({
              queryKey: ['analysis-history', player.tag],
            }),
          )
          .catch((e) => console.error('Failed to save analysis:', e));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Deep analysis failed');
    } finally {
      setLoading(false);
    }
  }

  async function handleCustomModelAnalysis() {
    if (!customConfig) return;
    customAnalysisControllerRef.current?.abort();
    const controller = new AbortController();
    customAnalysisControllerRef.current = controller;
    setLoading(true);
    setActiveType('custom');
    setError(null);
    setUpsell(null);
    setFallbackPlayerState(null);
    setResult(null);
    setIsExperimental(true);
    try {
      const text = await fetchCustomModelAnalysis(
        customConfig,
        player as unknown as Record<string, unknown>,
        battles as unknown as Record<string, unknown>[],
        controller.signal,
      );
      if (controller.signal.aborted || customAnalysisControllerRef.current !== controller) {
        return;
      }
      setResult(text);

      if (user) {
        saveAnalysisHistory({
          player_tag: player.tag,
          analysis_type: 'deep_analysis',
          result: text,
          model: customConfig.model,
        })
          .then(() =>
            queryClient.invalidateQueries({
              queryKey: ['analysis-history', player.tag],
            }),
          )
          .catch((e) => console.error('Failed to save analysis:', e));
      }
    } catch (err) {
      if (controller.signal.aborted || (err instanceof DOMException && err.name === 'AbortError')) {
        return;
      }
      setError(err instanceof Error ? err.message : 'Custom model analysis failed');
    } finally {
      if (customAnalysisControllerRef.current === controller) {
        customAnalysisControllerRef.current = null;
        setLoading(false);
      }
    }
  }

  function handleCancelCustomModelAnalysis() {
    customAnalysisControllerRef.current?.abort();
  }

  return (
    <div className="space-y-4">
      {/* Sync Button */}
      <Card className="glass-card border-border/50">
        <CardContent className="p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <RefreshCw className={`h-4 w-4 text-primary ${syncing ? 'animate-spin' : ''}`} />
              <div>
                <h3 className="text-sm font-semibold text-foreground">Sync Data</h3>
                <p className="text-xs text-muted-foreground">
                  Pull latest battles from Supercell API
                </p>
              </div>
            </div>
            <Button
              variant="secondary"
              size="sm"
              onClick={handleSync}
              disabled={syncing}
              className="h-8 min-w-[7rem] justify-center tabular-nums"
            >
              <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${syncing ? 'animate-spin' : ''}`} />
              {syncing ? 'Syncing...' : 'Sync'}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Quick analysis buttons */}
      <Card className="glass-card border-border/50">
        <CardContent className="p-4">
          <div className="flex items-center gap-2 mb-3">
            <Zap className="h-4 w-4 text-primary" />
            <h3 className="text-sm font-semibold text-foreground">Quick Analysis</h3>
            <span className="text-xs text-muted-foreground">
              {isPro ? '(unlimited)' : `(${quickRemaining}/${quickLimit} remaining today)`}
            </span>
          </div>
          <div className="grid grid-cols-3 gap-2">
            {quickOptions.map((option) => {
              const Icon = option.icon;
              return (
                <Button
                  key={option.type}
                  variant="secondary"
                  className={`h-auto py-3 px-2 flex flex-col items-center gap-1.5 text-xs ${
                    activeType === option.type && loading ? 'ring-2 ring-primary/50' : ''
                  }`}
                  onClick={() => handleQuickAnalysis(option)}
                  disabled={loading || (!isPro && quickRemaining <= 0)}
                >
                  <Icon className="h-5 w-5" />
                  <span>{option.label}</span>
                </Button>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* Pro Deep Analysis (Claude AI) */}
      {isPro ? (
        <Card className="glass-card border-primary/30">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-3">
              <Brain className="h-4 w-4 text-primary" />
              <h3 className="text-sm font-semibold text-foreground">Deep Analysis</h3>
              <span className="inline-flex items-center rounded-md bg-primary/20 px-1.5 py-0.5 text-xs font-bold text-primary ring-1 ring-inset ring-primary/30">
                PRO
              </span>
            </div>
            <Button
              className="w-full h-12 border bg-primary/10 hover:bg-primary/20 text-primary border-primary/30"
              onClick={handleProDeepAnalysis}
              disabled={loading}
            >
              <Brain className="h-5 w-5 mr-2" />
              {loading && activeType === 'pro_deep'
                ? 'Analyzing...'
                : 'Run Deep Analysis (Claude AI)'}
            </Button>
            <p className="text-xs text-muted-foreground mt-2">
              Powered by Claude AI &mdash; Unlimited with Pro
            </p>
          </CardContent>
        </Card>
      ) : (
        <UpgradeCard feature="Deep Analysis" />
      )}

      {/* Experimental deep analysis (backend AI worker) */}
      <Card className="glass-card border-amber-500/30">
        <CardContent className="p-4">
          <div className="flex items-center gap-2 mb-3">
            <Brain className="h-4 w-4 text-amber-500" />
            <h3 className="text-sm font-semibold text-foreground">Deep Analysis (Experimental)</h3>
            <span className="inline-flex items-center rounded-md bg-amber-500/20 px-1.5 py-0.5 text-xs font-bold text-amber-500 ring-1 ring-inset ring-amber-500/30">
              BETA
            </span>
          </div>
          <Button
            className={`w-full h-12 border ${
              isPro || deepRemaining > 0
                ? 'bg-amber-500/10 hover:bg-amber-500/20 text-amber-500 border-amber-500/30'
                : 'bg-secondary text-muted-foreground border-border/50 cursor-not-allowed'
            }`}
            onClick={handleDeepAnalysis}
            disabled={loading || (!isPro && deepRemaining <= 0)}
          >
            <Brain className="h-5 w-5 mr-2" />
            {loading && activeType === 'deep'
              ? 'Analyzing...'
              : !isPro && deepRemaining <= 0
                ? 'Daily limit reached'
                : 'Run Deep Analysis (Beta)'}
          </Button>
          <p className="text-xs text-muted-foreground mt-2">
            Powered by backend AI worker &mdash;{' '}
            {isPro ? 'unlimited' : `${deepRemaining}/${deepLimit} remaining today`}
          </p>
        </CardContent>
      </Card>

      {/* Custom model config + analysis */}
      <ModelConfigPanel onConfigChange={refreshCustomConfig} />

      {customConfig && (
        <Card className="glass-card border-violet-500/30">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-3">
              <Brain className="h-4 w-4 text-violet-400" />
              <h3 className="text-sm font-semibold text-foreground">Custom Model Analysis</h3>
            </div>
            <p className="text-[11px] text-muted-foreground mb-3 truncate">
              {customConfig.model} &middot; {customConfig.baseUrl}
            </p>
            <Button
              className="w-full h-12 border bg-violet-500/10 hover:bg-violet-500/20 text-violet-400 border-violet-500/30"
              onClick={
                loading && activeType === 'custom'
                  ? handleCancelCustomModelAnalysis
                  : handleCustomModelAnalysis
              }
              disabled={loading && activeType !== 'custom'}
            >
              <Brain className="h-5 w-5 mr-2" />
              {loading && activeType === 'custom'
                ? 'Cancel Custom Run'
                : `Run with ${customConfig.model}`}
            </Button>
            <p className="text-xs text-muted-foreground mt-2">
              Browser-direct BYOK path. The request and API key stay in this browser and go straight
              to your provider.
            </p>
          </CardContent>
        </Card>
      )}

      {/* Loading state */}
      {loading && (
        <Card className="glass-card border-border/50">
          <CardContent className="p-4 space-y-3">
            <Skeleton className="h-4 w-3/4 bg-secondary" />
            <Skeleton className="h-4 w-full bg-secondary" />
            <Skeleton className="h-4 w-5/6 bg-secondary" />
            <Skeleton className="h-4 w-2/3 bg-secondary" />
            <Skeleton className="h-4 w-full bg-secondary" />
            <Skeleton className="h-4 w-4/5 bg-secondary" />
          </CardContent>
        </Card>
      )}

      {/* Error */}
      {error && (
        <Card className="glass-card border-destructive/50">
          <CardContent className="p-4 text-sm text-destructive" role="alert">
            {error}
          </CardContent>
        </Card>
      )}

      {upsell && !loading && <UpsellBanner upsell={upsell} />}

      {upsell && !loading && (
        <DeterministicFallbackCard
          player={player}
          battles={battles}
          upsell={upsell}
          playerState={fallbackPlayerState}
        />
      )}

      {/* Result */}
      {result && !loading && (
        <Card
          className={`glass-card ${isExperimental ? 'border-amber-500/20' : 'border-primary/20'}`}
        >
          <CardContent className="p-4">
            {isExperimental && (
              <div className="flex items-center gap-1.5 mb-3">
                <span className="inline-flex items-center rounded-md bg-amber-500/20 px-1.5 py-0.5 text-xs font-bold text-amber-500 ring-1 ring-inset ring-amber-500/30">
                  {activeType === 'custom' ? 'Custom Model' : 'Experimental'}
                </span>
                <span className="text-xs text-muted-foreground">
                  {activeType === 'custom' && customConfig
                    ? `Powered by ${customConfig.model}`
                    : 'Powered by backend AI worker'}
                </span>
              </div>
            )}
            <Suspense fallback={<SectionPlaceholder message="Loading formatted result..." />}>
              <MarkdownSafe>{result}</MarkdownSafe>
            </Suspense>
          </CardContent>
        </Card>
      )}

      <Separator />

      {/* Full Analytics */}
      <Suspense fallback={<SectionPlaceholder message="Loading analytics tools..." />}>
        <PlayerAnalyticsPanel playerTag={player.tag} />
      </Suspense>
    </div>
  );
}
