const STORAGE_PREFIX = 'coachroyale_usage_';

interface DailyUsage {
  date: string; // YYYY-MM-DD
  quick_analysis: number;
  deep_analysis: number;
}

function getTodayKey(): string {
  return new Date().toISOString().split('T')[0];
}

function getUsage(): DailyUsage {
  const today = getTodayKey();
  const stored = localStorage.getItem(`${STORAGE_PREFIX}${today}`);
  if (stored) return JSON.parse(stored);
  return { date: today, quick_analysis: 0, deep_analysis: 0 };
}

function incrementUsage(type: 'quick_analysis' | 'deep_analysis'): DailyUsage {
  const usage = getUsage();
  usage[type]++;
  localStorage.setItem(`${STORAGE_PREFIX}${usage.date}`, JSON.stringify(usage));
  return usage;
}

function canUse(type: 'quick_analysis' | 'deep_analysis', limit: number): boolean {
  const usage = getUsage();
  return usage[type] < limit;
}

function getRemainingUses(type: 'quick_analysis' | 'deep_analysis', limit: number): number {
  const usage = getUsage();
  return Math.max(0, limit - usage[type]);
}

export { getUsage, incrementUsage, canUse, getRemainingUses, type DailyUsage };
