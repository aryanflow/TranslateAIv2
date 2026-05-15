"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useShellStore } from "@/lib/stores/shell";
import { cn } from "@/lib/utils";

const links = [
  {
    href: "/translate",
    label: "Translate",
    hint: "Upload & jobs",
    icon: (
      <svg className="h-4 w-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75">
        <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8l-6-6z" strokeLinejoin="round" />
        <path d="M14 2v6h6M12 18v-6M9 15h6" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    href: "/jobs",
    label: "Jobs",
    hint: "Queue & SSE",
    icon: (
      <svg className="h-4 w-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75">
        <path d="M4 6h16M4 12h10M4 18h14" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    href: "/prompts",
    label: "Prompts",
    hint: "System + user",
    icon: (
      <svg className="h-4 w-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75">
        <path d="M8 6h12M8 12h8M8 18h12M4 6h.01M4 12h.01M4 18h.01" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    href: "/glossary",
    label: "Terms",
    hint: "POS preferences",
    icon: (
      <svg className="h-4 w-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75">
        <path d="M4 19V5M8 19V9m4 10V7m4 12v-6" strokeLinecap="round" />
      </svg>
    ),
  },
  {
    href: "/health",
    label: "Health",
    hint: "Deps & build",
    icon: (
      <svg className="h-4 w-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75">
        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" strokeLinejoin="round" />
      </svg>
    ),
  },
] as const;

export function DashboardNav() {
  const pathname = usePathname();
  const { sidebarOpen, toggleSidebar } = useShellStore();

  return (
    <aside
      className={cn(
        "relative z-[2] flex shrink-0 flex-col border-r border-[var(--edge)] bg-[var(--panel)]/95 shadow-[4px_0_24px_rgba(0,0,0,0.35)] backdrop-blur-md transition-[width] duration-300 ease-out",
        sidebarOpen ? "w-[248px]" : "w-[68px]",
      )}
      data-collapsed={!sidebarOpen}
    >
      <div className="flex h-[52px] items-center gap-2 border-b border-[var(--edge)] px-3">
        <div
          className={cn(
            "flex min-w-0 flex-1 flex-col",
            !sidebarOpen && "items-center",
          )}
        >
          <span
            className={cn(
              "font-[family-name:var(--font-serif)] text-[15px] font-extrabold leading-none tracking-tight text-[var(--fg)]",
              !sidebarOpen && "sr-only",
            )}
          >
            Aptos
          </span>
          {sidebarOpen ? (
            <span className="mt-0.5 text-[10px] font-medium uppercase tracking-[0.22em] text-[var(--muted-deep)]">
              Translate
            </span>
          ) : null}
        </div>
        <button
          type="button"
          onClick={toggleSidebar}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-transparent text-[var(--muted)] transition hover:border-[var(--edge-bright)] hover:bg-[var(--panel-hover)] hover:text-[var(--fg)]"
          aria-label={sidebarOpen ? "Collapse sidebar" : "Expand sidebar"}
        >
          <svg
            className={cn("h-4 w-4 transition-transform duration-300", !sidebarOpen && "rotate-180")}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path d="M15 6l-6 6 6 6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>

      <div className="px-3 pt-4">
        {sidebarOpen ? (
          <p className="px-2 pb-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-[var(--muted-deep)]">
            Workspace
          </p>
        ) : null}
        <nav className="flex flex-col gap-1" aria-label="Primary">
          {links.map((l) => {
            const active = pathname === l.href || pathname.startsWith(`${l.href}/`);
            return (
              <Link
                key={l.href}
                href={l.href}
                title={!sidebarOpen ? `${l.label} — ${l.hint}` : undefined}
                className={cn(
                  "group relative flex items-center gap-3 rounded-lg py-2.5 text-sm transition-colors duration-200",
                  sidebarOpen ? "px-2.5" : "justify-center px-0",
                  active
                    ? "bg-[var(--accent-dim)] text-[var(--fg)]"
                    : "text-[var(--muted)] hover:bg-[var(--panel-hover)] hover:text-[var(--fg-soft)]",
                )}
              >
                {active ? (
                  <span
                    className="absolute left-0 top-1/2 h-7 w-[3px] -translate-y-1/2 rounded-full bg-[var(--accent)] shadow-[0_0_12px_var(--accent-glow)]"
                    aria-hidden
                  />
                ) : null}
                <span
                  className={cn(
                    "flex shrink-0 items-center justify-center transition-colors",
                    active ? "text-[var(--accent)]" : "text-[var(--muted-deep)] group-hover:text-[var(--fg-soft)]",
                  )}
                >
                  {l.icon}
                </span>
                {sidebarOpen ? (
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{l.label}</span>
                    <span className="block truncate text-[11px] text-[var(--muted-deep)]">{l.hint}</span>
                  </span>
                ) : null}
              </Link>
            );
          })}
        </nav>
      </div>

      <div className="mt-auto border-t border-[var(--edge)] p-3">
        <Link
          href="/sign-in"
          className={cn(
            "flex items-center gap-2 rounded-lg py-2 text-xs font-medium text-[var(--muted)] transition hover:bg-[var(--panel-hover)] hover:text-[var(--fg-soft)]",
            sidebarOpen ? "px-2.5" : "justify-center px-0",
          )}
        >
          <svg className="h-4 w-4 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75">
            <circle cx="12" cy="8" r="3" />
            <path d="M5 20a7 7 0 0114 0" strokeLinecap="round" />
          </svg>
          {sidebarOpen ? <span>Account</span> : null}
        </Link>
      </div>
    </aside>
  );
}
