import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Clock } from 'lucide-react';
import type { Battle } from '@/lib/api';
import { resolvePlayerSide, battleResult } from '@/lib/battles';
import { SafeImage } from '@/components/SafeImage';

function timeAgo(battleTime: string): string {
  // Clash Royale API format: "20240101T120000.000Z"
  const cleaned = battleTime.replace(
    /(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})/,
    '$1-$2-$3T$4:$5:$6',
  );
  const date = new Date(cleaned);
  const now = new Date();
  const seconds = Math.floor((now.getTime() - date.getTime()) / 1000);

  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  if (seconds < 604800) return `${Math.floor(seconds / 86400)}d ago`;
  return `${Math.floor(seconds / 604800)}w ago`;
}

interface BattleCardProps {
  battle: Battle;
  playerTag: string;
}

function BattleCard({ battle, playerTag }: BattleCardProps) {
  const sides = resolvePlayerSide(battle, playerTag);
  if (!sides) return null;
  const { player, opponent } = sides;

  const result = battleResult(sides);
  const isVictory = result === 'victory';
  const isDraw = result === 'draw';

  const playerCrowns = player.crowns;
  const opponentCrowns = opponent.crowns;

  const trophyChange = player.trophyChange;

  const resultLabel = isDraw ? 'Draw' : isVictory ? 'Victory' : 'Defeat';
  const resultColor = isDraw ? 'text-muted-foreground' : isVictory ? 'text-victory' : 'text-defeat';
  const resultBg = isDraw
    ? 'bg-muted/50'
    : isVictory
      ? 'bg-victory/10 border-victory/20'
      : 'bg-defeat/10 border-defeat/20';

  return (
    <Card className={`glass-card border ${resultBg} transition-all`}>
      <CardContent className="p-3 sm:p-4">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <span className={`text-sm font-bold ${resultColor}`}>{resultLabel}</span>
            <span className="text-lg font-bold text-foreground">
              {playerCrowns} - {opponentCrowns}
            </span>
          </div>
          <div className="flex items-center gap-2">
            {trophyChange != null && (
              <Badge
                variant="secondary"
                className={`text-xs font-mono ${
                  trophyChange > 0
                    ? 'text-victory'
                    : trophyChange < 0
                      ? 'text-defeat'
                      : 'text-muted-foreground'
                }`}
              >
                {trophyChange > 0 ? `+${trophyChange}` : trophyChange}
              </Badge>
            )}
            <div className="flex items-center gap-1 text-xs text-muted-foreground">
              <Clock className="h-3 w-3" />
              {timeAgo(battle.battleTime)}
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between mb-2">
          <div className="text-sm">
            <span className="text-muted-foreground">vs </span>
            <span className="font-medium text-foreground">{opponent.name}</span>
          </div>
          <Badge variant="outline" className="text-xs text-muted-foreground border-border/50">
            {battle.gameMode?.name ?? 'Unknown mode'}
          </Badge>
        </div>

        {/* Deck icons */}
        <div className="flex gap-1">
          {player.cards.slice(0, 8).map((card) => (
            <div
              key={card.id}
              className="w-7 h-7 sm:w-8 sm:h-8 rounded overflow-hidden bg-secondary/50 border border-border/30"
              title={card.name}
            >
              <SafeImage
                src={card.iconUrls.medium}
                alt={card.name}
                className="w-full h-full object-cover"
                loading="lazy"
                fetchPriority="low"
                fallbackClassName="bg-secondary/70"
              />
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

interface BattleLogProps {
  battles: Battle[];
  playerTag: string;
}

export function BattleLog({ battles, playerTag }: BattleLogProps) {
  if (battles.length === 0) {
    return <div className="text-center py-12 text-muted-foreground">No recent battles found.</div>;
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wider">
          Recent Battles
        </h3>
        <span className="text-xs text-muted-foreground">{battles.length} battles</span>
      </div>
      <Separator className="bg-border/50" />
      {battles.slice(0, 25).map((battle, index) => (
        <BattleCard key={`${battle.battleTime}-${index}`} battle={battle} playerTag={playerTag} />
      ))}
    </div>
  );
}
