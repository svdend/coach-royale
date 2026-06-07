import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/hooks/useAuth';
import { getAnalysisHistory } from '@/lib/api';
import { queryKeys } from '@/lib/queryKeys';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Brain, Zap, Clock } from 'lucide-react';

interface Props {
  playerTag?: string;
}

const HISTORY_LIMIT = 10;

export function AnalysisHistory({ playerTag }: Props) {
  const { user } = useAuth();
  const [expanded, setExpanded] = useState<string | null>(null);

  const query = useQuery({
    queryKey: queryKeys.analysisHistory(playerTag, HISTORY_LIMIT),
    queryFn: () => getAnalysisHistory(playerTag, HISTORY_LIMIT),
    enabled: Boolean(user),
  });

  function formatRecordedAt(dateStr: string): string {
    const d = new Date(dateStr);
    return d.toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  const typeLabel: Record<string, string> = {
    quick_stats: 'Quick Stats',
    deck_tips: 'Deck Tips',
    battle_summary: 'Battle Summary',
    deep_analysis: 'Deep Analysis',
  };

  const typeIcon: Record<string, typeof Brain> = {
    quick_stats: Zap,
    deck_tips: Zap,
    battle_summary: Zap,
    deep_analysis: Brain,
  };

  if (!user) return null;
  if (query.isPending) {
    return (
      <div className="space-y-2 mt-4">
        <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wider">
          Past Analyses
        </h3>
        <p role="status" className="text-sm text-muted-foreground">
          Loading past analyses...
        </p>
      </div>
    );
  }
  if (query.isError) {
    return (
      <div className="space-y-2 mt-4">
        <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wider">
          Past Analyses
        </h3>
        <p role="alert" className="text-sm text-destructive">
          Failed to load past analyses. Try again.
        </p>
      </div>
    );
  }

  const history = query.data ?? [];
  if (history.length === 0) return null;

  return (
    <div className="space-y-2 mt-4">
      <h3
        id="analysis-history-heading"
        className="text-sm font-medium text-muted-foreground uppercase tracking-wider"
      >
        Past Analyses
      </h3>
      <ul aria-labelledby="analysis-history-heading" className="space-y-2">
        {history.map((h) => {
          const Icon = typeIcon[h.analysis_type] || Brain;
          const isExpanded = expanded === h.id;
          const buttonId = `analysis-history-toggle-${h.id}`;
          const regionId = `analysis-history-panel-${h.id}`;

          return (
            <li key={h.id}>
              <Card className="bg-card/50 p-0">
                <button
                  id={buttonId}
                  type="button"
                  className="w-full rounded-xl p-3 text-left transition-colors hover:bg-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                  onClick={() => setExpanded(isExpanded ? null : h.id)}
                  aria-expanded={isExpanded}
                  aria-controls={regionId}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-2">
                      <Icon aria-hidden="true" className="w-4 h-4 text-primary flex-shrink-0" />
                      <Badge variant="secondary" className="text-xs">
                        {typeLabel[h.analysis_type] || h.analysis_type}
                      </Badge>
                      <span className="truncate text-xs text-muted-foreground">{h.player_tag}</span>
                    </div>
                    <div className="flex items-center gap-1 text-xs text-muted-foreground">
                      <Clock aria-hidden="true" className="w-3 h-3" />
                      <time dateTime={h.created_at}>{formatRecordedAt(h.created_at)}</time>
                    </div>
                  </div>
                </button>
                {isExpanded && (
                  <div
                    id={regionId}
                    role="region"
                    aria-labelledby={buttonId}
                    className="border-t border-border px-3 pb-3 pt-3 text-sm whitespace-pre-wrap"
                  >
                    {h.result}
                  </div>
                )}
              </Card>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
