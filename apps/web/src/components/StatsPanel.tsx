import { Card, CardContent } from '@/components/ui/card';
import { Trophy, Swords, Crown, Shield, Medal, CreditCard, Heart, ArrowUpDown } from 'lucide-react';
import type { PlayerData } from '@/lib/api';
import type { LucideIcon } from 'lucide-react';

interface StatCardProps {
  icon: LucideIcon;
  label: string;
  value: string | number;
  subtitle?: string;
  iconColor?: string;
}

function StatCard({
  icon: Icon,
  label,
  value,
  subtitle,
  iconColor = 'text-primary',
}: StatCardProps) {
  return (
    <Card className="glass-card border-border/50">
      <CardContent className="p-4">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
            <Icon className={`h-5 w-5 ${iconColor}`} />
          </div>
          <div className="text-left min-w-0">
            <p className="text-xs text-muted-foreground uppercase tracking-wider">{label}</p>
            <p className="text-lg font-bold text-foreground truncate">
              {typeof value === 'number' ? value.toLocaleString() : value}
            </p>
            {subtitle && <p className="text-xs text-muted-foreground">{subtitle}</p>}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

interface StatsPanelProps {
  player: PlayerData;
}

export function StatsPanel({ player }: StatsPanelProps) {
  const winRate =
    player.wins + player.losses > 0
      ? ((player.wins / (player.wins + player.losses)) * 100).toFixed(1)
      : '0.0';

  const totalCards = player.cards?.length ?? 0;

  return (
    <div className="grid grid-cols-2 gap-3">
      <StatCard
        icon={Trophy}
        label="Trophies"
        value={player.trophies}
        subtitle={`Best: ${player.bestTrophies.toLocaleString()}`}
      />
      <StatCard
        icon={Swords}
        label="Win Rate"
        value={`${winRate}%`}
        subtitle={`${player.wins.toLocaleString()}W / ${player.losses.toLocaleString()}L`}
      />
      <StatCard
        icon={Crown}
        label="Three Crowns"
        value={player.threeCrownWins}
        iconColor="text-primary"
      />
      <StatCard icon={Shield} label="War Wins" value={player.warDayWins} iconColor="text-chart-5" />
      <StatCard
        icon={Medal}
        label="Challenge Best"
        value={`${player.challengeMaxWins} wins`}
        subtitle={`${player.challengeCardsWon.toLocaleString()} cards won`}
      />
      <StatCard icon={CreditCard} label="Cards Found" value={totalCards} />
      <StatCard
        icon={Heart}
        label="Donations"
        value={player.donations}
        subtitle={`Received: ${player.donationsReceived.toLocaleString()}`}
      />
      <StatCard icon={ArrowUpDown} label="Total Battles" value={player.battleCount} />
    </div>
  );
}
