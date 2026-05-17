"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { LANG_OPTIONS } from "@/lib/lang-options";
import {
  API_PREFIX,
  TENANT_ID,
  apiHeaders,
  formatApiError,
} from "@/lib/dev-api";
import { cn } from "@/lib/utils";

type PromptTemplate = {
  sourceLang: string;
  targetLang: string;
  systemText: string;
  userText: string;
  version: number;
  updatedAt: string;
};

type Baseline = {
  globalTranslatorSystem: string;
  defaultOptionalSystemOverlay: string;
  defaultUserTemplate: string;
};

const inputClass =
  "w-full min-h-[220px] resize-y rounded-lg border border-[var(--edge)] bg-[var(--bg0)]/80 px-3 py-2.5 font-mono text-[12px] leading-relaxed text-[var(--fg-soft)] outline-none ring-0 transition-shadow focus:border-[var(--accent)] focus:shadow-[0_0_0_1px_var(--accent)] motion-reduce:transition-none";

const selectClass =
  "rounded-lg border border-[var(--edge)] bg-[var(--bg-elevated)]/60 px-2.5 py-2 text-[13px] text-[var(--fg)] outline-none focus:border-[var(--accent)]";

export function PromptEditors() {
  const tenantOk = useMemo(() => TENANT_ID.length > 0, []);
  const [sourceLang, setSourceLang] = useState<string>("american_english");
  const [targetLang, setTargetLang] = useState<string>("french");
  const [systemText, setSystemText] = useState("");
  const [userText, setUserText] = useState("");
  const [version, setVersion] = useState(0);
  const [baseline, setBaseline] = useState<Baseline | null>(null);
  const [baselineOpen, setBaselineOpen] = useState(false);
  const [assembledOpen, setAssembledOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const targetChoices = useMemo(
    () => LANG_OPTIONS.filter((o) => o.value !== sourceLang),
    [sourceLang],
  );

  const fetchBaseline = useCallback(async () => {
    if (!tenantOk) return;
    const res = await fetch(`${API_PREFIX}/prompts/baseline`, {
      headers: apiHeaders(),
    });
    if (!res.ok) throw new Error(await res.text());
    setBaseline(await res.json());
  }, [tenantOk]);

  const loadTemplate = useCallback(async () => {
    if (!tenantOk) return;
    const res = await fetch(
      `${API_PREFIX}/prompts/${encodeURIComponent(sourceLang)}/${encodeURIComponent(targetLang)}`,
      { headers: apiHeaders() },
    );
    if (!res.ok) throw new Error(await res.text());
    const data = (await res.json()) as PromptTemplate;
    setSystemText(data.systemText);
    setUserText(data.userText);
    setVersion(data.version);
  }, [tenantOk, sourceLang, targetLang]);

  useEffect(() => {
    if (!tenantOk) return;
    void (async () => {
      try {
        await fetchBaseline();
      } catch (e) {
        setError(formatApiError(e));
      }
    })();
  }, [tenantOk, fetchBaseline]);

  useEffect(() => {
    if (!tenantOk) return;
    let cancelled = false;
    void (async () => {
      try {
        setLoading(true);
        await loadTemplate();
        if (!cancelled) setError(null);
      } catch (e) {
        if (!cancelled) setError(formatApiError(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [tenantOk, loadTemplate]);

  const resetToDefaults = () => {
    if (!baseline) return;
    setSystemText(baseline.defaultOptionalSystemOverlay);
    setUserText(baseline.defaultUserTemplate);
  };

  const save = async () => {
    if (!tenantOk) return;
    setSaving(true);
    setMessage(null);
    setError(null);
    try {
      const body: Record<string, unknown> = { systemText, userText };
      if (version >= 1) body.expectedVersion = version;
      const res = await fetch(
        `${API_PREFIX}/prompts/${encodeURIComponent(sourceLang)}/${encodeURIComponent(targetLang)}`,
        {
          method: "PUT",
          headers: apiHeaders(),
          body: JSON.stringify(body),
        },
      );
      const bodyText = await res.text();
      if (!res.ok) throw new Error(bodyText);
      const data = JSON.parse(bodyText) as PromptTemplate;
      setVersion(data.version);
      setMessage(`Saved as version ${data.version}.`);
    } catch (e) {
      setError(formatApiError(e));
    } finally {
      setSaving(false);
    }
  };

  const assemblePreview =
    `[SYSTEM — merged at runtime]\n\n` +
    `<<< fixed product localization engine (${baseline ? `${baseline.globalTranslatorSystem.length.toLocaleString()} chars` : "…"}) >>>\n` +
    `\n<<< optional tenant overlay (editor below) >>>\n${systemText || "— empty —"}` +
    `\n\n` +
    `────────────────────\n[USER]\n────────────────────\n\n` +
    (userText || "— empty —");

  useEffect(() => {
    const opts = LANG_OPTIONS.filter((o) => o.value !== sourceLang);
    if (!opts.some((o) => o.value === targetLang) && opts[0]) {
      setTargetLang(opts[0].value);
    }
  }, [sourceLang, targetLang]);

  return (
    <div className="mt-10 space-y-6">
      {!tenantOk && (
        <p className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-[13px] text-amber-100">
          Set <code className="text-[var(--fg)]">NEXT_PUBLIC_DEV_TENANT_ID</code>{" "}
          to load and save prompts.
        </p>
      )}
      {(error ?? message) && (
        <p
          className={cn(
            "rounded-lg border px-4 py-2.5 text-[13px]",
            error
              ? "border-red-500/40 bg-red-500/10 text-red-100"
              : "border-emerald-500/35 bg-emerald-500/10 text-emerald-50",
          )}
        >
          {error ?? message}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-[13px] text-[var(--muted)]">
          Source
          <select
            className={selectClass}
            value={sourceLang}
            onChange={(e) => setSourceLang(e.target.value)}
            disabled={!tenantOk || loading}
          >
            {LANG_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <span className="text-[var(--muted-deep)]">→</span>
        <label className="flex items-center gap-2 text-[13px] text-[var(--muted)]">
          Target
          <select
            className={selectClass}
            value={
              targetChoices.some((o) => o.value === targetLang)
                ? targetLang
                : (targetChoices[0]?.value ?? targetLang)
            }
            onChange={(e) => setTargetLang(e.target.value)}
            disabled={!tenantOk || loading}
          >
            {targetChoices.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={!tenantOk || loading}
          onClick={() => void loadTemplate()}
        >
          Reload
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={!tenantOk || !baseline}
          onClick={resetToDefaults}
        >
          Reset instructions to shipped default
        </Button>
        <Button
          type="button"
          size="sm"
          disabled={!tenantOk || saving}
          onClick={() => void save()}
        >
          {saving ? "Saving…" : "Save"}
        </Button>
        <span className="text-[11px] text-[var(--muted-deep)]">
          version {version}
          {loading ? " · loading" : ""}
        </span>
      </div>

      <details
        className="rounded-xl border border-[var(--edge)] bg-[var(--bg-elevated)]/40"
        open={baselineOpen}
        onToggle={(e) => setBaselineOpen((e.target as HTMLDetailsElement).open)}
      >
        <summary className="cursor-pointer select-none px-4 py-3 font-[family-name:var(--font-serif)] text-sm font-semibold text-[var(--fg)]">
          Built-in translator system prompt (reference)
        </summary>
        <div className="border-t border-[var(--edge)] px-4 py-3">
          <p className="mb-2 text-[12px] leading-relaxed text-[var(--muted)]">
            Shipped with the API. Most teams rely on defaults and tune only the editable template below.
          </p>
          <pre className="max-h-[min(50vh,420px)] overflow-auto whitespace-pre-wrap rounded-lg border border-[var(--edge)] bg-[var(--bg0)]/60 p-3 font-mono text-[11px] leading-relaxed text-[var(--muted-deep)]">
            {baseline?.globalTranslatorSystem ?? "…"}
          </pre>
        </div>
      </details>

      <section className="rounded-xl border border-[var(--edge)] bg-[var(--bg-elevated)]/50 p-5 motion-reduce:animate-none animate-in">
        <h2 className="font-[family-name:var(--font-serif)] text-lg font-bold tracking-tight text-[var(--fg)]">
          Instructions for this language pair
        </h2>
        <p className="mt-1.5 text-[13px] leading-relaxed text-[var(--muted)]">
          Injected ahead of each batch. Keep placeholders if you rely on tenant term preferences (
          <code className="text-[11px] text-[var(--fg-soft)]">{"{{glossary_block}}"}</code>
          ), target hints from LANG_CONFIG (
          <code className="text-[11px] text-[var(--fg-soft)]">{"{{terminology_reference}}"}</code>
          ), plus job language substitutions.
        </p>
        <textarea
          className={cn(inputClass, "mt-4 min-h-[320px] w-full")}
          value={userText}
          onChange={(e) => setUserText(e.target.value)}
          spellCheck={false}
          disabled={!tenantOk || loading}
        />
        <p className="mt-3 text-[11px] leading-relaxed text-[var(--muted-deep)]">
          Also filled automatically: {"{{source_lang}}"}, {"{{target_lang}}"},{" "}
          {"{{target_language_name}}"} — tweak section [B] for brand tone or glossary callouts you want in
          every run.
        </p>
      </section>

      <details className="rounded-xl border border-dashed border-[var(--edge-bright)] bg-[var(--bg0)]/35">
        <summary className="cursor-pointer select-none px-4 py-3 font-[family-name:var(--font-serif)] text-[13px] font-semibold text-[var(--fg-soft)]">
          Advanced · extra system-layer policy (optional)
        </summary>
        <div className="space-y-3 border-t border-[var(--edge)] px-4 py-4">
          <p className="text-[12px] leading-relaxed text-[var(--muted)]">
            Rarely needed. Appended after the built-in localization system prompt — reserve for hardened
            legal/security lines that belong in system context instead of editable instructions.
          </p>
          <textarea
            className={cn(inputClass, "min-h-[140px] w-full")}
            value={systemText}
            onChange={(e) => setSystemText(e.target.value)}
            spellCheck={false}
            disabled={!tenantOk || loading}
          />
        </div>
      </details>
      <details
        className="rounded-xl border border-dashed border-[var(--edge-bright)] bg-[var(--bg0)]/35"
        open={assembledOpen}
        onToggle={(e) =>
          setAssembledOpen((e.target as HTMLDetailsElement).open)
        }
      >
        <summary className="cursor-pointer select-none px-4 py-3 text-[13px] font-medium text-[var(--fg-soft)]">
          Preview approximate Bedrock payloads (instructions + rare system overlay + batch envelope)
        </summary>
        <pre className="max-h-[min(55vh,480px)] overflow-auto whitespace-pre-wrap border-t border-[var(--edge)] px-4 py-3 font-mono text-[11px] leading-relaxed text-[var(--muted-deep)]">
          {assemblePreview}
        </pre>
      </details>
    </div>
  );
}
