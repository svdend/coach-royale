import { useAuth } from '@/hooks/useAuth';
import { getTrackedPlayers, removeTrackedPlayer, syncPlayer } from '@/lib/api';
import type { TrackedPlayer } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Star, Trash2, Search } from 'lucide-react';
import { toast } from 'sonner';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '@/lib/queryKeys';

interface Props {
  onSelectPlayer: (tag: string) => void;
}

export function TrackedPlayers({ onSelectPlayer }: Props) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const trackedKey = queryKeys.trackedPlayers();

  const query = useQuery({
    queryKey: trackedKey,
    queryFn: () => getTrackedPlayers(),
    enabled: Boolean(user),
  });

  const removeMutation = useMutation({
    mutationFn: (id: string) => removeTrackedPlayer(id),
    onSuccess: (_, id) => {
      queryClient.setQueryData<TrackedPlayer[]>(trackedKey, (prev) =>
        prev ? prev.filter((p) => p.id !== id) : [],
      );
    },
  });

  async function handleRemove(id: string) {
    const players = query.data ?? [];
    const removedPlayer = players.find((player) => player.id === id);
    try {
      await removeMutation.mutateAsync(id);
      if (removedPlayer) {
        const playerLabel = removedPlayer.player_name || removedPlayer.player_tag;
        toast.success(`Removed ${playerLabel}`, {
          description: 'Saved player removed from this account.',
          duration: 6000,
          action: {
            label: 'Undo',
            onClick: () => {
              void (async () => {
                try {
                  await syncPlayer(removedPlayer.player_tag);
                  await queryClient.invalidateQueries({ queryKey: trackedKey });
                  toast.success(`Restored ${playerLabel}`);
                } catch (restoreError) {
                  console.error('Failed to restore tracked player:', restoreError);
                  toast.error('Failed to restore the saved player. Try syncing again.');
                }
              })();
            },
          },
        });
      }
    } catch (e) {
      console.error('Failed to remove tracked player:', e);
      toast.error('Failed to remove the saved player. Try again.');
      await queryClient.invalidateQueries({ queryKey: trackedKey });
    }
  }

  if (!user) return null;
  if (query.isPending) {
    return (
      <Card className="glass-card border-border/50 p-4 text-sm text-muted-foreground">
        Loading saved players…
      </Card>
    );
  }
  if (query.isError) {
    return (
      <Card className="glass-card border-border/50 p-4 text-sm text-destructive" role="alert">
        Failed to load saved players. Try again.
      </Card>
    );
  }

  const players = query.data ?? [];

  if (players.length === 0) {
    return (
      <Card className="glass-card border-border/50 p-4 text-sm text-muted-foreground">
        No saved players yet. Search a tag while signed in to add one.
      </Card>
    );
  }

  return (
    <Card className="glass-card border-border/50">
      <div className="border-b border-border/50 px-4 py-3">
        <h3 className="text-sm font-semibold text-foreground">Saved players</h3>
        <p className="text-xs text-muted-foreground">Jump back to tracked accounts.</p>
      </div>
      <ul className="divide-y divide-border/50">
        {players.map((player) => {
          const label = player.player_name || player.player_tag;
          const primary = player.is_primary;
          return (
            <li key={player.id} className="flex items-center justify-between gap-3 px-4 py-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  {primary ? (
                    <Star className="h-4 w-4 shrink-0 fill-amber-400 text-amber-400" aria-hidden />
                  ) : null}
                  <div className="truncate text-sm font-medium text-foreground">{label}</div>
                </div>
                <div className="truncate text-xs text-muted-foreground">{player.player_tag}</div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  onClick={() => onSelectPlayer(player.player_tag)}
                  aria-label={`View ${primary ? 'primary ' : ''}saved player ${label}`}
                >
                  <Search className="mr-1 h-4 w-4" />
                  View
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => void handleRemove(player.id)}
                  disabled={removeMutation.isPending}
                  aria-label={`Remove saved player ${label}`}
                >
                  <Trash2 className="h-4 w-4 text-muted-foreground" />
                </Button>
              </div>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
