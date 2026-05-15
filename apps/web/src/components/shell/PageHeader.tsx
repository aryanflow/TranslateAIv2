import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

type PageHeaderProps = {
  eyebrow?: string;
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  className?: string;
};

export function PageHeader({ eyebrow, title, description, actions, className }: PageHeaderProps) {
  return (
    <header
      className={cn(
        "animate-in border-b border-[var(--edge)] pb-8",
        className,
      )}
    >
      <div className="flex flex-col gap-6 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 space-y-2">
          {eyebrow ? (
            <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[var(--accent-muted)]">
              {eyebrow}
            </p>
          ) : null}
          <h1 className="font-[family-name:var(--font-serif)] text-3xl font-bold tracking-tight text-[var(--fg)] sm:text-[2rem] sm:leading-tight">
            {title}
          </h1>
          {description ? (
            <div className="max-w-2xl text-[15px] leading-relaxed text-[var(--muted)]">{description}</div>
          ) : null}
        </div>
        {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
    </header>
  );
}
