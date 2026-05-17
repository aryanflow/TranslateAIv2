"use client";

import Link from "next/link";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import gsap from "gsap";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { LANG_OPTIONS, langLabel } from "@/lib/lang-options";
import {
  API_PREFIX,
  TENANT_ID,
  apiHeaders,
  formatApiError,
} from "@/lib/dev-api";
import { phaseLabel } from "@/components/jobs/job-visual-utils";
import type { ReactNode } from "react";

function StepCard({
  step,
  title,
  children,
  className,
}: {
  step: number;
  title: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Card className={cn("tw-wizard-stagger group/step shadow-[0_1px_0_rgba(255,255,255,0.04)_inset]", className)}>
      <div className="pointer-events-none absolute -right-8 -top-8 h-32 w-32 rounded-full bg-[var(--accent)]/[0.04] blur-2xl" />
      <CardHeader className="relative flex flex-row items-start gap-4 space-y-0 pb-2">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-[var(--edge-bright)] bg-[var(--bg0)] font-[family-name:var(--font-serif)] text-sm font-extrabold text-[var(--accent)] transition-transform duration-300 ease-out group-hover/step:scale-[1.04] motion-reduce:transition-none motion-reduce:group-hover/step:scale-100">
          {step}
        </div>
        <div className="min-w-0 flex-1 space-y-1">
          <CardTitle className="text-[15px] font-semibold tracking-tight sm:text-base">{title}</CardTitle>
        </div>
      </CardHeader>
      <CardContent className="relative space-y-3 pt-0">{children}</CardContent>
    </Card>
  );
}

function WizardRail({
  ingestPhase,
  activeJobId,
}: {
  ingestPhase: IngestPhase;
  activeJobId: string | null;
}) {
  const catalogue =
    ingestPhase === "ready"
      ? "complete"
      : ingestPhase === "error"
        ? "error"
        : ingestPhase === "idle"
          ? "upcoming"
          : "active";
  const pipeline =
    ingestPhase !== "ready" ? "upcoming" : activeJobId ? "complete" : "active";
  const run = activeJobId ? "active" : "upcoming";

  const dot = (state: "upcoming" | "active" | "complete" | "error") =>
    cn(
      "flex h-8 w-8 shrink-0 items-center justify-center rounded-full border text-[11px] font-bold tabular-nums transition-[border-color,background-color,color,box-shadow] duration-300 motion-reduce:transition-none",
      state === "upcoming" &&
        "border-[var(--edge)] bg-[var(--bg0)]/80 text-[var(--muted-deep)]",
      state === "active" &&
        "border-[var(--accent-muted)] bg-[var(--accent)]/[0.12] text-[var(--accent)] shadow-[0_0_0_1px_rgba(212,175,92,0.15)]",
      state === "complete" &&
        "border-[var(--ok)]/35 bg-[var(--ok)]/[0.08] text-[var(--ok)]",
      state === "error" && "border-[var(--danger)]/45 bg-[var(--danger)]/[0.08] text-[var(--danger)]",
    );

  return (
    <nav
      className="tw-wizard-stagger rounded-xl border border-[var(--edge)] bg-[var(--panel)]/40 px-4 py-3.5 backdrop-blur-[2px] sm:px-5"
      aria-label="Translation workflow"
    >
      <ol className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:gap-2">
        <li className="flex min-w-0 flex-1 items-center gap-3 sm:flex-[1_1_0]">
          <span className={dot(catalogue)} aria-hidden>
            {catalogue === "complete" ? "✓" : "1"}
          </span>
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--muted-deep)]">
              Catalogue
            </p>
            <p className="truncate text-[12px] text-[var(--muted)]">
              {ingestPhase === "uploading" || ingestPhase === "previewing"
                ? "Upload & extract"
                : ingestPhase === "ready"
                  ? "Strings ready"
                  : ingestPhase === "error"
                    ? "Fix upload & retry"
                    : "Upload or sample"}
            </p>
          </div>
        </li>
        <span
          className="hidden h-px w-6 shrink-0 bg-gradient-to-r from-transparent via-[var(--edge-bright)] to-transparent sm:block sm:h-6 sm:w-px sm:bg-[var(--edge-bright)]"
          aria-hidden
        />
        <li className="flex min-w-0 flex-1 items-center gap-3 sm:flex-[1_1_0]">
          <span className={dot(pipeline)} aria-hidden>
            {pipeline === "complete" ? "✓" : "2"}
          </span>
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--muted-deep)]">
              Languages
            </p>
            <p className="truncate text-[12px] text-[var(--muted)]">
              {ingestPhase === "ready" ? "Source → target & batching" : "Unlocks after extract"}
            </p>
          </div>
        </li>
        <span
          className="hidden h-px w-6 shrink-0 bg-gradient-to-r from-transparent via-[var(--edge-bright)] to-transparent sm:block sm:h-6 sm:w-px sm:bg-[var(--edge-bright)]"
          aria-hidden
        />
        <li className="flex min-w-0 flex-1 items-center gap-3 sm:flex-[1_1_0]">
          <span className={dot(run)} aria-hidden>
            3
          </span>
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--muted-deep)]">
              Translation job
            </p>
            <p className="truncate text-[12px] text-[var(--muted)]">
              {activeJobId ? "Running — progress on Jobs" : "Start when catalogue is ready"}
            </p>
          </div>
        </li>
      </ol>
    </nav>
  );
}

type IngestPhase = "idle" | "uploading" | "previewing" | "ready" | "error";

type PreviewPayload = {
  format: string;
  totalStrings: number;
  preview: string[];
  previewStringIds?: number[];
  previewTruncated: boolean;
};

type JobPollState = {
  id: string;
  status: string;
  progress: number;
  batchesCompleted?: number;
  batchTotal?: number | null;
  stringsTotal?: number | null;
  judgePassScoreMin10?: number;
  judgePassScoreMin01?: number;
  minTranslationScoreStored?: number | null;
};

function PipelinePulse() {
  return (
    <span className="relative flex h-3 w-3">
      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[var(--accent)] opacity-75 motion-reduce:animate-none" />
      <span className="relative inline-flex h-3 w-3 rounded-full bg-[var(--accent)]" />
    </span>
  );
}

function ProgressBar({ value }: { value: number }) {
  const pct = Math.min(100, Math.max(0, value));
  return (
    <div className="mt-3 h-2 overflow-hidden rounded-full bg-[var(--panel)] ring-1 ring-[var(--edge)]">
      <div
        className="h-full rounded-full bg-gradient-to-r from-[var(--accent)] to-[var(--accent-muted)] transition-[width] duration-700 ease-out motion-reduce:transition-none"
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

const FIXTURE_PREVIEW_CHAR_CAP = 28_000;

function fixtureBasename(href: string): string {
  const s = href.split("/").pop();
  return s?.length ? s : "fixture.dat";
}

function fixtureMime(href: string): string {
  const n = fixtureBasename(href).toLowerCase();
  if (n.endsWith(".json")) return "application/json";
  if (n.endsWith(".csv")) return "text/csv";
  if (n.endsWith(".xml")) return "application/xml";
  return "application/octet-stream";
}

function prettifyFixtureText(text: string, href: string): string {
  if (!fixtureBasename(href).toLowerCase().endsWith(".json")) return text;
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text;
  }
}

function truncateFixturePeek(text: string): { shown: string; truncated: boolean } {
  if (text.length <= FIXTURE_PREVIEW_CHAR_CAP) {
    return { shown: text, truncated: false };
  }
  const rest = text.length - FIXTURE_PREVIEW_CHAR_CAP;
  return {
    shown: `${text.slice(0, FIXTURE_PREVIEW_CHAR_CAP)}\n\n… ${rest.toLocaleString()} more characters (preview truncated — still loads fully)`,
    truncated: true,
  };
}

const SAMPLE_FIXTURES = [
  {
    id: "pos-micro-json",
    href: "/fixtures/fixture-pos-micro.json",
    title: "Micro smoke",
    subtitle: "Bare-bones nested POS",
    detail: "Six leaf strings — quick extractor sanity.",
    format: "JSON" as const,
    approxStrings: "6",
    intent: "Smoke",
  },
  {
    id: "pos-micro-xml",
    href: "/fixtures/fixture-pos-micro.xml",
    title: "Micro smoke · XML",
    subtitle: "<string> · original_string",
    detail: "Twin of micro JSON — six POS strings in aptos XML extract shape.",
    format: "XML" as const,
    approxStrings: "6",
    intent: "Smoke",
  },
  {
    id: "pos-123-json",
    href: "/fixtures/fixture-pos-catalog-123.json",
    title: "Retail catalog · JSON",
    subtitle: "Staged POS / tender vocabulary",
    detail: "123 register messages — rotates ~18 canonical patterns.",
    format: "JSON" as const,
    approxStrings: "123",
    intent: "Recommended",
  },
  {
    id: "pos-123-csv",
    href: "/fixtures/fixture-pos-catalog-123.csv",
    title: "Retail catalog · CSV",
    subtitle: "Flat key column + American English text",
    detail: "123 rows aligned to the JSON 123-set.",
    format: "CSV" as const,
    approxStrings: "123",
    intent: "Recommended",
  },
  {
    id: "pos-200-json",
    href: "/fixtures/fixture-pos-catalog-200.json",
    title: "Volume catalog · JSON",
    subtitle: "High-cardinality catalogue copy",
    detail: "200 distinct retail prompts — tenders, pickups, integrations, audits.",
    format: "JSON" as const,
    approxStrings: "200",
    intent: "Scale",
  },
] as const;

function gsapMotionOk(): boolean {
  if (typeof window === "undefined") return false;
  return !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

type FixtureTile = (typeof SAMPLE_FIXTURES)[number];

type ImportProvenance =
  | {
      kind: "fixture";
      href: string;
      displayName: string;
      format: "JSON" | "CSV" | "XML";
      approxStrings: string;
    }
  | { kind: "upload"; displayName: string };

/** Upload → extract preview → single target → job + resilient progress UX */
export function TranslateWizardShell() {
  const [localFileName, setLocalFileName] = useState<string | null>(null);
  const [fileKey, setFileKey] = useState<string | null>(null);
  const [ingestPhase, setIngestPhase] = useState<IngestPhase>("idle");
  const [previewPayload, setPreviewPayload] = useState<PreviewPayload | null>(null);
  const [importProvenance, setImportProvenance] = useState<ImportProvenance | null>(null);
  const [sourceLang, setSourceLang] = useState<string>("american_english");
  const [targetLang, setTargetLang] = useState<string>("spanish");
  const [batchSize, setBatchSize] = useState(80);
  const [busySubmit, setBusySubmit] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [jobLive, setJobLive] = useState<JobPollState | null>(null);

  const tenantOk = useMemo(() => TENANT_ID.length > 0, []);

  const [fixturePeek, setFixturePeek] = useState<FixtureTile | null>(null);
  const [fixtureBlob, setFixtureBlob] = useState<Blob | null>(null);
  const [fixturePeekText, setFixturePeekText] = useState("");
  const [fixturePeekTruncated, setFixturePeekTruncated] = useState(false);
  const [fixturePeekLoading, setFixturePeekLoading] = useState(false);
  const [fixturePeekError, setFixturePeekError] = useState<string | null>(null);
  /** Off by default — no chunky “collapsed” disclosure in the main wizard chrome. */
  const [fixtureDemosOpen, setFixtureDemosOpen] = useState(false);

  const rootRef = useRef<HTMLDivElement>(null);
  const jobLivePanelRef = useRef<HTMLDivElement>(null);
  const fixturePanelRef = useRef<HTMLDivElement>(null);
  const lastAnimatedJobId = useRef<string | null>(null);

  useLayoutEffect(() => {
    if (!gsapMotionOk()) return;
    const root = rootRef.current;
    if (!root) return;
    const nodes = root.querySelectorAll(".tw-wizard-stagger");
    if (!nodes.length) return;
    const ctx = gsap.context(() => {
      gsap.from(nodes, {
        opacity: 0,
        y: 22,
        duration: 0.58,
        stagger: 0.09,
        ease: "power3.out",
        clearProps: "opacity,transform",
      });
    }, root);
    return () => ctx.revert();
  }, [tenantOk]);

  useEffect(() => {
    if (!activeJobId) lastAnimatedJobId.current = null;
  }, [activeJobId]);

  useLayoutEffect(() => {
    if (!gsapMotionOk() || !activeJobId || !jobLive) return;
    const panel = jobLivePanelRef.current;
    if (!panel) return;
    if (lastAnimatedJobId.current === activeJobId) return;
    lastAnimatedJobId.current = activeJobId;
    gsap.fromTo(
      panel,
      { opacity: 0, y: 18, scale: 0.985 },
      { opacity: 1, y: 0, scale: 1, duration: 0.48, ease: "power2.out", clearProps: "opacity,transform" },
    );
  }, [activeJobId, jobLive]);

  useLayoutEffect(() => {
    if (!fixturePeek || !gsapMotionOk()) return;
    const panel = fixturePanelRef.current;
    if (!panel) return;
    gsap.fromTo(
      panel,
      { opacity: 0, y: 20, scale: 0.96 },
      { opacity: 1, y: 0, scale: 1, duration: 0.4, ease: "power3.out" },
    );
  }, [fixturePeek]);

  const closeFixturePeek = useCallback(() => {
    setFixturePeek(null);
    setFixtureBlob(null);
    setFixturePeekText("");
    setFixturePeekTruncated(false);
    setFixturePeekLoading(false);
    setFixturePeekError(null);
  }, []);

  useEffect(() => {
    if (!fixturePeek) return;

    let cancelled = false;
    setFixturePeekLoading(true);
    setFixturePeekError(null);
    setFixtureBlob(null);

    void (async () => {
      try {
        const res = await fetch(fixturePeek.href);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const blob = await res.blob();
        if (cancelled) return;
        setFixtureBlob(blob);
        const raw = await blob.text();
        if (cancelled) return;
        const pretty = prettifyFixtureText(raw, fixturePeek.href);
        const { shown, truncated } = truncateFixturePeek(pretty);
        setFixturePeekText(shown);
        setFixturePeekTruncated(truncated);
      } catch (e) {
        if (!cancelled) {
          setFixturePeekError(e instanceof Error ? e.message : "Could not load fixture");
          setFixturePeekText("");
        }
      } finally {
        if (!cancelled) setFixturePeekLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [fixturePeek]);

  useEffect(() => {
    if (!fixturePeek) return;
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") closeFixturePeek();
    };
    window.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [fixturePeek, closeFixturePeek]);

  useEffect(() => {
    if (targetLang !== sourceLang) return;
    const alt = LANG_OPTIONS.find((o) => o.value !== sourceLang);
    if (alt) setTargetLang(alt.value);
  }, [sourceLang, targetLang]);

  const fetchPreviewForKey = useCallback(async (key: string) => {
    const res = await fetch(`${API_PREFIX}/files/preview`, {
      method: "POST",
      headers: apiHeaders(),
      body: JSON.stringify({ fileKey: key, limit: 280 }),
    });
    if (!res.ok) throw new Error(await res.text());
    return (await res.json()) as PreviewPayload;
  }, []);

  const ingestFile = async (file: File | null, fromFixture?: FixtureTile | null) => {
    setError(null);
    setPreviewPayload(null);
    setFileKey(null);
    setLocalFileName(file?.name ?? null);
    setImportProvenance(null);
    setIngestPhase("idle");
    setActiveJobId(null);
    setJobLive(null);

    if (!file || !tenantOk) return;

    setIngestPhase("uploading");
    try {
      const pre = await fetch(`${API_PREFIX}/files/presigned-url`, {
        method: "POST",
        headers: apiHeaders(),
        body: JSON.stringify({
          fileName: file.name,
          contentType: file.type || "application/octet-stream",
        }),
      });
      if (!pre.ok) throw new Error(`Presign failed: ${await pre.text()}`);
      const { uploadUrl, fileKey: key } = (await pre.json()) as {
        uploadUrl: string;
        fileKey: string;
      };

      const put = await fetch(uploadUrl, {
        method: "PUT",
        body: file,
        headers: {
          "Content-Type": file.type || "application/octet-stream",
        },
      });
      if (!put.ok) throw new Error("Upload to object storage failed.");

      setFileKey(key);
      setIngestPhase("previewing");
      const pv = await fetchPreviewForKey(key);
      setPreviewPayload(pv);
      setIngestPhase("ready");
      if (fromFixture) {
        setImportProvenance({
          kind: "fixture",
          href: fromFixture.href,
          displayName: fixtureBasename(fromFixture.href),
          format: fromFixture.format,
          approxStrings: fromFixture.approxStrings,
        });
      } else {
        setImportProvenance({ kind: "upload", displayName: file.name });
      }
    } catch (e) {
      setIngestPhase("error");
      setError(formatApiError(e));
    }
  };

  useEffect(() => {
    if (!activeJobId || !tenantOk) return;

    let cancelled = false;

    const tick = async () => {
      try {
        const res = await fetch(`${API_PREFIX}/jobs/${activeJobId}`, {
          headers: apiHeaders(),
        });
        if (!res.ok) return;
        const data = (await res.json()) as {
          id: string;
          status: string;
          progress: number;
          batchesCompleted?: number;
          batchTotal?: number | null;
          stringsTotal?: number | null;
          judgePassScoreMin10?: number;
          judgePassScoreMin01?: number;
          minTranslationScoreStored?: number | null;
        };
        if (cancelled) return;
        setJobLive({
          id: data.id,
          status: data.status,
          progress: data.progress,
          batchesCompleted: data.batchesCompleted,
          batchTotal: data.batchTotal,
          stringsTotal: data.stringsTotal,
          judgePassScoreMin10: data.judgePassScoreMin10,
          judgePassScoreMin01: data.judgePassScoreMin01,
          minTranslationScoreStored: data.minTranslationScoreStored,
        });
      } catch {
        /* ignore transient poll errors */
      }
    };

    void tick();
    const id = window.setInterval(() => void tick(), 2200);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [activeJobId, tenantOk]);

  const startTranslation = async () => {
    setError(null);
    if (!tenantOk) {
      setError("Set NEXT_PUBLIC_DEV_TENANT_ID to a valid tenant UUID from your database.");
      return;
    }
    if (!fileKey || ingestPhase !== "ready") {
      setError("Finish uploading and extracting strings before starting.");
      return;
    }

    setBusySubmit(true);
    try {
      const jobRes = await fetch(`${API_PREFIX}/jobs`, {
        method: "POST",
        headers: apiHeaders(),
        body: JSON.stringify({
          fileKey,
          sourceLang,
          targetLangs: [targetLang],
          batchSize,
        }),
      });
      if (!jobRes.ok) throw new Error(`Create job failed: ${await jobRes.text()}`);
      const created = (await jobRes.json()) as { jobId: string };
      setActiveJobId(created.jobId);
      setJobLive({
        id: created.jobId,
        status: "pending",
        progress: 0,
      });
    } catch (e) {
      setError(formatApiError(e));
    } finally {
      setBusySubmit(false);
    }
  };

  const ingestFromFixturePeek = async () => {
    if (!fixturePeek || !fixtureBlob || !tenantOk) return;
    const tile = fixturePeek;
    const name = fixtureBasename(tile.href);
    const file = new File([fixtureBlob], name, {
      type: fixtureMime(tile.href),
    });
    closeFixturePeek();
    await ingestFile(file, tile);
  };

  const ingestLabel =
    ingestPhase === "idle"
      ? ""
      : ingestPhase === "uploading"
        ? localFileName
          ? `Uploading · ${localFileName}…`
          : "Uploading…"
        : ingestPhase === "previewing"
          ? "Extracting strings…"
          : ingestPhase === "ready"
            ? importProvenance?.kind === "fixture"
              ? `Ready — catalogue from sample · ${importProvenance.displayName}${previewPayload ? ` (${previewPayload.totalStrings.toLocaleString()} strings)` : ""}.`
              : `Ready — ${localFileName ?? "your catalog"}${previewPayload ? ` (${previewPayload.totalStrings.toLocaleString()} strings)` : ""}.`
            : "Could not ingest file.";

  return (
    <div ref={rootRef} className="mt-10 space-y-5">
      {!tenantOk ? (
        <p className="rounded-lg border border-[var(--edge)] bg-[var(--bg0)]/80 px-4 py-3 text-[13px] text-[var(--muted)]">
          Add{" "}
          <code className="rounded bg-[var(--panel)] px-1.5 py-0.5 font-mono text-[12px]">
            NEXT_PUBLIC_DEV_TENANT_ID
          </code>{" "}
          to{" "}
          <code className="rounded bg-[var(--panel)] px-1.5 py-0.5 font-mono text-[12px]">
            apps/web/.env.local
          </code>{" "}
          (tenant must exist in Postgres).
        </p>
      ) : null}

      {tenantOk ? <WizardRail ingestPhase={ingestPhase} activeJobId={activeJobId} /> : null}

      <StepCard step={1} title="Import catalogue">
        <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <p className="min-w-0 flex-1 text-[13px] leading-relaxed text-[var(--muted)]">
            Browse JSON, CSV, XML, or XLSX — presign and extractor handle every format the same way.
          </p>
          {tenantOk ? (
            <button
              type="button"
              onClick={() => setFixtureDemosOpen((o) => !o)}
              className={cn(
                "shrink-0 self-start text-left text-[11px] leading-snug text-[var(--muted)] underline decoration-[color:var(--edge-bright)] decoration-1 underline-offset-[0.22em]",
                "transition hover:text-[var(--fg-soft)] motion-reduce:transition-none sm:text-right",
              )}
              aria-expanded={fixtureDemosOpen}
            >
              {fixtureDemosOpen ? (
                <>
                  Hide <span className="text-[var(--fg-soft)]">bundled Peek</span>
                </>
              ) : (
                <>
                  Peek <span className="text-[var(--fg-soft)]">bundled</span> JSON · CSV · XML
                </>
              )}
            </button>
          ) : null}
        </div>

        {importProvenance?.kind === "fixture" && !fixtureDemosOpen ? (
          <p className="mt-2 text-[11px] leading-relaxed text-[var(--muted)]">
            Imported from bundle{" "}
            <code className="rounded bg-[var(--panel)] px-1 py-0.5 font-mono text-[10px] text-[var(--fg-soft)]">
              {importProvenance.displayName}
            </code>
            . Toggle <span className="text-[var(--fg-soft)]">Peek bundled</span> to switch samples.
          </p>
        ) : null}

        {fixtureDemosOpen ? (
          <section className="mt-4 rounded-lg border border-[var(--edge)] bg-[var(--panel)]/25" aria-label="Bundled Peek fixtures">
            <div className="space-y-2 border-t-0 px-3 pb-3 pt-2.5 sm:px-3.5 sm:pb-3.5 sm:pt-2.5">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px] text-[var(--muted)]">
              <span>Nominal labels on tiles · extractor totals after load are authoritative.</span>
              <span aria-hidden className="hidden text-[var(--edge-bright)] sm:inline">
                ·
              </span>
              <span className="hidden sm:inline">Corner icon: offline copy.</span>
              <span className="ml-auto shrink-0 rounded bg-[var(--bg0)]/85 px-1.5 py-px font-mono text-[9px] text-[var(--muted-deep)]">
                XLSX → Browse only
              </span>
            </div>
          <div className="flex gap-2 overflow-x-auto pb-0.5 [-ms-overflow-style:none] [scrollbar-width:none] sm:flex-wrap sm:overflow-visible [&::-webkit-scrollbar]:hidden">
            {SAMPLE_FIXTURES.map((sample) => {
              const ingestBusy = ingestPhase === "uploading" || ingestPhase === "previewing";
              const sampleActive =
                importProvenance?.kind === "fixture" && importProvenance.href === sample.href;
              return (
                <div key={sample.id} className="group/card relative flex-[0_0_auto] sm:flex-[0_1_auto]">
                  <button
                    type="button"
                    disabled={!tenantOk || ingestBusy}
                    title={`${sample.subtitle}. ${sample.detail}`}
                    onClick={() => setFixturePeek(sample)}
                    className={cn(
                      "w-[min(100%,11.25rem)] rounded-lg border bg-[var(--bg0)]/70 px-2.5 pb-2 pt-2.5 text-left text-[var(--fg)] shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] transition sm:min-w-0 sm:max-w-[11.25rem] sm:w-auto",
                      sampleActive
                        ? "border-[var(--accent)]/55 ring-2 ring-[var(--accent)]/25"
                        : "border-[var(--edge-bright)] hover:border-[var(--accent-muted)] hover:shadow-[0_12px_36px_-24px_rgba(0,0,0,0.75)] motion-reduce:transition-none",
                      (!tenantOk || ingestBusy) && "cursor-not-allowed opacity-50",
                    )}
                  >
                    <div className="flex items-start justify-between gap-1.5">
                      <span className="rounded border border-[var(--edge)] bg-[var(--panel)] px-1 py-0.5 font-mono text-[9px] uppercase tracking-wide text-[var(--fg-soft)]">
                        {sample.format}
                      </span>
                      <span className="text-[10px] font-semibold uppercase tracking-wide text-[var(--accent-muted)] transition group-hover:text-[var(--accent)]">
                        Peek
                      </span>
                    </div>
                    <span className="mt-1.5 block font-[family-name:var(--font-serif)] text-[12px] font-bold leading-tight tracking-tight">
                      {sample.title}
                    </span>
                    <p className="mt-1 line-clamp-2 text-[10px] leading-snug text-[var(--muted)]">
                      <span className="text-[var(--fg-soft)]">{sample.subtitle}</span>
                      <span aria-hidden className="mx-1 text-[var(--edge)]">
                        ·
                      </span>
                      {sample.detail}
                    </p>
                    <div className="mt-2 flex flex-wrap items-center gap-1">
                      <span className="rounded border border-[var(--edge)] px-1.5 py-px font-mono text-[9px] tabular-nums text-[var(--muted)]">
                        {sample.approxStrings}&nbsp;nom.
                      </span>
                      {sample.intent === "Recommended" ? (
                        <span className="rounded border border-[var(--accent)]/30 bg-[var(--accent)]/[0.06] px-1.5 py-px font-mono text-[9px] text-[var(--accent-muted)]">
                          Crew
                        </span>
                      ) : sample.intent === "Smoke" ? (
                        <span className="rounded border border-[var(--edge-bright)] px-1.5 py-px font-mono text-[9px] text-[var(--muted-deep)]">
                          Quick
                        </span>
                      ) : sample.intent === "Scale" ? (
                        <span className="rounded border border-[var(--edge)] px-1.5 py-px font-mono text-[9px] text-[var(--muted)]">
                          Volume
                        </span>
                      ) : null}
                    </div>
                    {sampleActive ? (
                      <p className="mt-2 border-t border-dashed border-[var(--accent)]/30 pt-2 text-[9px] font-medium uppercase tracking-wide text-[var(--accent-muted)]">
                        Active · flows as-is
                      </p>
                    ) : (
                      <span className="sr-only">Opens a full-screen artifact preview.</span>
                    )}
                  </button>
                  <a
                    href={sample.href}
                    download={fixtureBasename(sample.href)}
                    title="Save offline copy"
                    aria-label={`Download ${sample.title}`}
                    tabIndex={0}
                    className={cn(
                      "pointer-events-none absolute right-1.5 top-1.5 z-[1] rounded border border-[var(--edge-bright)] bg-[var(--bg0)] p-1 text-[var(--fg-soft)] opacity-0 shadow-sm transition",
                      "hover:border-[var(--accent-muted)] hover:text-[var(--fg)]",
                      "group-hover/card:pointer-events-auto group-hover/card:opacity-100",
                      "group-focus-within/card:pointer-events-auto group-focus-within/card:opacity-100",
                      "motion-reduce:pointer-events-auto motion-reduce:opacity-70",
                    )}
                    onMouseDown={(e) => e.stopPropagation()}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <svg
                      xmlns="http://www.w3.org/2000/svg"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth={2}
                      className="h-4 w-4"
                      aria-hidden
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v12m0 0-4-4m4 4 4-4M5 21h14" />
                    </svg>
                  </a>
                </div>
              );
            })}
          </div>
          </div>
          </section>
        ) : null}

        <div className="mt-6 flex flex-wrap items-center gap-3">
          <input
            type="file"
            accept=".xml,.json,.csv,.xlsx,.xls"
            className="max-w-full text-[13px] text-[var(--muted)] file:mr-3 file:rounded-md file:border file:border-[var(--edge-bright)] file:bg-[var(--panel)] file:px-3 file:py-1.5 file:text-[12px] file:font-medium file:text-[var(--fg)]"
            disabled={ingestPhase === "uploading" || ingestPhase === "previewing"}
            onChange={(e) => void ingestFile(e.target.files?.[0] ?? null)}
          />
          {ingestLabel ? (
            <span className="text-[12px] text-[var(--muted-deep)]">{ingestLabel}</span>
          ) : null}
        </div>

        {previewPayload ? (
          <details className="group mt-4 rounded-lg border border-[var(--edge)] bg-[var(--bg0)]/85">
            <summary className="cursor-pointer select-none list-none px-4 py-3 text-[13px] font-semibold text-[var(--fg)] [&::-webkit-details-marker]:hidden">
              <span className="flex flex-wrap items-center justify-between gap-2">
                <span>
                  Extracted strings{" "}
                  <span className="font-normal text-[var(--muted)]">
                    ({previewPayload.totalStrings.toLocaleString()} total
                    {previewPayload.previewTruncated ? ", preview capped" : ""})
                  </span>
                  {importProvenance?.kind === "fixture" ? (
                    <span className="ml-2 rounded-md border border-[var(--accent)]/35 bg-[var(--accent)]/[0.06] px-2 py-0.5 align-middle font-mono text-[10px] font-normal uppercase tracking-wide text-[var(--accent-muted)]">
                      Sample · {importProvenance.approxStrings}
                    </span>
                  ) : importProvenance?.kind === "upload" ? (
                    <span
                      title={importProvenance.displayName}
                      className="ml-2 max-w-[14rem] truncate rounded-md border border-[var(--edge-bright)] bg-[var(--panel)]/70 px-2 py-0.5 align-middle font-mono text-[10px] font-normal uppercase tracking-wide text-[var(--muted)]"
                    >
                      Your upload · {importProvenance.displayName}
                    </span>
                  ) : null}
                </span>
                <span className="rounded-md border border-[var(--edge-bright)] px-2 py-0.5 font-mono text-[10px] uppercase tracking-wide text-[var(--muted)]">
                  {previewPayload.format}
                </span>
              </span>
            </summary>
            <div className="max-h-52 space-y-1 overflow-auto border-t border-[var(--edge)] px-4 py-3 font-mono text-[11px] leading-snug text-[var(--muted)]">
              {previewPayload.preview.map((s, i) => {
                const sid =
                  previewPayload.previewStringIds?.[i] ??
                  i + 1;
                return (
                  <p key={`${sid}-${s.slice(0, 24)}`} className="truncate" title={s}>
                    <span className="tabular-nums text-[var(--muted-deep)]">{sid}.</span> {s}
                  </p>
                );
              })}
            </div>
          </details>
        ) : null}
      </StepCard>

      <StepCard step={2} title="Language & pipeline">
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="space-y-1.5">
            <span className="text-[11px] font-medium uppercase tracking-wide text-[var(--muted-deep)]">
              Source
            </span>
            <select
              value={sourceLang}
              onChange={(e) => setSourceLang(e.target.value)}
              disabled={!tenantOk}
              className="w-full rounded-lg border border-[var(--edge)] bg-[var(--bg0)] px-3 py-2 text-[13px] text-[var(--fg)]"
            >
              {LANG_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1.5">
            <span className="text-[11px] font-medium uppercase tracking-wide text-[var(--muted-deep)]">
              Target language
            </span>
            <select
              value={targetLang}
              onChange={(e) => setTargetLang(e.target.value)}
              disabled={!tenantOk}
              className="w-full rounded-lg border border-[var(--edge)] bg-[var(--bg0)] px-3 py-2 text-[13px] text-[var(--fg)]"
            >
              {LANG_OPTIONS.filter((o) => o.value !== sourceLang).map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1.5 sm:col-span-2">
            <span className="text-[11px] font-medium uppercase tracking-wide text-[var(--muted-deep)]">
              Batch size
            </span>
            <input
              type="number"
              min={10}
              max={500}
              value={batchSize}
              onChange={(e) => setBatchSize(Number(e.target.value))}
              disabled={!tenantOk}
              className="w-full max-w-[200px] rounded-lg border border-[var(--edge)] bg-[var(--bg0)] px-3 py-2 text-[13px] text-[var(--fg)]"
            />
            <span className="mt-1 block text-[11px] text-[var(--muted-deep)]">
              Larger batches mean fewer rounds through the translator — tune if uploads are huge.
            </span>
          </label>
        </div>
        <p className="text-[12px] leading-relaxed text-[var(--muted)]">
          The <strong className="font-medium text-[var(--fg-soft)]">Quality reviewer</strong> scores each batch on a{" "}
          <strong className="font-medium text-[var(--fg-soft)]">0–10</strong> scale; batches below your configured gate are retried (defaults follow{" "}
          <code className="rounded bg-[var(--panel)] px-1 py-0.5 font-mono text-[10px]">minTranslationScore</code>
          ). Exact thresholds appear on the live job card once the API persists the job record.
        </p>
      </StepCard>

      <div className="tw-wizard-stagger flex flex-wrap items-center gap-3">
        <Button
          type="button"
          size="sm"
          disabled={
            busySubmit ||
            !tenantOk ||
            ingestPhase !== "ready" ||
            sourceLang === targetLang
          }
          onClick={() => void startTranslation()}
        >
          {busySubmit ? "Sending…" : "Start translation"}
        </Button>
        {sourceLang === targetLang ? (
          <span className="text-[12px] text-amber-200/90">
            Pick a different target than the source language.
          </span>
        ) : null}
      </div>

      {activeJobId && jobLive ? (
        <div
          ref={jobLivePanelRef}
          className="relative overflow-hidden rounded-xl border border-[var(--accent)]/35 bg-[var(--accent)]/[0.06] p-5 shadow-[0_12px_48px_-24px_rgba(212,175,92,0.55)]"
        >
          <div className="pointer-events-none absolute -left-16 top-1/2 h-48 w-48 -translate-y-1/2 rounded-full bg-[var(--accent)]/[0.07] blur-3xl" />
          <div className="relative flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
            <div className="flex gap-3">
              <PipelinePulse />
              <div>
                <p className="font-[family-name:var(--font-serif)] text-lg font-semibold text-[var(--fg)]">
                  Job running — safe to leave
                </p>
                <p className="mt-1 max-w-prose text-[13px] leading-relaxed text-[var(--muted)]">
                  Progress saves automatically. Reload anytime;{" "}
                  <Link
                    href={`/jobs/${activeJobId}`}
                    className="font-medium text-[var(--accent-muted)] underline-offset-4 hover:underline"
                  >
                    open this job on the Jobs board
                  </Link>{" "}
                  for batch breakdowns, downloads, and previews when it completes.
                </p>
                <p className="mt-3 font-mono text-[11px] text-[var(--muted-deep)]">
                  job id · {activeJobId}
                </p>
              </div>
            </div>
            <div className="w-full shrink-0 md:max-w-xs">
              <div className="flex flex-wrap items-baseline justify-between gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--muted-deep)]">
                <span>{phaseLabel(jobLive.status)}</span>
                <span className="tabular-nums text-[var(--fg)]">
                  {Math.round(jobLive.progress)}%
                </span>
              </div>
              <ProgressBar value={jobLive.progress} />
              <p className="mt-2 text-[11px] text-[var(--muted)]">
                {langLabel(sourceLang)} → {langLabel(targetLang)}
                {jobLive.batchTotal != null ? (
                  <>
                    {" "}
                    · batches {jobLive.batchesCompleted ?? 0}/{jobLive.batchTotal}
                  </>
                ) : null}
                {jobLive.stringsTotal != null ? (
                  <> · {jobLive.stringsTotal.toLocaleString()} strings</>
                ) : null}
                {jobLive.judgePassScoreMin10 != null ? (
                  <>
                    {" "}
                    · reviewer gate ≥ {jobLive.judgePassScoreMin10.toFixed(1)}/10
                    {jobLive.minTranslationScoreStored != null ? (
                      <span className="text-[var(--muted-deep)]"> (job threshold)</span>
                    ) : (
                      <span className="text-[var(--muted-deep)]"> (default)</span>
                    )}
                  </>
                ) : null}
              </p>
            </div>
          </div>
        </div>
      ) : null}

      {fixturePeek && typeof document !== "undefined"
        ? createPortal(
            <div
              className="fixed inset-0 z-[500] flex items-center justify-center p-4 sm:p-8"
              role="dialog"
              aria-modal="true"
              aria-labelledby="fixturepeek-title"
            >
              <button
                type="button"
                className="absolute inset-0 bg-[var(--panel)]/85 backdrop-blur-sm"
                aria-label="Close preview"
                onClick={closeFixturePeek}
              />
              <div
                ref={fixturePanelRef}
                className="relative z-[1] flex max-h-[min(92vh,900px)] w-full max-w-[min(96vw,760px)] flex-col overflow-hidden rounded-2xl border border-[var(--edge)] bg-[var(--bg-elevated)] shadow-[0_32px_120px_-48px_rgba(0,0,0,0.9)]"
              >
            <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[var(--edge)] px-5 py-3.5">
              <div className="min-w-0 flex-1 space-y-2">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-[10px] uppercase tracking-wide text-[var(--muted)]">
                  <span className="rounded-md border border-[var(--edge)] bg-[var(--panel)] px-2 py-0.5 text-[var(--fg-soft)]">
                    {fixturePeek.format}
                  </span>
                  <span aria-hidden className="text-[var(--muted-deep)]">
                    ·
                  </span>
                  <span className="tabular-nums">
                    nominal {fixturePeek.approxStrings}&nbsp;strings
                  </span>
                  <span aria-hidden className="text-[var(--muted-deep)]">
                    ·
                  </span>
                  <span className="max-w-[min(52vw,20rem)] truncate normal-case tracking-normal text-[var(--muted-deep)]">
                    {fixtureBasename(fixturePeek.href)}
                  </span>
                </div>
                <div>
                  <p
                    id="fixturepeek-title"
                    className="font-[family-name:var(--font-serif)] text-xl font-bold tracking-tight text-[var(--fg)]"
                  >
                    {fixturePeek.title}
                  </p>
                  <p className="text-[12px] font-medium leading-snug text-[var(--fg-soft)]">
                    {fixturePeek.subtitle}
                  </p>
                  <p className="sr-only">
                    Peek is read-only. Load runs the Browse upload pipeline.
                  </p>
                  <p className="mt-1 hidden text-[11px] leading-relaxed text-[var(--muted-deep)] text-balance sm:block">
                    Peek is read-only. Load routes through Browse’s presigner. Escape closes.
                  </p>
                </div>
              </div>
              <Button type="button" variant="ghost" size="sm" onClick={closeFixturePeek}>
                Close
              </Button>
            </div>

            <div className="min-h-0 flex-1 overflow-hidden">
              {fixturePeekLoading ? (
                <p className="px-5 py-12 text-center text-[13px] text-[var(--muted)]">Staging sample…</p>
              ) : fixturePeekError ? (
                <p className="px-5 py-12 text-center text-[13px] text-red-200/90">{fixturePeekError}</p>
              ) : (
                <>
                  {fixturePeekTruncated ? (
                    <p className="border-b border-[var(--edge)] bg-[var(--panel)]/50 px-5 py-2 text-[11px] text-[var(--muted)]">
                      Large file — showing the first {FIXTURE_PREVIEW_CHAR_CAP.toLocaleString()} characters in
                      this pane; loading still uses the full catalog.
                    </p>
                  ) : null}
                  <pre className="max-h-[min(54vh,620px)] overflow-auto whitespace-pre-wrap break-words px-5 py-4 font-mono text-[11px] leading-relaxed text-[var(--fg-soft)]">
                    {fixturePeekText}
                  </pre>
                </>
              )}
            </div>

            <div className="border-t border-[var(--edge)] bg-[var(--bg0)]/40 px-5 py-4">
              <details className="group/save rounded-lg border border-dashed border-[var(--edge-bright)] bg-[var(--panel)]/30">
                <summary className="cursor-pointer list-none px-3 py-2 text-[11px] font-medium uppercase tracking-wide text-[var(--muted)] transition group-open/save:text-[var(--fg-soft)] [&::-webkit-details-marker]:hidden">
                  <span className="inline-flex items-center gap-2">
                    <span
                      className="inline-block rotate-0 text-[var(--muted-deep)] transition group-open/save:rotate-90"
                      aria-hidden
                    >
                      ▸
                    </span>
                    Keep a local copy
                  </span>
                </summary>
                <div className="border-t border-[var(--edge)] px-3 py-2.5">
                  <p className="mb-2 text-[11px] leading-relaxed text-[var(--muted)]">
                    Same file the peek shows — attach to tickets or diff locally.
                  </p>
                  <a
                    href={fixturePeek.href}
                    download={fixtureBasename(fixturePeek.href)}
                    className="inline-flex items-center gap-2 rounded-lg border border-[var(--edge)] bg-[var(--bg0)] px-3 py-1.5 text-[12px] font-medium text-[var(--fg)] transition hover:border-[var(--accent-muted)]"
                  >
                    Download {fixtureBasename(fixturePeek.href)}
                  </a>
                </div>
              </details>

              <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
                <Button type="button" variant="ghost" size="sm" onClick={closeFixturePeek}>
                  Dismiss
                </Button>
                <Button
                  type="button"
                  size="sm"
                  disabled={
                    !tenantOk ||
                    !fixtureBlob ||
                    fixturePeekLoading ||
                    Boolean(fixturePeekError) ||
                    ingestPhase === "uploading" ||
                    ingestPhase === "previewing"
                  }
                  onClick={() => void ingestFromFixturePeek()}
                >
                  Load into wizard
                </Button>
              </div>
            </div>
          </div>
        </div>,
            document.body,
          )
        : null}

      {error ? (
        <p className="rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-[13px] text-red-200">
          {error}
        </p>
      ) : null}
    </div>
  );
}
