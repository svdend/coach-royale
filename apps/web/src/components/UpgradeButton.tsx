import { useSubscription } from '@/hooks/useSubscription';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Crown, Brain, MessageSquare, Check } from 'lucide-react';

export function UpgradeButton() {
  const { user } = useAuth();
  const { isPro, upgrade, loading } = useSubscription();

  if (!user || isPro || loading) return null;

  return (
    <Card className="p-4 bg-gradient-to-r from-primary/10 to-primary/5 border-primary/30">
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Crown className="h-4 w-4 text-primary" />
            <span className="font-semibold text-sm">Upgrade to Pro</span>
            <Badge className="bg-primary text-primary-foreground text-xs">$4.99/mo</Badge>
          </div>
          <div className="flex gap-3 text-xs text-muted-foreground">
            <span className="flex items-center gap-1">
              <Brain className="h-3 w-3" /> Unlimited Deep Analysis
            </span>
            <span className="flex items-center gap-1">
              <MessageSquare className="h-3 w-3" /> Coach Chat
            </span>
          </div>
        </div>
        <Button
          size="sm"
          onClick={upgrade}
          className="bg-primary text-primary-foreground hover:bg-primary/90"
        >
          Upgrade
        </Button>
      </div>
    </Card>
  );
}

export function UpgradeCard({ feature }: { feature: string }) {
  const { user } = useAuth();
  const { upgrade } = useSubscription();

  return (
    <Card className="p-6 text-center bg-gradient-to-b from-primary/10 to-transparent border-primary/30">
      <Crown className="h-8 w-8 text-primary mx-auto mb-3" />
      <h3 className="font-bold mb-1">Unlock {feature}</h3>
      <p className="text-sm text-muted-foreground mb-4">
        Get full access to AI coaching with CoachRoyale Pro
      </p>
      <ul className="text-sm text-left space-y-2 mb-4 max-w-xs mx-auto">
        <li className="flex items-center gap-2">
          <Check className="h-4 w-4 text-primary" /> Unlimited deep analysis (Claude AI)
        </li>
        <li className="flex items-center gap-2">
          <Check className="h-4 w-4 text-primary" /> Full weekly coaching plans
        </li>
        <li className="flex items-center gap-2">
          <Check className="h-4 w-4 text-primary" /> Coach chat Q&amp;A
        </li>
        <li className="flex items-center gap-2">
          <Check className="h-4 w-4 text-primary" /> 90-day battle history
        </li>
      </ul>
      {user ? (
        <Button
          onClick={upgrade}
          className="bg-primary text-primary-foreground hover:bg-primary/90"
        >
          Upgrade to Pro — $4.99/mo
        </Button>
      ) : (
        <p className="text-xs text-muted-foreground">Sign in to upgrade</p>
      )}
    </Card>
  );
}
