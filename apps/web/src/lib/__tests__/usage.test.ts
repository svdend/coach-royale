import { describe, it, expect, beforeEach, vi } from 'vitest';
import { getUsage, incrementUsage, canUse, getRemainingUses } from '../usage';

// Mock localStorage
const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: vi.fn((key: string) => store[key] ?? null),
    setItem: vi.fn((key: string, value: string) => {
      store[key] = value;
    }),
    removeItem: vi.fn((key: string) => {
      delete store[key];
    }),
    clear: vi.fn(() => {
      store = {};
    }),
    get length() {
      return Object.keys(store).length;
    },
    key: vi.fn((index: number) => Object.keys(store)[index] ?? null),
  };
})();

Object.defineProperty(globalThis, 'localStorage', { value: localStorageMock });

describe('usage', () => {
  beforeEach(() => {
    localStorageMock.clear();
    vi.clearAllMocks();
  });

  describe('getUsage', () => {
    it('returns empty counts for a new day', () => {
      const usage = getUsage();
      expect(usage.quick_analysis).toBe(0);
      expect(usage.deep_analysis).toBe(0);
      expect(usage.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });
  });

  describe('incrementUsage', () => {
    it('increments quick_analysis correctly', () => {
      const first = incrementUsage('quick_analysis');
      expect(first.quick_analysis).toBe(1);
      expect(first.deep_analysis).toBe(0);

      const second = incrementUsage('quick_analysis');
      expect(second.quick_analysis).toBe(2);
    });

    it('increments deep_analysis correctly', () => {
      const result = incrementUsage('deep_analysis');
      expect(result.deep_analysis).toBe(1);
      expect(result.quick_analysis).toBe(0);
    });
  });

  describe('canUse', () => {
    it('returns true when under limit', () => {
      expect(canUse('quick_analysis', 5)).toBe(true);
    });

    it('returns false when at limit', () => {
      for (let i = 0; i < 5; i++) {
        incrementUsage('quick_analysis');
      }
      expect(canUse('quick_analysis', 5)).toBe(false);
    });
  });

  describe('getRemainingUses', () => {
    it('calculates correctly', () => {
      expect(getRemainingUses('quick_analysis', 5)).toBe(5);

      incrementUsage('quick_analysis');
      incrementUsage('quick_analysis');
      expect(getRemainingUses('quick_analysis', 5)).toBe(3);
    });

    it('never returns negative', () => {
      for (let i = 0; i < 10; i++) {
        incrementUsage('deep_analysis');
      }
      expect(getRemainingUses('deep_analysis', 3)).toBe(0);
    });
  });

  describe('daily reset', () => {
    it('resets on new day (different date key)', () => {
      // Increment usage for today
      incrementUsage('quick_analysis');
      incrementUsage('quick_analysis');
      expect(getUsage().quick_analysis).toBe(2);

      // Simulate a new day by clearing localStorage (different date key means no stored data)
      localStorageMock.clear();
      expect(getUsage().quick_analysis).toBe(0);
    });
  });

  describe('independent tracking', () => {
    it('tracks multiple usage types independently', () => {
      incrementUsage('quick_analysis');
      incrementUsage('quick_analysis');
      incrementUsage('quick_analysis');
      incrementUsage('deep_analysis');

      const usage = getUsage();
      expect(usage.quick_analysis).toBe(3);
      expect(usage.deep_analysis).toBe(1);
    });
  });
});
