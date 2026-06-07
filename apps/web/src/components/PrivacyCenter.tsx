import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronDown, ChevronUp, Download, Shield, ShieldAlert, Trash2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  eraseUserData,
  exportUserData,
  getPrivacySettings,
  updatePrivacySettings,
} from '@/lib/api';
import { clearModelConfig } from '@/lib/modelConfig';
import { supabase } from '@/lib/supabase';
import { queryKeys } from '@/lib/queryKeys';

const PRIVACY_POLICY_VERSION = 'alpha-2026-04';
const LAST_TAG_STORAGE_KEY = 'declaw_last_tag';
const USAGE_STORAGE_PREFIX = 'coachroyale_usage_';

interface PrivacyCenterProps {
  userId?: string | null;
}

function clearLocalBrowserData(): void {
  clearModelConfig();
  localStorage.removeItem(LAST_TAG_STORAGE_KEY);

  for (const key of Object.keys(localStorage)) {
    if (key.startsWith(USAGE_STORAGE_PREFIX)) {
      localStorage.removeItem(key);
    }
  }
}

function downloadJson(filename: string, payload: unknown): void {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function checkboxIsChecked(value: string | null): boolean {
  return value !== null;
}

export function PrivacyCenter({ userId }: PrivacyCenterProps) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [retentionDays, setRetentionDays] = useState<30 | 90 | 365>(365);
  const [acknowledgePrivacy, setAcknowledgePrivacy] = useState(false);
  const [acknowledgeByok, setAcknowledgeByok] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [erasing, setErasing] = useState(false);
  const [eraseConfirmation, setEraseConfirmation] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const settingsQuery = useQuery({
    queryKey: userId ? queryKeys.privacySettings(userId) : ['privacy-settings', 'none'],
    queryFn: getPrivacySettings,
    enabled: Boolean(userId),
  });

  useEffect(() => {
    const data = settingsQuery.data;
    if (!data) return;
    setRetentionDays(data.data_retention_days);
    setAcknowledgePrivacy(checkboxIsChecked(data.privacy_policy_accepted_at));
    setAcknowledgeByok(checkboxIsChecked(data.byok_local_storage_notice_accepted_at));
  }, [settingsQuery.data]);

  const saveMutation = useMutation({
    mutationFn: updatePrivacySettings,
    onSuccess: (data) => {
      if (userId) {
        queryClient.setQueryData(queryKeys.privacySettings(userId), data);
      }
      setMessage('Privacy settings saved.');
      setError(null);
    },
    onError: (saveError) => {
      setMessage(null);
      setError(saveError instanceof Error ? saveError.message : 'Failed to save privacy settings');
    },
  });

  if (!userId) {
    return null;
  }

  async function handleSave(): Promise<void> {
    setMessage(null);
    setError(null);
    await saveMutation.mutateAsync({
      data_retention_days: retentionDays,
      privacy_policy_version: PRIVACY_POLICY_VERSION,
      acknowledge_privacy_policy: acknowledgePrivacy,
      acknowledge_byok_local_storage_notice: acknowledgeByok,
    });
  }

  async function handleExport(): Promise<void> {
    setExporting(true);
    setError(null);
    setMessage(null);

    try {
      const payload = await exportUserData();
      downloadJson(`declaw-export-${payload.user.id}.json`, payload);
      setMessage('Export generated.');
    } catch (exportError) {
      setError(exportError instanceof Error ? exportError.message : 'Failed to export user data');
    } finally {
      setExporting(false);
    }
  }

  function handleLocalClear(): void {
    clearLocalBrowserData();
    setMessage('Local browser data cleared.');
    setError(null);
  }

  async function handleErase(): Promise<void> {
    if (eraseConfirmation !== 'ERASE') {
      setError("Type 'ERASE' to confirm account deletion.");
      setMessage(null);
      return;
    }

    setErasing(true);
    setError(null);
    setMessage(null);

    try {
      await eraseUserData();
      clearLocalBrowserData();
      await supabase.auth.signOut();
      window.location.reload();
    } catch (eraseError) {
      setError(eraseError instanceof Error ? eraseError.message : 'Failed to erase user data');
      setErasing(false);
    }
  }

  const settings = settingsQuery.data;
  const loading = settingsQuery.isPending;
  const loadError = settingsQuery.isError;

  return (
    <Card className="glass-card border-border/50">
      <CardContent className="p-4">
        <button
          type="button"
          className="flex w-full items-center justify-between text-left"
          onClick={() => setOpen((value) => !value)}
        >
          <div className="flex items-center gap-2">
            <Shield className="h-4 w-4 text-primary" />
            <div>
              <h3 className="text-sm font-semibold text-foreground">Privacy Center</h3>
              <p className="text-xs text-muted-foreground">
                Export data, tune retention, clear local storage, or erase your account.
              </p>
            </div>
          </div>
          {open ? (
            <ChevronUp className="h-4 w-4 text-muted-foreground" />
          ) : (
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          )}
        </button>

        {open && (
          <div className="mt-4 space-y-4">
            <div className="rounded-lg border border-border/50 bg-secondary/30 p-3 text-[11px] text-muted-foreground">
              Server-side export covers Supabase-backed gameplay, saved account records, and
              subscription data. The retention window below applies only to battle history, stat
              snapshots, analysis history, and free AI usage counters. Tracked players, saved deck
              records, and profile data remain until you erase the account. BYOK API keys, the last
              searched player tag, and local usage counters stay in the browser and are excluded
              unless you clear them locally.
            </div>

            {loading ? (
              <p className="text-xs text-muted-foreground">Loading privacy settings…</p>
            ) : loadError ? (
              <p className="text-xs text-destructive" role="alert">
                Failed to load privacy settings. Try again.
              </p>
            ) : (
              <div className="space-y-3">
                <div>
                  <label className="mb-1 block text-[11px] font-medium text-muted-foreground">
                    Server History Retention
                  </label>
                  <select
                    className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                    value={retentionDays}
                    onChange={(event) =>
                      setRetentionDays(Number(event.target.value) as 30 | 90 | 365)
                    }
                  >
                    <option value={30}>30 days</option>
                    <option value={90}>90 days</option>
                    <option value={365}>365 days</option>
                  </select>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Applies only to snapshots, battles, analysis history, and free AI usage
                    counters. Tracked players, saved decks, and profile records are kept until
                    account deletion.
                  </p>
                </div>

                <label className="flex items-start gap-2 text-[11px] text-muted-foreground">
                  <input
                    type="checkbox"
                    className="mt-0.5"
                    checked={acknowledgePrivacy}
                    onChange={(event) => setAcknowledgePrivacy(event.target.checked)}
                  />
                  <span>I acknowledge the current privacy notice and export/erasure flows.</span>
                </label>

                <label className="flex items-start gap-2 text-[11px] text-muted-foreground">
                  <input
                    type="checkbox"
                    className="mt-0.5"
                    checked={acknowledgeByok}
                    onChange={(event) => setAcknowledgeByok(event.target.checked)}
                  />
                  <span>
                    I understand custom BYOK model settings are stored in my browser, not on the
                    Worker.
                  </span>
                </label>

                <Button
                  size="sm"
                  className="w-full h-9"
                  onClick={() => void handleSave()}
                  disabled={saveMutation.isPending}
                >
                  {saveMutation.isPending ? 'Saving…' : 'Save Privacy Settings'}
                </Button>
              </div>
            )}

            {settings && (
              <div className="rounded-lg border border-border/50 bg-background/40 p-3 text-[11px] text-muted-foreground">
                <p>Current history retention: {settings.data_retention_days} days</p>
                <p>
                  Privacy notice acknowledged:{' '}
                  {settings.privacy_policy_accepted_at ? 'yes' : 'not yet'}
                </p>
                <p>
                  BYOK local-storage notice acknowledged:{' '}
                  {settings.byok_local_storage_notice_accepted_at ? 'yes' : 'not yet'}
                </p>
              </div>
            )}

            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <Button
                size="sm"
                variant="secondary"
                className="h-9 gap-2"
                onClick={handleExport}
                disabled={exporting}
              >
                <Download className="h-4 w-4" />
                {exporting ? 'Exporting…' : 'Download Export'}
              </Button>
              <Button
                size="sm"
                variant="secondary"
                className="h-9 gap-2"
                onClick={handleLocalClear}
              >
                <ShieldAlert className="h-4 w-4" />
                Clear Local Browser Data
              </Button>
            </div>

            <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3">
              <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-destructive">
                <Trash2 className="h-4 w-4" />
                Delete Account and Cloud Data
              </div>
              <p className="mb-3 text-[11px] text-destructive/80">
                This erases your Supabase-backed profile, tracked players, snapshots, battles,
                decks, analysis history, and free AI usage counters. Type{' '}
                <span className="font-semibold">ERASE</span> to continue.
              </p>
              <div className="flex gap-2">
                <Input
                  value={eraseConfirmation}
                  onChange={(event) => setEraseConfirmation(event.target.value)}
                  placeholder="ERASE"
                  className="h-9"
                />
                <Button
                  size="sm"
                  variant="secondary"
                  className="h-9 whitespace-nowrap text-destructive hover:text-destructive"
                  onClick={handleErase}
                  disabled={erasing}
                >
                  {erasing ? 'Erasing…' : 'Delete Account'}
                </Button>
              </div>
            </div>

            {message && <p className="text-xs text-green-400">{message}</p>}
            {error && <p className="text-xs text-destructive">{error}</p>}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
