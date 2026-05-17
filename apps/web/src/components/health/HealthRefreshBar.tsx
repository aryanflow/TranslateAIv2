"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { healthDepsQueryKey, upstreamVersionQueryKey } from "@/lib/health-queries";

export function HealthRefreshBar() {
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);

  const refresh = async () => {
    setBusy(true);
    try {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: healthDepsQueryKey }),
        queryClient.invalidateQueries({ queryKey: upstreamVersionQueryKey }),
      ]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => void refresh()}>
      {busy ? "Refreshing…" : "Refresh checks"}
    </Button>
  );
}
