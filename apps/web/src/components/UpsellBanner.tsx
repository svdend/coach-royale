import { Crown, Gauge } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { useAuth } from '@/hooks/useAuth';
import { useSubscription } from '@/hooks/useSubscription';
import type { AiUpsell } from '@/lib/api';

export function UpsellBanner({ upsell }: { upsell: AiUpsell }) {
  const { user } = useAuth();
  const { upgrade } = useSubscription();
  const reason =
    upsell.reason === 'pool_exhausted'
      ? 'The shared free AI pool is busy right now.'
      : "You reached today's free AI coaching limit.";

  return (
    <Card className="glass-card border-primary/35 bg-gradient-to-r from-primary/15 via-primary/8 to-transparent">
      <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <div className="rounded-full bg-primary/15 p-2 text-primary">
            {upsell.reason === 'pool_exhausted' ? (
              <Gauge className="h-4 w-4" />
            ) : (
              <Crown className="h-4 w-4" />
            )}
          </div>
          <div>
            <p className="text-sm font-semibold text-foreground">{reason}</p>
            <p className="text-xs text-muted-foreground">{upsell.cta}</p>
          </div>
        </div>
        {user ? (
          <Button
            size="sm"
            onClick={upgrade}
            className="bg-primary text-primary-foreground hover:bg-primary/90"
          >
            Upgrade to Pro
          </Button>
        ) : (
          <p className="text-xs text-muted-foreground">Sign in to upgrade.</p>
        )}
      </CardContent>
    </Card>
  );
}
