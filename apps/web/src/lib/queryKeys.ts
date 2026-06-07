/** Central query keys for TanStack Query (prefix-friendly). */
export const queryKeys = {
  trackedPlayers: () => ['tracked-players'] as const,
  analysisHistory: (playerTag: string | undefined, limit: number) =>
    ['analysis-history', playerTag ?? null, limit] as const,
  privacySettings: (userId: string) => ['privacy-settings', userId] as const,
};
