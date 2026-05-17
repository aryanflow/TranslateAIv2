import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function SignInPage() {
  return (
    <div className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center">
      <div className="animate-in rounded-2xl border border-[var(--edge)] bg-gradient-to-b from-[var(--bg-elevated)]/95 to-[var(--panel)]/90 p-8 shadow-[0_24px_80px_-32px_rgba(0,0,0,0.85)]">
        <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[var(--accent-muted)]">Sign in</p>
        <h1 className="mt-2 font-[family-name:var(--font-serif)] text-2xl font-extrabold tracking-tight text-[var(--fg)]">
          Welcome back
        </h1>
        <p className="mt-3 text-sm leading-relaxed text-[var(--muted)]">
          This screen is static in the current workspace build — use Skip to workspace for the dashboard.
        </p>
        <Button className="mt-8 w-full" type="button" variant="outline" disabled>
          Continue with Google
        </Button>
        <p className="mt-6 text-center text-xs text-[var(--muted-deep)]">
          <Link href="/translate" className="text-[var(--accent-muted)] underline-offset-4 transition hover:text-[var(--accent)] hover:underline">
            Skip to workspace
          </Link>
        </p>
      </div>
    </div>
  );
}
