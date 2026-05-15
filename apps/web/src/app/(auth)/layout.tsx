import type { ReactNode } from "react";
import Link from "next/link";

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-full flex-col">
      <header className="relative z-[2] flex items-center justify-between border-b border-[var(--edge)] px-6 py-4">
        <Link
          href="/translate"
          className="font-[family-name:var(--font-serif)] text-sm font-bold tracking-tight text-[var(--fg)] transition hover:text-[var(--accent)]"
        >
          Aptos Translate
        </Link>
        <span className="text-[10px] font-medium uppercase tracking-[0.18em] text-[var(--muted-deep)]">
          Secure area
        </span>
      </header>
      <div className="relative z-[2] flex flex-1 flex-col px-4 py-12 sm:px-8">{children}</div>
    </div>
  );
}
