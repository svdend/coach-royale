import { Suspense, lazy, useState, useEffect, useCallback, useRef, type ReactNode } from 'react';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { SearchBar } from '@/components/SearchBar';
import { PlayerHeader } from '@/components/PlayerHeader';
import { StatsPanel } from '@/components/StatsPanel';
import { BattleLog } from '@/components/BattleLog';
import { AuthButton } from '@/components/AuthButton';
import {
  PlayerHeaderSkeleton,
  StatsPanelSkeleton,
  BattleLogSkeleton,
} from '@/components/LoadingState';
import { fetchPlayer, fetchBattleLog } from '@/lib/api';
import type { PlayerData, Battle } from '@/lib/api';
import { useAuth } from '@/hooks/useAuth';
import { useSubscription } from '@/hooks/useSubscription';
import { Crown, BarChart3, Brain, RefreshCw } from 'lucide-react';
import { UpgradeButton } from '@/components/UpgradeButton';
import { syncPlayer } from '@/lib/api';
import { supabase } from '@/lib/supabase';
import { Toaster, toast } from 'sonner';

const STORAGE_KEY = 'declaw_last_tag';
const AnalysisPanel = lazy(() =>
  import('@/components/AnalysisPanel').then((module) => ({ default: module.AnalysisPanel })),
);
const AnalysisHistory = lazy(() =>
  import('@/components/AnalysisHistory').then((module) => ({ default: module.AnalysisHistory })),
);
const CoachChat = lazy(() =>
  import('@/components/CoachChat').then((module) => ({ default: module.CoachChat })),
);
const PrivacyCenter = lazy(() =>
  import('@/components/PrivacyCenter').then((module) => ({ default: module.PrivacyCenter })),
);
const TrackedPlayers = lazy(() =>
  import('@/components/TrackedPlayers').then((module) => ({ default: module.TrackedPlayers })),
);
const WeeklyPlanPanel = lazy(() =>
  import('@/components/WeeklyPlan').then((module) => ({ default: module.WeeklyPlanPanel })),
);

function DeferredSection({ children, fallback }: { children: ReactNode; fallback: ReactNode }) {
  return <Suspense fallback={fallback}>{children}</Suspense>;
}

function CardPlaceholder({ message }: { message: string }) {
  return (
    <div className="rounded-xl border border-border/50 bg-card/40 p-4 text-sm text-muted-foreground">
      {message}
    </div>
  );
}

function App() {
  const [player, setPlayer] = useState<PlayerData | null>(null);
  const [battles, setBattles] = useState<Battle[]>([]);
  const [loading, setLoading] = useState(false);
  const [battlesLoading, setBattlesLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currentTag, setCurrentTag] = useState('');
  const [activeTab, setActiveTab] = useState('overview');

  const [syncing, setSyncing] = useState(false);

  const { user, loading: authLoading, refreshProfile } = useAuth();
  const { refresh: refreshSubscription } = useSubscription();

  const hasBootstrappedSearchRef = useRef(false);
  const activeSearchControllerRef = useRef<AbortController | null>(null);
  const [savedTag] = useState(() =>
    typeof window !== 'undefined' ? (localStorage.getItem(STORAGE_KEY) ?? '') : '',
  );

  const persistSearchToCloud = useCallback(async (tag: string) => {
    try {
      await syncPlayer(tag);
    } catch (error) {
      console.error('Failed to sync player search:', error);
    }
  }, []);

  const handleSyncPlayer = useCallback(async () => {
    if (!currentTag || syncing) return;
    setSyncing(true);
    try {
      const data = await syncPlayer(currentTag);
      toast.success(`Synced ${currentTag}`, {
        description: `${data.battles_synced} battle${data.battles_synced === 1 ? '' : 's'} refreshed from Supercell.`,
      });
    } catch {
      toast.error('Sync failed', {
        description: 'The latest profile data could not be refreshed right now.',
      });
    } finally {
      setSyncing(false);
    }
  }, [currentTag, syncing]);

  const handleSearch = useCallback(
    async (tag: string) => {
      activeSearchControllerRef.current?.abort();
      const controller = new AbortController();
      activeSearchControllerRef.current = controller;

      setLoading(true);
      setBattlesLoading(false);
      setError(null);
      setPlayer(null);
      setBattles([]);
      setActiveTab('overview');

      const normalizedTag = tag.trim().toUpperCase();
      setCurrentTag(normalizedTag);

      try {
        localStorage.setItem(STORAGE_KEY, normalizedTag);
      } catch {
        // localStorage might be unavailable
      }

      try {
        const playerData = await fetchPlayer(normalizedTag, controller.signal);
        if (controller.signal.aborted || activeSearchControllerRef.current !== controller) return;
        setPlayer(playerData);
        setLoading(false);

        // Fetch battles in background
        setBattlesLoading(true);
        try {
          const nextBattles = await fetchBattleLog(normalizedTag, controller.signal);
          if (!controller.signal.aborted && activeSearchControllerRef.current === controller) {
            setBattles(nextBattles);
          }
        } catch (error) {
          if (
            controller.signal.aborted ||
            (error instanceof DOMException && error.name === 'AbortError')
          ) {
            return;
          }
          // Battles failing shouldn't block the UI
        } finally {
          if (!controller.signal.aborted && activeSearchControllerRef.current === controller) {
            setBattlesLoading(false);
          }
        }

        if (controller.signal.aborted || activeSearchControllerRef.current !== controller) return;
        const {
          data: { session },
        } = await supabase.auth.getSession();
        if (
          session?.user &&
          !controller.signal.aborted &&
          activeSearchControllerRef.current === controller
        ) {
          await persistSearchToCloud(normalizedTag);
        }
      } catch (err) {
        if (
          controller.signal.aborted ||
          (err instanceof DOMException && err.name === 'AbortError')
        ) {
          return;
        }
        setError(err instanceof Error ? err.message : 'Failed to load player');
        setLoading(false);
      } finally {
        if (activeSearchControllerRef.current === controller) {
          activeSearchControllerRef.current = null;
        }
      }
    },
    [persistSearchToCloud],
  );

  // Post-checkout: Lemon redirect + Supabase profile + subscription context
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('upgraded') !== 'true') return;

    void (async () => {
      await refreshProfile();
      await refreshSubscription();
      toast.success('Welcome to Pro', {
        description: 'Your subscription is active and Pro features are now unlocked.',
      });
      const url = new URL(window.location.href);
      url.searchParams.delete('upgraded');
      window.history.replaceState({}, '', url.pathname + url.search);
    })();
  }, [refreshProfile, refreshSubscription]);

  // Auto-load the last searched tag only after auth state is known so the
  // restored-session path is deterministic and does not need a backfill pass.
  useEffect(() => {
    if (authLoading || hasBootstrappedSearchRef.current || !savedTag) return;
    hasBootstrappedSearchRef.current = true;
    void handleSearch(savedTag);
  }, [authLoading, handleSearch, savedTag]);

  useEffect(
    () => () => {
      activeSearchControllerRef.current?.abort();
    },
    [],
  );

  const sections = [
    {
      value: 'overview',
      label: 'Overview',
      description: 'Stats and recent battles',
      icon: BarChart3,
    },
    {
      value: 'analysis',
      label: 'Analysis',
      description: 'AI reports and analytics',
      icon: Brain,
    },
    {
      value: 'coach',
      label: 'Coach',
      description: 'Weekly plan and live chat',
      icon: Crown,
    },
  ] as const;

  return (
    <div className="min-h-dvh bg-background">
      <Toaster
        position="top-center"
        richColors
        closeButton
        theme="dark"
        toastOptions={{
          classNames: {
            toast: 'border border-border/60 bg-card/95 text-foreground shadow-2xl',
            description: 'text-muted-foreground',
            actionButton: 'bg-primary text-primary-foreground',
            cancelButton: 'bg-secondary text-secondary-foreground',
          },
        }}
      />
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_top,_rgba(212,175,55,0.12),_transparent_30%),radial-gradient(circle_at_bottom_right,_rgba(59,130,246,0.08),_transparent_30%)]" />
      {/* Header */}
      <header className="sticky-blur sticky top-0 z-50 border-b border-border/50 bg-background/80">
        <div className="mx-auto max-w-7xl px-4 py-4 lg:px-6">
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2">
                    <Crown className="h-6 w-6 text-primary" />
                    <h1 className="text-xl font-bold gold-text">CoachRoyale</h1>
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Clash Royale coaching, battle review, and AI-assisted planning.
                  </p>
                </div>
                <div className="flex items-center gap-2 xl:hidden">
                  {player && (
                    <button
                      onClick={handleSyncPlayer}
                      disabled={syncing}
                      className="rounded-lg p-1.5 transition-colors hover:bg-secondary/50 disabled:opacity-50"
                      title="Sync latest battles"
                    >
                      <RefreshCw
                        className={`h-4 w-4 text-muted-foreground ${syncing ? 'animate-spin' : ''}`}
                      />
                    </button>
                  )}
                  <AuthButton />
                </div>
              </div>
              <div className="grid gap-3 xl:min-w-[32rem] xl:grid-cols-[minmax(0,1fr)_auto] xl:items-center">
                <SearchBar onSearch={handleSearch} isLoading={loading} initialTag={savedTag} />
                <div className="hidden items-center justify-end gap-2 xl:flex">
                  {player && (
                    <button
                      onClick={handleSyncPlayer}
                      disabled={syncing}
                      className="rounded-lg p-1.5 transition-colors hover:bg-secondary/50 disabled:opacity-50"
                      title="Sync latest battles"
                    >
                      <RefreshCw
                        className={`h-4 w-4 text-muted-foreground ${syncing ? 'animate-spin' : ''}`}
                      />
                    </button>
                  )}
                  <AuthButton />
                </div>
              </div>
            </div>
            {(player || currentTag) && (
              <div className="hidden rounded-2xl border border-border/50 bg-card/40 px-4 py-3 md:flex md:items-center md:justify-between">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                    Active Session
                  </p>
                  <p className="text-sm text-foreground">
                    {player ? `${player.name} · ${player.tag}` : `Tracking ${currentTag}`}
                  </p>
                </div>
                {player && (
                  <div className="flex items-center gap-6 text-right">
                    <div>
                      <p className="text-lg font-semibold text-foreground">{player.trophies}</p>
                      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
                        Trophies
                      </p>
                    </div>
                    <div>
                      <p className="text-lg font-semibold text-foreground">{battles.length}</p>
                      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
                        Recent Battles
                      </p>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </header>

      {/* Main content */}
      <main className="relative mx-auto max-w-7xl px-4 py-6 pb-10 lg:px-6">
        <div className="grid gap-6 lg:grid-cols-[230px_minmax(0,1fr)] xl:grid-cols-[230px_minmax(0,1fr)_320px]">
          <aside className="hidden lg:flex lg:flex-col lg:gap-4">
            <div className="rounded-3xl border border-border/50 bg-card/60 p-4 shadow-[0_20px_60px_rgba(0,0,0,0.25)]">
              <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                Command Deck
              </p>
              <div className="mt-3">
                <p className="text-lg font-semibold text-foreground">
                  {player ? player.name : 'No player loaded'}
                </p>
                <p className="text-sm text-muted-foreground">
                  {player ? player.tag : 'Search for a tag to open stats, coaching, and analysis.'}
                </p>
              </div>
              {player && (
                <div className="mt-4 grid grid-cols-2 gap-2">
                  <div className="rounded-2xl border border-border/50 bg-background/60 p-3">
                    <p className="text-lg font-semibold text-foreground">{player.trophies}</p>
                    <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
                      Trophies
                    </p>
                  </div>
                  <div className="rounded-2xl border border-border/50 bg-background/60 p-3">
                    <p className="text-lg font-semibold text-foreground">{battles.length}</p>
                    <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
                      Battles
                    </p>
                  </div>
                </div>
              )}
              <nav className="mt-4 space-y-2" aria-label="Primary section navigation">
                {sections.map((section) => {
                  const Icon = section.icon;
                  const isActive = activeTab === section.value;
                  return (
                    <button
                      key={section.value}
                      type="button"
                      onClick={() => setActiveTab(section.value)}
                      disabled={!player}
                      className={`flex w-full items-start gap-3 rounded-2xl border px-3 py-3 text-left transition-colors ${
                        isActive
                          ? 'border-primary/40 bg-primary/10 text-foreground'
                          : 'border-border/50 bg-background/40 text-muted-foreground hover:border-primary/20 hover:bg-card/80 hover:text-foreground'
                      } disabled:cursor-not-allowed disabled:opacity-50`}
                    >
                      <Icon className="mt-0.5 h-4 w-4 shrink-0" />
                      <div>
                        <p className="text-sm font-semibold">{section.label}</p>
                        <p className="text-[11px] leading-4 text-muted-foreground">
                          {section.description}
                        </p>
                      </div>
                    </button>
                  );
                })}
              </nav>
            </div>
            {user && !player && (
              <DeferredSection fallback={<CardPlaceholder message="Loading saved players..." />}>
                <TrackedPlayers onSelectPlayer={handleSearch} />
              </DeferredSection>
            )}
          </aside>

          <section className="min-w-0 space-y-4">
            {user && (
              <div className="xl:hidden">
                <DeferredSection
                  fallback={<CardPlaceholder message="Loading privacy controls..." />}
                >
                  <PrivacyCenter userId={user.id} />
                </DeferredSection>
              </div>
            )}

            {/* Tracked Players (only when logged in) */}
            {!player && !loading && !error && (
              <div className="lg:hidden">
                <DeferredSection fallback={<CardPlaceholder message="Loading saved players..." />}>
                  <TrackedPlayers onSelectPlayer={handleSearch} />
                </DeferredSection>
              </div>
            )}

            {/* Error state */}
            {error && (
              <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-center">
                <p className="text-sm font-medium text-destructive">{error}</p>
                <p className="mt-1 text-xs text-destructive/70">Check the tag and try again</p>
              </div>
            )}

            {/* Loading state */}
            {loading && (
              <div className="space-y-4">
                <PlayerHeaderSkeleton />
                <StatsPanelSkeleton />
              </div>
            )}

            {/* Player data */}
            {player && !loading && (
              <div className="space-y-4">
                <PlayerHeader player={player} />

                <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full lg:hidden">
                  <TabsList className="sticky-blur grid h-12 w-full grid-cols-3 border border-border/50 bg-secondary/50">
                    {sections.map((section) => {
                      const Icon = section.icon;
                      return (
                        <TabsTrigger
                          key={section.value}
                          value={section.value}
                          className="h-10 gap-1.5 text-sm font-medium data-[state=active]:bg-primary data-[state=active]:text-primary-foreground"
                        >
                          <Icon className="h-4 w-4" />
                          {section.label}
                        </TabsTrigger>
                      );
                    })}
                  </TabsList>
                </Tabs>

                {!loading && (
                  <div className="xl:hidden">
                    <UpgradeButton />
                  </div>
                )}

                {activeTab === 'overview' && (
                  <div className="grid min-h-[32.5rem] gap-4 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
                    <StatsPanel player={player} />
                    {battlesLoading ? (
                      <BattleLogSkeleton />
                    ) : (
                      <BattleLog battles={battles} playerTag={currentTag} />
                    )}
                  </div>
                )}

                {activeTab === 'analysis' && (
                  <DeferredSection fallback={<StatsPanelSkeleton />}>
                    <div className="min-h-[32.5rem] space-y-4">
                      <AnalysisPanel player={player} battles={battles} />
                      <div className="xl:hidden">
                        <AnalysisHistory playerTag={currentTag} />
                      </div>
                    </div>
                  </DeferredSection>
                )}

                {activeTab === 'coach' && (
                  <DeferredSection fallback={<StatsPanelSkeleton />}>
                    <div className="grid min-h-[32.5rem] gap-4 xl:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
                      <WeeklyPlanPanel playerTag={currentTag} />
                      <CoachChat playerTag={currentTag} />
                    </div>
                  </DeferredSection>
                )}
              </div>
            )}

            {/* Empty state */}
            {!player && !loading && !error && (
              <div className="rounded-[2rem] border border-border/50 bg-card/40 px-6 py-16 text-center shadow-[0_20px_60px_rgba(0,0,0,0.2)]">
                <Crown className="mx-auto mb-4 h-16 w-16 text-primary/30" />
                <h2 className="mb-2 text-lg font-semibold text-foreground/70">
                  Search for a Player
                </h2>
                <p className="mx-auto max-w-md text-sm text-muted-foreground">
                  Enter a Clash Royale player tag above to open the full review surface: stats,
                  recent battles, AI analysis, and a coaching plan tailored to that account.
                </p>
              </div>
            )}
          </section>

          <aside className="hidden xl:flex xl:min-w-0 xl:flex-col xl:gap-4">
            {player && !loading && <UpgradeButton />}
            {user && (
              <DeferredSection fallback={<CardPlaceholder message="Loading privacy controls..." />}>
                <PrivacyCenter userId={user.id} />
              </DeferredSection>
            )}
            {player ? (
              <DeferredSection fallback={<CardPlaceholder message="Loading past analyses..." />}>
                <AnalysisHistory playerTag={currentTag} />
              </DeferredSection>
            ) : (
              user && (
                <DeferredSection fallback={<CardPlaceholder message="Loading saved players..." />}>
                  <TrackedPlayers onSelectPlayer={handleSearch} />
                </DeferredSection>
              )
            )}
          </aside>
        </div>
      </main>
    </div>
  );
}

export default App;
