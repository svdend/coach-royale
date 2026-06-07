import { useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Target,
  Shield,
  Zap,
  Swords,
  TrendingUp,
  TrendingDown,
  Minus,
  RefreshCw,
  AlertTriangle,
  CheckCircle,
} from 'lucide-react';
import { fetchWeeklyPlan } from '@/lib/api';
import type { WeeklyPlan as WeeklyPlanType } from '@/lib/api';
import { useSubscription } from '@/hooks/useSubscription';
import { UpgradeCard } from '@/components/UpgradeButton';

interface WeeklyPlanProps {
  playerTag: string;
}

function VerdictBadge({ verdict }: { verdict: string }) {
  const lower = verdict.toLowerCase();
  if (lower.includes('improv')) {
    return (
      <Badge className="bg-green-500/20 text-green-400 border-green-500/30 gap-1">
        <TrendingUp className="h-3 w-3" />
        {verdict}
      </Badge>
    );
  }
  if (lower.includes('plateau') || lower.includes('stable')) {
    return (
      <Badge className="bg-yellow-500/20 text-yellow-400 border-yellow-500/30 gap-1">
        <Minus className="h-3 w-3" />
        {verdict}
      </Badge>
    );
  }
  return (
    <Badge className="bg-red-500/20 text-red-400 border-red-500/30 gap-1">
      <TrendingDown className="h-3 w-3" />
      {verdict}
    </Badge>
  );
}

export function WeeklyPlanPanel({ playerTag }: WeeklyPlanProps) {
  const [plan, setPlan] = useState<WeeklyPlanType | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fromCache, setFromCache] = useState(false);
  const { isPro } = useSubscription();

  async function loadPlan(force = false) {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchWeeklyPlan(playerTag, force);
      setPlan(data.plan);
      setFromCache(data.from_cache);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load weekly plan');
    } finally {
      setLoading(false);
    }
  }

  if (!plan && !loading && !error) {
    return (
      <Card className="glass-card border-border/50">
        <CardContent className="p-4 text-center">
          <Target className="h-10 w-10 text-primary/40 mx-auto mb-3" />
          <h3 className="text-sm font-semibold text-foreground mb-1">Weekly Coaching Plan</h3>
          <p className="text-xs text-muted-foreground mb-4">
            Get a personalized weekly training plan based on your recent performance.
          </p>
          <Button
            onClick={() => loadPlan()}
            disabled={loading}
            className="bg-primary hover:bg-primary/80 text-primary-foreground"
          >
            <Target className="h-4 w-4 mr-2" />
            Generate Plan
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (loading) {
    return (
      <Card className="glass-card border-border/50">
        <CardContent className="p-4 space-y-3">
          <Skeleton className="h-5 w-1/2 bg-secondary" />
          <Skeleton className="h-4 w-full bg-secondary" />
          <Skeleton className="h-4 w-3/4 bg-secondary" />
          <Skeleton className="h-20 w-full bg-secondary" />
          <Skeleton className="h-4 w-5/6 bg-secondary" />
          <Skeleton className="h-4 w-2/3 bg-secondary" />
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card className="glass-card border-destructive/50">
        <CardContent className="p-4 text-center">
          <p className="text-sm text-destructive mb-2">{error}</p>
          <Button variant="secondary" size="sm" onClick={() => loadPlan()}>
            Retry
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (!plan) return null;

  return (
    <div className="space-y-3">
      {/* Header + Summary (visible preview) */}
      <Card className="glass-card border-border/50">
        <CardContent className="p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Target className="h-4 w-4 text-primary" />
              <h3 className="text-sm font-semibold text-foreground">Weekly Plan</h3>
            </div>
            <div className="flex items-center gap-2">
              {fromCache && <span className="text-xs text-muted-foreground">cached</span>}
              <Button
                variant="ghost"
                size="sm"
                className="h-7 w-7 p-0"
                onClick={() => loadPlan(true)}
                disabled={loading}
              >
                <RefreshCw className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>
          <VerdictBadge verdict={plan.performance_verdict} />
          <p className="text-sm text-foreground/80 mt-3 leading-relaxed">{plan.coaching_summary}</p>
        </CardContent>
      </Card>

      {/* Pro-gated content */}
      {isPro ? (
        <div className="space-y-3">
          {/* Top Priority - Gold accent */}
          <Card className="glass-card border-primary/40 bg-primary/5">
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-2">
                <Zap className="h-4 w-4 text-primary" />
                <h3 className="text-sm font-semibold gold-text">Top Priority</h3>
              </div>
              <h4 className="text-base font-bold text-foreground mb-1">
                {plan.top_priority.title}
              </h4>
              <p className="text-sm text-foreground/80 mb-2">{plan.top_priority.description}</p>
              <p className="text-xs text-muted-foreground italic">
                Evidence: {plan.top_priority.evidence}
              </p>
              <p className="text-xs text-primary mt-1">
                Expected impact: {plan.top_priority.expected_impact}
              </p>
            </CardContent>
          </Card>

          {/* Weekly Goals */}
          {plan.weekly_goals.length > 0 && (
            <Card className="glass-card border-border/50">
              <CardContent className="p-4">
                <div className="flex items-center gap-2 mb-3">
                  <CheckCircle className="h-4 w-4 text-green-400" />
                  <h3 className="text-sm font-semibold text-foreground">Weekly Goals</h3>
                </div>
                <div className="space-y-3">
                  {plan.weekly_goals.map((g, i) => (
                    <div key={i} className="flex items-start gap-2">
                      <div className="h-5 w-5 rounded border border-border/60 mt-0.5 flex-shrink-0" />
                      <div>
                        <p className="text-sm font-medium text-foreground">{g.goal}</p>
                        <p className="text-xs text-muted-foreground">
                          Metric: {g.metric} &mdash; {g.how}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Drills */}
          {plan.drills.length > 0 && (
            <Card className="glass-card border-border/50">
              <CardContent className="p-4">
                <div className="flex items-center gap-2 mb-3">
                  <Swords className="h-4 w-4 text-chart-5" />
                  <h3 className="text-sm font-semibold text-foreground">Training Drills</h3>
                </div>
                <div className="space-y-3">
                  {plan.drills.map((d, i) => (
                    <div key={i}>
                      <p className="text-sm font-medium text-foreground">{d.name}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {d.description} ({d.sessions_per_day}x/day)
                      </p>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Deck Recommendation */}
          <Card className="glass-card border-border/50">
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-2">
                <Shield className="h-4 w-4 text-blue-400" />
                <h3 className="text-sm font-semibold text-foreground">Deck Recommendation</h3>
              </div>
              <Badge className="mb-2">{plan.deck_recommendation.verdict}</Badge>
              <p className="text-sm text-foreground/80 mt-2">
                {plan.deck_recommendation.reasoning}
              </p>
              {plan.deck_recommendation.suggested_swap && (
                <p className="text-xs text-primary mt-2">
                  Suggested swap: {plan.deck_recommendation.suggested_swap}
                </p>
              )}
            </CardContent>
          </Card>

          {/* Matchup Alerts */}
          {plan.matchup_alerts.length > 0 && (
            <Card className="glass-card border-border/50">
              <CardContent className="p-4">
                <div className="flex items-center gap-2 mb-3">
                  <AlertTriangle className="h-4 w-4 text-yellow-400" />
                  <h3 className="text-sm font-semibold text-foreground">Matchup Alerts</h3>
                </div>
                <div className="space-y-2">
                  {plan.matchup_alerts.map((m, i) => (
                    <div key={i} className="flex items-start gap-2">
                      <span className="text-xs font-mono text-red-400 mt-0.5">
                        {Math.round(m.win_rate * 100)}%
                      </span>
                      <div>
                        <p className="text-sm font-medium text-foreground">vs {m.archetype}</p>
                        <p className="text-xs text-muted-foreground">{m.tip}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      ) : (
        <div className="relative">
          {/* Blurred content behind overlay */}
          <div className="space-y-3 select-none pointer-events-none" aria-hidden="true">
            <Card className="glass-card border-primary/40 bg-primary/5 blur-[6px]">
              <CardContent className="p-4">
                <div className="flex items-center gap-2 mb-2">
                  <Zap className="h-4 w-4 text-primary" />
                  <h3 className="text-sm font-semibold gold-text">Top Priority</h3>
                </div>
                <h4 className="text-base font-bold text-foreground mb-1">
                  {plan.top_priority.title}
                </h4>
                <p className="text-sm text-foreground/80 mb-2">{plan.top_priority.description}</p>
              </CardContent>
            </Card>

            {plan.weekly_goals.length > 0 && (
              <Card className="glass-card border-border/50 blur-[6px]">
                <CardContent className="p-4">
                  <div className="flex items-center gap-2 mb-3">
                    <CheckCircle className="h-4 w-4 text-green-400" />
                    <h3 className="text-sm font-semibold text-foreground">Weekly Goals</h3>
                  </div>
                  <div className="space-y-3">
                    {plan.weekly_goals.slice(0, 2).map((g, i) => (
                      <div key={i} className="flex items-start gap-2">
                        <div className="h-5 w-5 rounded border border-border/60 mt-0.5 flex-shrink-0" />
                        <div>
                          <p className="text-sm font-medium text-foreground">{g.goal}</p>
                          <p className="text-xs text-muted-foreground">Metric: {g.metric}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}
          </div>

          {/* Upgrade overlay */}
          <div className="absolute inset-0 flex flex-col items-center justify-center rounded-xl bg-background/60 backdrop-blur-sm border border-border/30">
            <UpgradeCard feature="Full Weekly Plan" />
          </div>
        </div>
      )}

      {/* Tilt Note - still visible as a teaser */}
      {plan.tilt_note && (
        <Card className="glass-card border-yellow-500/30 bg-yellow-500/5">
          <CardContent className="p-4">
            <div className="flex items-start gap-2">
              <AlertTriangle className="h-4 w-4 text-yellow-400 mt-0.5 flex-shrink-0" />
              <div>
                <h3 className="text-sm font-semibold text-yellow-400 mb-1">Tilt Warning</h3>
                <p className="text-xs text-foreground/80">{plan.tilt_note}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Confidence Builders - still visible as a teaser */}
      {plan.confidence_builders.length > 0 && (
        <Card className="glass-card border-border/50">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-3">
              <TrendingUp className="h-4 w-4 text-green-400" />
              <h3 className="text-sm font-semibold text-foreground">Confidence Builders</h3>
            </div>
            <ul className="space-y-1.5">
              {plan.confidence_builders.map((cb, i) => (
                <li key={i} className="flex items-start gap-2 text-xs text-foreground/80">
                  <span className="text-green-400 mt-0.5">+</span>
                  {cb}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
