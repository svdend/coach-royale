/**
 * @fileoverview Inline collapsible panel for configuring a custom LLM
 * endpoint (API key, base URL, model name).
 *
 * Settings are persisted to localStorage via modelConfig helpers and
 * never sent to the ClashCoach backend.
 */

import { useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Settings, ChevronDown, ChevronUp, Trash2 } from 'lucide-react';
import {
  MODEL_PRESETS,
  getModelConfigValidationError,
  getModelConfig,
  saveModelConfig,
  clearModelConfig,
} from '@/lib/modelConfig';
import type { ModelConfig } from '@/lib/modelConfig';

interface ModelConfigPanelProps {
  /** Called when the saved config changes so the parent can re-read it. */
  onConfigChange: () => void;
}

/** Inline collapsible card for LLM endpoint configuration. */
export function ModelConfigPanel({ onConfigChange }: ModelConfigPanelProps) {
  const existing = getModelConfig();
  const [open, setOpen] = useState(false);
  const [baseUrl, setBaseUrl] = useState(existing?.baseUrl ?? '');
  const [apiKey, setApiKey] = useState(existing?.apiKey ?? '');
  const [model, setModel] = useState(existing?.model ?? '');
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  function applyPreset(index: number): void {
    const preset = MODEL_PRESETS[index];
    setBaseUrl(preset.baseUrl);
    setModel(preset.model);
    setApiKey('');
    setSaved(false);
    setSaveError(null);
  }

  function handleSave(): void {
    try {
      const savedConfig: ModelConfig = saveModelConfig({
        baseUrl,
        apiKey,
        model,
      });
      setBaseUrl(savedConfig.baseUrl);
      setApiKey(savedConfig.apiKey);
      setModel(savedConfig.model);
      setSaveError(null);
      setSaved(true);
      onConfigChange();
      setTimeout(() => setSaved(false), 2000);
    } catch (error) {
      setSaved(false);
      setSaveError(error instanceof Error ? error.message : 'Failed to save model settings.');
    }
  }

  function handleClear(): void {
    clearModelConfig();
    setBaseUrl('');
    setApiKey('');
    setModel('');
    setSaved(false);
    setSaveError(null);
    onConfigChange();
  }

  const validationError = getModelConfigValidationError({ baseUrl, apiKey, model });
  const isSaveable = validationError === null;
  const isConfigured = existing !== null;

  return (
    <Card className="glass-card border-border/50">
      <CardContent className="p-4">
        {/* Header row — always visible */}
        <button
          type="button"
          className="flex w-full items-center justify-between text-left"
          onClick={() => setOpen((v) => !v)}
        >
          <div className="flex items-center gap-2">
            <Settings className="h-4 w-4 text-muted-foreground" />
            <div>
              <h3 className="text-sm font-semibold text-foreground">Custom Model</h3>
              <p className="text-xs text-muted-foreground">
                {isConfigured
                  ? `${existing.model} · ${existing.baseUrl}`
                  : 'Configure your own API key + endpoint'}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            {isConfigured && (
              <span className="inline-flex items-center rounded-md bg-green-500/20 px-1.5 py-0.5 text-xs font-bold text-green-400 ring-1 ring-inset ring-green-500/30">
                SET
              </span>
            )}
            {open ? (
              <ChevronUp className="h-4 w-4 text-muted-foreground" />
            ) : (
              <ChevronDown className="h-4 w-4 text-muted-foreground" />
            )}
          </div>
        </button>

        {/* Expandable form */}
        {open && (
          <div className="mt-4 space-y-3">
            <p className="rounded-md border border-amber-500/35 bg-amber-500/10 px-2 py-2 text-xs leading-snug text-amber-100/95">
              Your API key and endpoint are stored only in this browser (localStorage). They are
              sent directly from your device to your chosen provider when you run custom-model
              analysis — not to the ClashCoach Worker. Clear this panel or use a private browser
              profile on shared machines.
            </p>
            {/* Preset chips */}
            <div>
              <p className="mb-1.5 text-[10px] text-muted-foreground uppercase tracking-wide">
                Presets
              </p>
              <div className="flex flex-wrap gap-1.5">
                {MODEL_PRESETS.map((preset, i) => (
                  <button
                    key={preset.label}
                    type="button"
                    onClick={() => applyPreset(i)}
                    className="rounded-md border border-border/60 bg-secondary/60 px-2.5 py-1 text-[11px] font-medium text-foreground/80 hover:border-primary/50 hover:bg-primary/10 hover:text-primary transition-colors"
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Endpoint URL */}
            <div>
              <label
                htmlFor="custom-model-base-url"
                className="mb-1 block text-[11px] font-medium text-muted-foreground"
              >
                Base URL
              </label>
              <Input
                id="custom-model-base-url"
                type="url"
                placeholder="http://localhost:11434/v1"
                value={baseUrl}
                onChange={(e) => {
                  setBaseUrl(e.target.value);
                  setSaved(false);
                  setSaveError(null);
                }}
                className="h-9 text-sm"
              />
              <p className="mt-1 text-xs text-muted-foreground">
                Use `https://` for hosted providers. Plain `http://` is limited to localhost or
                private-network endpoints.
              </p>
            </div>

            {/* Model name */}
            <div>
              <label
                htmlFor="custom-model-name"
                className="mb-1 block text-[11px] font-medium text-muted-foreground"
              >
                Model
              </label>
              <Input
                id="custom-model-name"
                type="text"
                placeholder="qwen2.5:14b"
                value={model}
                onChange={(e) => {
                  setModel(e.target.value);
                  setSaved(false);
                  setSaveError(null);
                }}
                className="h-9 text-sm"
              />
            </div>

            {/* API Key */}
            <div>
              <label
                htmlFor="custom-model-api-key"
                className="mb-1 block text-[11px] font-medium text-muted-foreground"
              >
                API Key
              </label>
              <Input
                id="custom-model-api-key"
                type="password"
                placeholder="sk-... (leave blank for Ollama)"
                value={apiKey}
                onChange={(e) => {
                  setApiKey(e.target.value);
                  setSaved(false);
                  setSaveError(null);
                }}
                className="h-9 text-sm"
              />
              <p className="mt-1 text-xs text-muted-foreground">
                Stored only in this browser. Requests go directly from this browser to the provider
                you enter here; Declaw does not proxy or retain the key, but shared devices,
                extensions, and XSS can still expose it.
              </p>
            </div>

            {(validationError ?? saveError) && (
              <div
                className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-[11px] text-destructive"
                role="alert"
              >
                {validationError ?? saveError}
              </div>
            )}

            {/* Action buttons */}
            <div className="flex gap-2">
              <Button size="sm" className="flex-1 h-9" onClick={handleSave} disabled={!isSaveable}>
                {saved ? 'Saved!' : 'Save'}
              </Button>
              {isConfigured && (
                <Button
                  size="sm"
                  variant="secondary"
                  className="h-9 px-3 text-destructive hover:text-destructive"
                  onClick={handleClear}
                  title="Clear saved config"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
