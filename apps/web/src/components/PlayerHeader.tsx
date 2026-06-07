import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Trophy, Shield, Swords } from 'lucide-react';
import type { PlayerData } from '@/lib/api';
import { SafeImage } from '@/components/SafeImage';

interface PlayerHeaderProps {
  player: PlayerData;
}

export function PlayerHeader({ player }: PlayerHeaderProps) {
  return (
    <Card className="glass-card border-border/50 overflow-hidden">
      <CardContent className="p-4 sm:p-6">
        {/* Name and level row */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-xl bg-primary/20 border border-primary/30 flex items-center justify-center">
              <span className="text-xl font-bold gold-text">{player.expLevel}</span>
            </div>
            <div className="text-left">
              <h2 className="text-xl font-bold text-foreground">{player.name}</h2>
              <p className="text-sm text-muted-foreground font-mono">{player.tag}</p>
            </div>
          </div>
          {player.arena && (
            <Badge variant="secondary" className="text-xs">
              {player.arena.name}
            </Badge>
          )}
        </div>

        {/* Clan and trophies row */}
        <div className="flex items-center gap-4 mb-4 flex-wrap">
          {player.clan && (
            <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
              <Shield className="h-4 w-4 text-primary" />
              <span>{player.clan.name}</span>
            </div>
          )}
          <div className="flex items-center gap-1.5">
            <Trophy className="h-5 w-5 text-primary" />
            <span className="text-lg font-bold gold-text">{player.trophies.toLocaleString()}</span>
          </div>
          <div className="text-sm text-muted-foreground">
            Best: {player.bestTrophies.toLocaleString()}
          </div>
        </div>

        {/* Current deck */}
        <div>
          <div className="flex items-center gap-2 mb-2">
            <Swords className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm text-muted-foreground font-medium">Current Deck</span>
          </div>
          <div className="grid grid-cols-8 gap-1.5">
            {player.currentDeck.map((card) => (
              <div
                key={card.id}
                className="relative aspect-square rounded-lg overflow-hidden bg-secondary/50 border border-border/50 group"
                title={card.name}
              >
                <SafeImage
                  src={card.iconUrls.medium}
                  alt={card.name}
                  className="w-full h-full object-cover transition-transform group-hover:scale-110"
                  loading="eager"
                  fetchPriority="high"
                  fallbackClassName="bg-secondary/70"
                />
                <div className="absolute bottom-0 left-0 right-0 bg-black/60 text-center">
                  <span className="text-xs font-bold text-primary">Lv.{card.level}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
