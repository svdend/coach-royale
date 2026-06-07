import { BarChart3, Gauge, ShieldCheck, Swords } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { battleResult, resolvePlayerSide } from '@/lib/battles';
import type { AiUpsell, Battle, PlayerData, PlayerState } from '@/lib/api';

interface DeterministicFallbackCardProps {
  player: PlayerData;
  battles: Battle[];
  upsell: AiUpsell;
  playerState?: PlayerState | null;
}

interface BattleSummary {
  draws: number;
  losses: number;
  sampleSize: number;
  winRate: number | null;
  wins: number;
}

function formatPercent(value: number | null): string {
  return value === null ? 'Not enough data' : `${Math.round(value * 100)}%`;
}

function formatSigned(value: number): string {
  return value > 0 ? `+${value}` : `${value}`;
}

function summarizeBattles(playerTag: string, battles: Battle[]): BattleSummary {
  const results = battles
    .slice(0, 10)
    .map((battle) => resolvePlayerSide(battle, playerTag))
    .filter((sides): sides is NonNullable<typeof sides> => sides !== null)
    .map(battleResult);

  const wins = results.filter((result) => result === 'victory').length;
  const losses = results.filter((result) => result === 'defeat').length;
  const draws = results.filter((result) => result === 'draw').length;
  const decisiveGames = wins + losses;

  return {
    draws,
    losses,
    sampleSize: results.length,
    winRate: decisiveGames > 0 ? wins / decisiveGames : null,
    wins,
  };
}

function lifetimeWinRate(player: PlayerData): number | null {
  const games = player.wins + player.losses;
  return games > 0 ? player.wins / games : null;
}

function recentWinRate(
  player: PlayerData,
  battles: Battle[],
  playerState?: PlayerState | null,
): number | null {
  if (playerState?.win_rate_last_10 !== undefined && playerState.win_rate_last_10 !== null) {
    return playerState.win_rate_last_10;
  }

  return summarizeBattles(player.tag, battles).winRate ?? lifetimeWinRate(player);
}

function fallbackGuidance(winRate: number | null, playerState?: PlayerState | null): string {
  if (winRate === null) {
    return 'Load or sync recent battles to unlock a stronger non-AI trend read.';
  }

  if (winRate < 0.45) {
    return 'Stabilize first: review recent losses before changing decks again.';
  }

  if (winRate >= 0.55) {
    return 'Momentum is positive: keep the deck stable and isolate one matchup to improve.';
  }

  if ((playerState?.unique_decks_last_20 ?? 0) > 3) {
    return 'Your recent deck rotation looks noisy; limit swaps before judging performance.';
  }

  return 'Performance is near baseline; use matchup and deck panels below to pick one focused drill.';
}

export function DeterministicFallbackCard({
  player,
  battles,
  upsell,
  playerState = null,
}: DeterministicFallbackCardProps) {
  const summary = summarizeBattles(player.tag, battles);
  const winRate = recentWinRate(player, battles, playerState);
  const analyzedCount = playerState?.battles_analyzed ?? summary.sampleSize;
  const trophyDelta = playerState?.trophy_delta_7d;
  const deckSignal =
    playerState && playerState.unique_decks_last_20 > 0
      ? `${playerState.unique_decks_last_20} decks / last 20`
      : `${player.currentDeck.length} cards loaded`;
  const reason =
    upsell.reason === 'pool_exhausted'
      ? 'The shared free AI pool is busy.'
      : "Today's free AI coaching limit is reached.";

  return (
    <Card
      aria-label="Deterministic analytics fallback"
      className="glass-card border-sky-500/30 bg-gradient-to-br from-sky-500/12 via-card/70 to-transparent"
    >
      <CardContent className="space-y-4 p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <BarChart3 className="h-4 w-4 text-sky-400" />
              <h3 className="text-sm font-semibold text-foreground">
                Deterministic analytics fallback
              </h3>
              <Badge variant="secondary" className="text-[10px] uppercase tracking-wide">
                No model call used
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground">
              {reason} Showing a rule-based summary from current Supercell player and battle data
              instead.
            </p>
          </div>
          <Badge className="w-fit bg-sky-500/15 text-sky-300 ring-1 ring-inset ring-sky-500/30">
            Upsell remains available
          </Badge>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-xl border border-border/50 bg-background/25 p-3">
            <div className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              <Gauge className="h-3.5 w-3.5" />
              Win signal
            </div>
            <p className="text-xl font-bold text-foreground">{formatPercent(winRate)}</p>
            <p className="mt-1 text-[11px] text-muted-foreground">
              {summary.sampleSize > 0
                ? `${summary.wins}W-${summary.losses}L-${summary.draws}D in recent sample`
                : 'Using lifetime record until battle sample is available'}
            </p>
          </div>

          <div className="rounded-xl border border-border/50 bg-background/25 p-3">
            <div className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              <ShieldCheck className="h-3.5 w-3.5" />
              Player state
            </div>
            <p className="text-xl font-bold text-foreground">{player.trophies.toLocaleString()}</p>
            <p className="mt-1 text-[11px] text-muted-foreground">
              {trophyDelta === undefined
                ? `${player.bestTrophies.toLocaleString()} best trophies`
                : `${formatSigned(trophyDelta)} trophies over 7 days`}
            </p>
          </div>

          <div className="rounded-xl border border-border/50 bg-background/25 p-3">
            <div className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              <Swords className="h-3.5 w-3.5" />
              Deck signal
            </div>
            <p className="text-xl font-bold text-foreground">{analyzedCount}</p>
            <p className="mt-1 text-[11px] text-muted-foreground">{deckSignal}</p>
          </div>
        </div>

        <div className="rounded-xl border border-sky-500/20 bg-sky-500/8 p-3">
          <p className="text-sm font-medium text-foreground">
            {fallbackGuidance(winRate, playerState)}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Use the full analytics panel below for deck, matchup, tilt, and time-window details
            while the AI lane is capped.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
