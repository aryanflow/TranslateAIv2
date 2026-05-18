# Aptos Translate AI v2 — User Guide

This guide is for **operators**, **localization engineers**, and **support** who use the web application to translate retail / POS catalog files, tune prompts, manage glossary entries, and monitor system health. Technical deployment detail lives in `docs/ARCHITECTURAL_SIGNOFF.md` and `docs/ARCHITECTURE.md`.

---

## 1. What the product does

- **Ingest** large catalog files (XML, JSON, CSV, Excel) stored in **S3-compatible** object storage after a **presigned upload**.
- **Extract** user-facing strings with format-aware parsers (streaming where possible).
- For each **target language**, run a **two-step LLM pipeline**: **translator** (Amazon Bedrock) then **quality reviewer / judge** (separate Bedrock model). Strings are processed in **batches**; batches can **retry** when the judge score is below your threshold.
- **Regenerate** translated files preserving structure (tags, placeholders, columns) and write **QA artifacts** (JSON bundle + CSV) to S3.
- **Configure** per-tenant **prompts** (system + user layers per source→target pair) and **term preferences** (preferred target wording).

---

## 2. Roles & access (current prototype)

| Concept | Behavior today |
|--------|------------------|
| **Tenant** | All jobs, prompts, glossary rows, and files are scoped to a **tenant ID**. The API expects `X-Tenant-Id` on requests (or `tenantId` query for **EventSource/SSE**, which cannot send custom headers). |
| **Development** | Local dev often uses `NEXT_PUBLIC_DEV_TENANT_ID` (see repo `.env.example`) so the browser sends a fixed tenant UUID. |
| **Sign-in** | Google OAuth may be present in the app shell; **API authorization** for tenant-scoped routes is enforced via **TenantGuard** + your deployment’s auth story. Confirm with your administrator how production maps users → `Tenant`. |

If API calls return **401 Missing X-Tenant-Id**, the web client is not sending the tenant header.

---

## 3. Local / staging prerequisites

1. **PostgreSQL 16** — schema managed by **Prisma** (`apps/api/prisma/schema.prisma`).
2. **Redis 7** — **BullMQ** job queue and **pub/sub** for job progress SSE.
3. **S3-compatible storage** — AWS S3 or **MinIO** (docker compose profile `full`).
4. **Nest API** — default port **3001** (configurable `PORT`).
5. **Next.js web** — default port **3000**; proxies API traffic via **`/api/upstream/*`** using `API_PROXY_TARGET` or `NEXT_PUBLIC_API_URL`.

**Quick dependency start (repo root):**

```bash
pnpm compose:deps          # postgres + redis
# optional object storage:
pnpm compose:full-deps     # postgres + redis + minio
```

Apply database schema (from repo root):

```bash
pnpm db:migrate:deploy     # or `pnpm db:push` in early dev — see team policy
pnpm db:seed               # optional seed data
```

**Run app (recommended):**

```bash
pnpm dev                   # turbo: API + web together
# or two terminals:
pnpm dev:api
pnpm dev:web
```

**Important:** Running **only** the web app without the API yields **502** / “proxy could not reach API” for `/api/upstream/*`. Always run the API for full functionality.

---

## 4. Application map (where to click)

| Area | Route (App Router) | Purpose |
|------|-------------------|---------|
| **Translate** | `/translate` | Upload wizard: file → options → start job. |
| **Jobs** | `/jobs` | Recent jobs list. |
| **Job detail** | `/jobs/[jobId]` | Live log (SSE), progress, downloads when complete, cancel. |
| **Prompts** | `/prompts` | Edit **system** + **user** prompt templates per `(sourceLang, targetLang)`. |
| **Glossary** | `/glossary` | Term **preferences**: source phrase → preferred target for a language pair. |
| **Health** | `/health` | Dependency grid (Postgres, Redis, S3, translator, judge) + **build/version** panel. |

The dashboard layout may prefetch health/version data in the background for faster first paint on **Health**.

---

## 5. End-to-end: running a translation job

### 5.1 Upload file to object storage

1. Open **Translate**.
2. Request a **presigned URL** from the API (the UI does this when you pick a file): `POST /files/presigned-url` with file name and content type.
3. The browser **uploads directly to S3** using the returned URL and `fileKey`. The API never buffers the whole file in memory.

**Constraints:** File must be in a format the extractors support (XML, JSON, CSV, Excel — see extractor behavior in code / support docs). Very large files are intended to work via streaming extractors.

### 5.2 Choose languages & job parameters

- **Source language** — BCP-47–style code (e.g. `en`, `en-US`); must match how prompts and glossary are keyed.
- **One or more target languages** — each target runs as a **separate pass** over the same extracted strings (sequential per job: `for (const targetLang of job.targetLangs)` in the orchestrator).

**Batch size (`batchSize`):**

- Default **50** strings per batch (API validation: **1–2000**).
- Smaller batches: more Bedrock calls, finer retries, higher overhead.
- Larger batches: fewer calls, each request heavier; risk of model truncation or weaker per-string attention — tune empirically.

**Quality threshold (`minTranslationScore`):**

- Stored on the job as **0–1** (e.g. `0.7` → judge threshold **7.0 / 10**).
- If the judge scores any string in a batch **below** that threshold, the orchestrator **re-translates that whole batch** up to **`maxBatchRetries`** (default **3** from Prisma; API allows **0–20**).

**Important behavior:** On the **last** attempt, if scores are still below threshold, the job **still completes** with those translations; QA rows mark `meets_accuracy_threshold: false`. Only **thrown errors** (e.g. Bedrock hard failure) fail the entire job.

### 5.3 CSV / Excel column selection

For tabular formats, you can pass **`extractOptions.selectedColumns`**: an array of **header names** whose cells should be treated as translatable copy. If omitted, extractor defaults apply (see `ExtractorsService` / format-specific logic).

After changing column selection, use the UI **preview** flow (if present) to refetch sample rows before creating the job.

### 5.4 Prompts & glossary applied automatically

For each `(tenantId, sourceLang, targetLang)` the orchestrator loads:

1. **`PromptTemplate`** — `systemText` + `userText` (with variable substitution for glossary, language names, etc.).
2. **`TermPreference`** rows for that pair — serialized into a **glossary JSON block** in the user template.

You do **not** paste prompts per job in the wizard unless the product explicitly adds that; defaults come from the **Prompts** page.

### 5.5 Start job

Submitting **`POST /jobs`** creates a `Job` row (`status: pending`) and enqueues a **BullMQ** job (`translate-queue.service.ts`) with the same id as the Prisma job id.

**Queue worker concurrency:** `TRANSLATE_WORKER_CONCURRENCY` (default **1**) controls how many **different** translation jobs run at once in one API process. If you start two jobs, the second may **wait** in Redis until the first finishes — that is expected unless you raise concurrency (watch Bedrock quotas).

---

## 6. Monitoring a job (`/jobs/[jobId]`)

### 6.1 Progress & phases

Job `status` progresses roughly:

`pending` → `extracting` → `chunking` → `translating` / `scoring` (interleaved during batches) → `regenerating` → `completed` (or `failed` / `cancelled`).

**SSE** (`GET /jobs/:id/events`): the UI opens **EventSource** to the **proxied** URL with `tenantId` query. Payloads include `phase`, `detail`, `percent`, `batchIndex`, `attempt`, and (on retries) structured fields like `retryReason`, `judgeThreshold10`, `worstStringIds`.

### 6.2 What retry lines mean

| Situation | What you see (conceptually) |
|-----------|------------------------------|
| Judge scores below threshold, attempts remain | One consolidated line when the **next** translate attempt starts: **translate attempt N/M after low judge scores** with summary (how many under threshold, min/avg/max). |
| Judge call failed (degraded fallback scores) | `SCORING_DEGRADED_FALLBACK` in logs / payload; `JobBatch.lastErrorCode` may be **`SCORING_FAILED`**. |
| Last attempt still low | Server log: **accepting batch after max retries**; job continues. |

### 6.3 Cancel

**Cancel** sets `Job.status` to `cancelled`, publishes SSE, and tries to remove the job from the **waiting** BullMQ queue if it has not started yet. An in-flight orchestrator loop checks cancellation between phases.

### 6.4 Results

When `completed`, **`GET /jobs/:id/result`** returns **`translatedFileUrls`** (S3 keys / URLs depending on API shape) plus QA summary fields. The UI may offer download via presigned GET URLs.

Artifacts typically include:

- Regenerated **catalog file** per target language (`.xml`, `.json`, `.csv`, `.xlsx` by format).
- **`.qa-bundle.json`** — per-string original, translation, judge score, notes, `meets_accuracy_threshold`, attempt number.
- **`.translation-review.csv`** — spreadsheet-friendly review export.

---

## 7. Prompts (`/prompts`)

### 7.1 Two layers

| Layer | Typical content |
|-------|-----------------|
| **System** | Global role, POS context, non‑negotiables (mnemonics, placeholders, Latin tokens). |
| **User** | Tone, variables, glossary injection placeholders (e.g. `{{glossary_block}}`, `{{terminology_reference}}`). |

Prompts are **per language pair** `(sourceLang, targetLang)` with **optimistic concurrency** via optional **`expectedVersion`** on PUT — if someone else saved, you get a conflict and should reload.

### 7.2 Variables

Substituted keys are implemented in `apps/api/src/llm/prompt-builder.ts` (e.g. `glossary_block`, `terminology_reference`, `source_lang`, `target_lang`, `target_language_name`). The **Translate** wizard does not need to list them if templates already include them.

---

## 8. Glossary / term preferences (`/glossary`)

- **Purpose:** When the source contains a phrase, force the **preferred** target wording (synonym lock-in for POS).
- **Scope:** `(tenantId, sourceLang, targetLang)`.
- **API:** list/create/patch/delete under `/glossary` (see OpenAPI).

Longest-match or precedence rules for overlapping terms — confirm with product/engineering if multiple rows could match one string.

---

## 9. Health & dependencies (`/health`)

- **Dependency grid** calls **`GET /health/deps`** (via `/api/upstream/...`) and shows **PostgreSQL**, **Redis**, **S3**, **Translator** Bedrock ping, **Judge** Bedrock ping.
- **Build** panel calls **`GET /version`** for service name, semver, git SHA, Node version, build time.
- **Refresh** invalidates React Query keys to re-fetch.

**Performance note:** The API runs infra checks and both LLM pings **in parallel**; health probes use a **single Bedrock attempt** (no long retry backoff) so the grid loads faster than full translation calls.

---

## 10. Configuration cheat sheet (operators)

Values are documented in **repo** `.env.example` files (`/` and `apps/api/.env.example`). Commonly tuned:

| Variable | Effect |
|----------|--------|
| `TRANSLATION_BATCH_CONCURRENCY` | Parallel **batches per target language** inside one job (default **8**, max **24**). Raise for throughput; lower if Bedrock throttles. |
| `TRANSLATE_WORKER_CONCURRENCY` | Parallel **jobs** in BullMQ worker (default **1**). |
| `DISABLE_TRANSLATE_WORKER` | If `true`, API does not consume the queue (orchestrator never runs workers in that process). |
| `BEDROCK_TRANSLATION_MODEL_ID` / `BEDROCK_SCORING_MODEL_ID` | Bedrock model ids or inference profile ARNs. |
| `MAX_RETRIES` / `RETRY_DELAY_BASE` / `MAX_RETRY_DELAY` | Bedrock **translation/scoring** retries (not health pings when overridden). |
| `API_PROXY_TARGET` | Next.js server-side proxy target for Nest (use **Docker service name** inside compose, not `localhost`). |

---

## 11. Troubleshooting

| Symptom | Likely cause | What to try |
|---------|--------------|-------------|
| **502** on API-backed pages | Next proxy cannot reach Nest | Run `pnpm dev:api` or `pnpm dev`; set `API_PROXY_TARGET` / `NEXT_PUBLIC_API_URL`. |
| Job stays **pending** forever | Worker off or Redis down | `DISABLE_TRANSLATE_WORKER` unset/false; Redis reachable; check API logs. |
| Second job “stuck” | Worker concurrency 1 | Expected: queue. Raise `TRANSLATE_WORKER_CONCURRENCY` cautiously. |
| SSE log stops updating | Redis pub/sub disconnect / proxy timeout | Check API logs, Redis, browser devtools EventSource errors. |
| Translator **degraded** on Health | Bad model id, IAM, region, or throttle | Bedrock console model access; CloudWatch; try smaller probe by fixing config (not a UI issue). |
| Many **low judge** retries | Threshold too high vs model quality | Lower `minTranslationScore` slightly; improve prompts; change judge model. |
| **Cancelled** enum errors on cancel | DB migration lag | Run Prisma migrations so `JobStatus` includes `cancelled`. |

---

## 12. Where to get API truth

- **OpenAPI JSON:** `GET /api/openapi.json` on the Nest server (or via `/api/upstream/openapi.json` through Next in dev).
- **Contracts package:** `@aptos-translate/contracts` — Zod schemas shared with the API for job bodies, prompts, glossary.

---

## 13. Support checklist (when opening a ticket)

1. **Job id** (UUID) and **tenant id**.  
2. **Approximate time (UTC)** of failure.  
3. **Job status** and last lines from the **job log** (SSE).  
4. **`GET /jobs/:id/batches/:batchId`** for the failing batch index if support gave you one.  
5. **`GET /version`** output from the API pod/instance.  
6. Whether **Health** shows Postgres/Redis/S3/translator/judge all **up**.

---

*This guide reflects the repository as of its last update. For structural / security sign-off, see `docs/ARCHITECTURAL_SIGNOFF.md`.*
