import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

export function PlayerHeaderSkeleton() {
  return (
    <Card className="glass-card border-border/50">
      <CardContent className="p-4 sm:p-6">
        <div className="flex items-center gap-3 mb-4">
          <Skeleton className="w-12 h-12 rounded-xl bg-secondary" />
          <div className="space-y-2">
            <Skeleton className="h-5 w-32 bg-secondary" />
            <Skeleton className="h-3 w-20 bg-secondary" />
          </div>
        </div>
        <div className="flex gap-4 mb-4">
          <Skeleton className="h-5 w-24 bg-secondary" />
          <Skeleton className="h-5 w-20 bg-secondary" />
        </div>
        <div className="grid grid-cols-8 gap-1.5">
          {Array.from({ length: 8 }).map((_, i) => (
            <div
              key={i}
              className="overflow-hidden rounded-lg border border-border/50 bg-secondary/30"
            >
              <Skeleton className="aspect-square rounded-none bg-secondary" />
              <Skeleton className="h-3 w-full rounded-none bg-secondary/80" />
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

export function StatsPanelSkeleton() {
  return (
    <div className="grid grid-cols-2 gap-3">
      {Array.from({ length: 8 }).map((_, i) => (
        <Card key={i} className="glass-card border-border/50">
          <CardContent className="p-4">
            <div className="flex items-start gap-3">
              <Skeleton className="w-10 h-10 rounded-lg bg-secondary" />
              <div className="space-y-2 flex-1">
                <Skeleton className="h-3 w-16 bg-secondary" />
                <Skeleton className="h-5 w-20 bg-secondary" />
              </div>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

export function BattleLogSkeleton() {
  return (
    <div className="space-y-3">
      {Array.from({ length: 5 }).map((_, i) => (
        <Card key={i} className="glass-card border-border/50">
          <CardContent className="p-3 sm:p-4">
            <div className="flex justify-between mb-2">
              <div className="flex items-center gap-2">
                <Skeleton className="h-4 w-16 bg-secondary" />
                <Skeleton className="h-5 w-12 bg-secondary" />
              </div>
              <Skeleton className="h-4 w-16 bg-secondary" />
            </div>
            <Skeleton className="h-4 w-32 mb-2 bg-secondary" />
            <div className="flex gap-1">
              {Array.from({ length: 8 }).map((_, j) => (
                <Skeleton key={j} className="w-7 h-7 sm:w-8 sm:h-8 rounded bg-secondary" />
              ))}
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
