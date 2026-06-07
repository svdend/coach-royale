import { useId, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import {
  TrendingUp,
  TrendingDown,
  Minus,
  Target,
  Shield,
  Clock,
  Swords,
  BarChart3,
  Zap,
} from 'lucide-react';
import { fetchPlayerAnalytics } from '@/lib/api';
import type { PlayerState, DeckStat, MatchupStat } from '@/lib/api';

interface PlayerAnalyticsProps {
  playerTag: string;
}

function TrendIcon({ direction }: { direction: string }) {
  if (direction === 'improving') return <TrendingUp className="h-4 w-4 text-green-400" />;
  if (direction === 'declining') return <TrendingDown className="h-4 w-4 text-red-400" />;
  return <Minus className="h-4 w-4 text-yellow-400" />;
}

interface TrendSlot {
  key: 'last10' | 'last20' | 'last50' | 'overall';
  label: string;
  shortLabel: string;
  value: number | null;
}

interface ChartSlot extends TrendSlot {
  x: number;
  y: number | null;
}

interface PlottedChartSlot extends TrendSlot {
  x: number;
  y: number;
  value: number;
}

function formatWinRate(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function formatPointDelta(value: number): string {
  const rounded = Math.round(value * 100);
  return `${rounded > 0 ? '+' : ''}${rounded} pts`;
}

function getWinRateTone(value: number | null): string {
  if (value === null) return 'text-muted-foreground';
  if (value >= 0.55) return 'text-green-400';
  if (value < 0.45) return 'text-red-400';
  return 'text-foreground';
}

function getTrendSlots(state: PlayerState): TrendSlot[] {
  return [
    { key: 'last10', label: 'Last 10', shortLabel: 'L10', value: state.win_rate_last_10 },
    { key: 'last20', label: 'Last 20', shortLabel: 'L20', value: state.win_rate_last_20 },
    { key: 'last50', label: 'Last 50', shortLabel: 'L50', value: state.win_rate_last_50 },
    { key: 'overall', label: 'Overall', shortLabel: 'All', value: state.win_rate_overall },
  ];
}

function getChartDomain(values: number[]): { min: number; max: number } {
  const low = Math.min(...values);
  const high = Math.max(...values);
  const padding = Math.max(0.04, (high - low) * 0.55);

  let min = Math.max(0, low - padding);
  let max = Math.min(1, high + padding);

  if (max - min < 0.16) {
    const midpoint = (low + high) / 2;
    min = Math.max(0, midpoint - 0.08);
    max = Math.min(1, midpoint + 0.08);
  }

  return { min, max };
}

function WinRateTrendChart({ state }: { state: PlayerState }) {
  const gradientId = useId().replace(/:/g, '');
  const slots = getTrendSlots(state);
  const plottedSlots = slots.filter(
    (slot): slot is TrendSlot & { value: number } => slot.value !== null,
  );

  if (plottedSlots.length === 0) {
    return null;
  }

  const values = plottedSlots.map((slot) => slot.value);
  const { min, max } = getChartDomain(values);

  const width = 320;
  const height = 170;
  const paddingX = 12;
  const paddingTop = 10;
  const paddingBottom = 20;
  const plotWidth = width - paddingX * 2;
  const plotHeight = height - paddingTop - paddingBottom;
  const step = slots.length > 1 ? plotWidth / (slots.length - 1) : 0;
  const baselineY = paddingTop + plotHeight;

  const yForValue = (value: number): number => {
    const range = Math.max(max - min, 0.01);
    const normalized = (value - min) / range;
    return paddingTop + (1 - normalized) * plotHeight;
  };

  const chartSlots: ChartSlot[] = slots.map((slot, index) => ({
    ...slot,
    x: paddingX + index * step,
    y: slot.value === null ? null : yForValue(slot.value),
  }));

  const plottedChartSlots = chartSlots.filter(
    (slot): slot is PlottedChartSlot => slot.value !== null && slot.y !== null,
  );
  const linePath = plottedChartSlots
    .map((slot, index) => `${index === 0 ? 'M' : 'L'} ${slot.x} ${slot.y}`)
    .join(' ');

  const firstPoint = plottedChartSlots[0];
  const lastPoint = plottedChartSlots[plottedChartSlots.length - 1];
  const areaPath =
    plottedChartSlots.length > 1
      ? `${linePath} L ${lastPoint.x} ${baselineY} L ${firstPoint.x} ${baselineY} Z`
      : '';

  const peakSample = plottedSlots.reduce(
    (best, slot) => (slot.value > best.value ? slot : best),
    plottedSlots[0],
  );
  const floorSample = plottedSlots.reduce(
    (lowest, slot) => (slot.value < lowest.value ? slot : lowest),
    plottedSlots[0],
  );
  const recentDelta =
    state.win_rate_last_10 !== null ? state.win_rate_last_10 - state.win_rate_overall : null;
  const swing = values.length > 1 ? Math.max(...values) - Math.min(...values) : 0;
  const swingTone =
    swing >= 0.12 ? 'text-red-400' : swing >= 0.07 ? 'text-primary' : 'text-green-400';
  const recentTone =
    recentDelta === null
      ? 'text-foreground'
      : recentDelta >= 0.04
        ? 'text-green-400'
        : recentDelta <= -0.04
          ? 'text-red-400'
          : 'text-primary';
  const trendConfidence =
    state.trend_confidence.charAt(0).toUpperCase() + state.trend_confidence.slice(1);
  const tickValues = [max, (max + min) / 2, min];

  return (
    <div className="rounded-xl border border-primary/15 bg-gradient-to-br from-primary/8 via-transparent to-chart-5/10 p-3">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-primary/70">
            Momentum Snapshot
          </p>
          <p className="text-xs text-muted-foreground">
            Sample windows against your long-run ladder baseline.
          </p>
        </div>
        <div className="flex flex-col items-end gap-1 text-right">
          <Badge variant="secondary" className="text-xs">
            {trendConfidence} confidence
          </Badge>
          <p className="text-xs text-muted-foreground">
            Peak {peakSample.label}:{' '}
            <span className="font-semibold text-foreground">{formatWinRate(peakSample.value)}</span>
          </p>
        </div>
      </div>

      <div className="rounded-xl border border-border/50 bg-background/20 p-3">
        <svg
          role="img"
          aria-label="Win rate trend chart"
          viewBox={`0 0 ${width} ${height}`}
          className="h-40 w-full"
        >
          <title>Win rate trend chart</title>
          <defs>
            <linearGradient id={`${gradientId}-area`} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor="var(--color-primary)" stopOpacity="0.35" />
              <stop offset="100%" stopColor="var(--color-chart-5)" stopOpacity="0.03" />
            </linearGradient>
            <radialGradient id={`${gradientId}-halo`} cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="var(--color-primary)" stopOpacity="0.35" />
              <stop offset="100%" stopColor="var(--color-primary)" stopOpacity="0" />
            </radialGradient>
          </defs>

          {tickValues.map((tick, index) => {
            const y = yForValue(tick);
            return (
              <g key={`${tick}-${index}`}>
                <line
                  x1={paddingX}
                  y1={y}
                  x2={width - paddingX}
                  y2={y}
                  stroke="var(--color-border)"
                  strokeDasharray="4 4"
                  opacity="0.55"
                />
                <text
                  x={width - paddingX}
                  y={y - 6}
                  textAnchor="end"
                  fontSize="10"
                  fill="var(--color-muted-foreground)"
                >
                  {formatWinRate(tick)}
                </text>
              </g>
            );
          })}

          {areaPath && <path d={areaPath} fill={`url(#${gradientId}-area)`} />}
          {linePath && (
            <path
              d={linePath}
              fill="none"
              stroke="var(--color-primary)"
              strokeWidth="3"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          )}

          {chartSlots.map((slot) =>
            slot.value === null ? (
              <line
                key={slot.key}
                x1={slot.x - 4}
                y1={baselineY - 2}
                x2={slot.x + 4}
                y2={baselineY - 2}
                stroke="var(--color-muted-foreground)"
                strokeDasharray="2 2"
                opacity="0.65"
              />
            ) : null,
          )}

          {plottedChartSlots.map((slot, index) => (
            <g key={slot.key}>
              {index === plottedChartSlots.length - 1 && (
                <circle cx={slot.x} cy={slot.y} r="15" fill={`url(#${gradientId}-halo)`} />
              )}
              <circle
                cx={slot.x}
                cy={slot.y}
                r="4.5"
                fill="var(--color-card)"
                stroke={slot.key === 'overall' ? 'var(--color-chart-5)' : 'var(--color-primary)'}
                strokeWidth="2.5"
              />
            </g>
          ))}
        </svg>

        <div className="mt-3 grid grid-cols-4 gap-2">
          {slots.map((slot) => (
            <div
              key={slot.key}
              className="rounded-lg border border-border/40 bg-secondary/25 px-2 py-2 text-center"
            >
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                {slot.shortLabel}
              </p>
              <p className={`text-sm font-semibold ${getWinRateTone(slot.value)}`}>
                {slot.value === null ? '--' : formatWinRate(slot.value)}
              </p>
            </div>
          ))}
        </div>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2">
        <div className="rounded-lg border border-border/40 bg-secondary/30 px-3 py-2">
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
            {recentDelta !== null ? 'Recent Form' : 'Current Baseline'}
          </p>
          <p className={`text-sm font-semibold ${recentTone}`}>
            {recentDelta !== null
              ? formatPointDelta(recentDelta)
              : formatWinRate(state.win_rate_overall)}
          </p>
          <p className="text-xs text-muted-foreground">
            {recentDelta !== null ? 'Last 10 versus overall' : 'Last 10 sample unavailable'}
          </p>
        </div>
        <div className="rounded-lg border border-border/40 bg-secondary/30 px-3 py-2">
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Window Swing</p>
          <p className={`text-sm font-semibold ${swingTone}`}>{Math.round(swing * 100)} pts</p>
          <p className="text-xs text-muted-foreground">
            {plottedSlots.length > 1
              ? `${peakSample.label} to ${floorSample.label}`
              : 'Need more tracked windows'}
          </p>
        </div>
      </div>
    </div>
  );
}

function DeckDisplay({
  deck,
  label,
  labelColor,
}: {
  deck: DeckStat;
  label: string;
  labelColor: string;
}) {
  return (
    <div className="rounded-lg bg-secondary/30 p-3">
      <div className="flex items-center justify-between mb-2">
        <span className={`text-xs font-semibold ${labelColor}`}>{label}</span>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">{deck.games} games</span>
          <Badge
            className={
              deck.win_rate >= 0.55
                ? 'bg-green-500/20 text-green-400 border-green-500/30'
                : deck.win_rate < 0.45
                  ? 'bg-red-500/20 text-red-400 border-red-500/30'
                  : 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30'
            }
          >
            {Math.round(deck.win_rate * 100)}%
          </Badge>
        </div>
      </div>
      <div className="flex flex-wrap gap-1">
        {deck.cards.map((card, i) => (
          <Badge key={i} variant="secondary" className="text-xs px-1.5 py-0.5">
            {card}
          </Badge>
        ))}
      </div>
      <p className="text-xs text-muted-foreground mt-1">Confidence: {deck.confidence}</p>
    </div>
  );
}

function MatchupRow({ m }: { m: MatchupStat }) {
  const pct = Math.round(m.win_rate * 100);
  return (
    <div className="flex items-center justify-between py-1.5">
      <div className="flex-1 min-w-0">
        <p className="text-xs font-medium text-foreground truncate">{m.archetype}</p>
        <p className="text-xs text-muted-foreground">
          {m.games} games &middot; {m.confidence}
        </p>
      </div>
      <div className="flex items-center gap-2 flex-shrink-0">
        <span
          className={`text-xs font-bold ${
            pct >= 55 ? 'text-green-400' : pct < 45 ? 'text-red-400' : 'text-yellow-400'
          }`}
        >
          {pct}%
        </span>
        <span className="text-xs text-muted-foreground">{m.trend}</span>
      </div>
    </div>
  );
}

export function PlayerAnalyticsPanel({ playerTag }: PlayerAnalyticsProps) {
  const [state, setState] = useState<PlayerState | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function loadAnalytics() {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchPlayerAnalytics(playerTag);
      setState(data.player_state);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load analytics');
    } finally {
      setLoading(false);
    }
  }

  if (!state && !loading && !error) {
    return (
      <Card className="glass-card border-border/50">
        <CardContent className="p-4 text-center">
          <BarChart3 className="h-10 w-10 text-primary/40 mx-auto mb-3" />
          <h3 className="text-sm font-semibold text-foreground mb-1">Full Analytics</h3>
          <p className="text-xs text-muted-foreground mb-4">
            Deep dive into win rates, matchups, tilt analysis, and time-of-day patterns.
          </p>
          <Button
            onClick={loadAnalytics}
            className="bg-primary hover:bg-primary/80 text-primary-foreground"
          >
            <BarChart3 className="h-4 w-4 mr-2" />
            Load Analytics
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (loading) {
    return (
      <Card className="glass-card border-border/50">
        <CardContent className="p-4 space-y-3">
          <Skeleton className="h-5 w-1/3 bg-secondary" />
          <Skeleton className="h-3 w-full bg-secondary" />
          <Skeleton className="h-3 w-full bg-secondary" />
          <Skeleton className="h-3 w-full bg-secondary" />
          <Skeleton className="h-16 w-full bg-secondary" />
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card className="glass-card border-destructive/50">
        <CardContent className="p-4 text-center">
          <p className="text-sm text-destructive mb-2">{error}</p>
          <Button variant="secondary" size="sm" onClick={loadAnalytics}>
            Retry
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (!state) return null;

  const overallPct = Math.round(state.win_rate_overall * 100);

  return (
    <div className="space-y-3">
      {/* Win Rate Trend */}
      <Card className="glass-card border-border/50">
        <CardContent className="p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Target className="h-4 w-4 text-primary" />
              <h3 className="text-sm font-semibold text-foreground">Win Rate Trend</h3>
            </div>
            <div className="flex items-center gap-1.5">
              <TrendIcon direction={state.trend_direction} />
              <span className="text-xs font-medium text-foreground capitalize">
                {state.trend_direction}
              </span>
              <Badge variant="secondary" className="text-xs ml-1">
                {Math.round(state.trend_strength * 100)}% strength
              </Badge>
            </div>
          </div>
          <WinRateTrendChart state={state} />
          <Separator className="my-3" />
          <div className="flex items-center justify-between">
            <div className="text-center flex-1">
              <p className="text-lg font-bold text-foreground">{overallPct}%</p>
              <p className="text-xs text-muted-foreground">Win Rate</p>
            </div>
            <div className="text-center flex-1">
              <p className="text-lg font-bold text-foreground">{state.battles_analyzed}</p>
              <p className="text-xs text-muted-foreground">Analyzed</p>
            </div>
            <div className="text-center flex-1">
              <Badge
                className={
                  state.trophy_delta_7d > 0
                    ? 'bg-green-500/20 text-green-400 border-green-500/30'
                    : state.trophy_delta_7d < 0
                      ? 'bg-red-500/20 text-red-400 border-red-500/30'
                      : 'bg-secondary text-muted-foreground'
                }
              >
                {state.trophy_delta_7d > 0 ? '+' : ''}
                {state.trophy_delta_7d}
              </Badge>
              <p className="text-xs text-muted-foreground mt-1">7d Trophies</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Best / Worst Deck */}
      <Card className="glass-card border-border/50">
        <CardContent className="p-4">
          <div className="flex items-center gap-2 mb-3">
            <Shield className="h-4 w-4 text-blue-400" />
            <h3 className="text-sm font-semibold text-foreground">Deck Performance</h3>
            <Badge variant="secondary" className="text-xs ml-auto">
              Stability: {Math.round(state.deck_stability_score * 100)}%
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground mb-2">
            {state.unique_decks_last_20} unique decks in last 20 games
          </p>
          <div className="space-y-2">
            {state.best_deck && (
              <DeckDisplay deck={state.best_deck} label="Best Deck" labelColor="text-green-400" />
            )}
            {state.worst_deck && (
              <DeckDisplay deck={state.worst_deck} label="Worst Deck" labelColor="text-red-400" />
            )}
            {!state.best_deck && !state.worst_deck && (
              <p className="text-xs text-muted-foreground text-center py-2">
                Not enough data for deck analysis
              </p>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Matchup Table */}
      {(state.best_matchups.length > 0 || state.worst_matchups.length > 0) && (
        <Card className="glass-card border-border/50">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-3">
              <Swords className="h-4 w-4 text-primary" />
              <h3 className="text-sm font-semibold text-foreground">Matchups</h3>
            </div>
            {state.best_matchups.length > 0 && (
              <>
                <p className="text-[10px] font-semibold text-green-400 uppercase tracking-wide mb-1">
                  Best Matchups
                </p>
                {state.best_matchups.map((m, i) => (
                  <MatchupRow key={`best-${i}`} m={m} />
                ))}
              </>
            )}
            {state.best_matchups.length > 0 && state.worst_matchups.length > 0 && (
              <Separator className="my-2" />
            )}
            {state.worst_matchups.length > 0 && (
              <>
                <p className="text-[10px] font-semibold text-red-400 uppercase tracking-wide mb-1">
                  Worst Matchups
                </p>
                {state.worst_matchups.map((m, i) => (
                  <MatchupRow key={`worst-${i}`} m={m} />
                ))}
              </>
            )}
          </CardContent>
        </Card>
      )}

      {/* Tilt Analysis */}
      <Card className="glass-card border-border/50">
        <CardContent className="p-4">
          <div className="flex items-center gap-2 mb-3">
            <Zap className="h-4 w-4 text-yellow-400" />
            <h3 className="text-sm font-semibold text-foreground">Tilt Analysis</h3>
          </div>
          <div className="grid grid-cols-3 gap-3 text-center">
            <div>
              <p className="text-base font-bold text-foreground">
                {state.tilt_win_rate !== null ? `${Math.round(state.tilt_win_rate * 100)}%` : '--'}
              </p>
              <p className="text-xs text-muted-foreground">Tilt Win Rate</p>
            </div>
            <div>
              <p className="text-base font-bold text-foreground">
                {Math.round(state.baseline_win_rate * 100)}%
              </p>
              <p className="text-xs text-muted-foreground">Baseline</p>
            </div>
            <div>
              <p
                className={`text-base font-bold ${
                  state.tilt_impact !== null && state.tilt_impact < 0
                    ? 'text-red-400'
                    : 'text-foreground'
                }`}
              >
                {state.tilt_impact !== null
                  ? `${state.tilt_impact > 0 ? '+' : ''}${Math.round(state.tilt_impact * 100)}%`
                  : '--'}
              </p>
              <p className="text-xs text-muted-foreground">Impact</p>
            </div>
          </div>
          <p className="text-xs text-muted-foreground text-center mt-2">
            Confidence: {state.tilt_confidence}
          </p>
        </CardContent>
      </Card>

      {/* Time of Day */}
      {Object.keys(state.time_slot_data).length > 0 && (
        <Card className="glass-card border-border/50">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-3">
              <Clock className="h-4 w-4 text-purple-400" />
              <h3 className="text-sm font-semibold text-foreground">Time of Day</h3>
            </div>
            {state.best_time_slot && (
              <p className="text-xs text-green-400 mb-1">Best: {state.best_time_slot}</p>
            )}
            {state.worst_time_slot && (
              <p className="text-xs text-red-400 mb-2">Worst: {state.worst_time_slot}</p>
            )}
            <div className="grid grid-cols-2 gap-2">
              {Object.entries(state.time_slot_data).map(([slot, data]) => {
                const pct = Math.round(data.win_rate * 100);
                return (
                  <div key={slot} className="rounded-lg bg-secondary/30 p-2 text-center">
                    <p className="text-xs text-muted-foreground capitalize">{slot}</p>
                    <p
                      className={`text-sm font-bold ${
                        pct >= 55 ? 'text-green-400' : pct < 45 ? 'text-red-400' : 'text-yellow-400'
                      }`}
                    >
                      {pct}%
                    </p>
                    <p className="text-xs text-muted-foreground">{data.games} games</p>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Volatility */}
      <Card className="glass-card border-border/50">
        <CardContent className="p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <BarChart3 className="h-4 w-4 text-muted-foreground" />
              <span className="text-xs text-muted-foreground">Result Volatility</span>
            </div>
            <Badge
              className={
                state.result_volatility === 'high'
                  ? 'bg-red-500/20 text-red-400 border-red-500/30'
                  : state.result_volatility === 'low'
                    ? 'bg-green-500/20 text-green-400 border-green-500/30'
                    : 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30'
              }
            >
              {state.result_volatility}
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            Variance: {(state.win_rate_variance * 100).toFixed(1)}%
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
