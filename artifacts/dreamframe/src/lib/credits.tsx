import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { describeFetchFailure } from "@workspace/api-client-react";

// Mirror of the per-feature prices in
// `artifacts/api-server/src/lib/credits.ts`. Keep in sync — server is the
// source of truth, this is only used for displaying cost hints in the UI
// before submission.
export const CREDIT_COSTS = {
  bgReplace: 50,
  bgReplaceFixFace: 15,
  scene: {
    "runway-gen-4.5": (d: number) => (d >= 10 ? 95 : d >= 8 ? 72 : 55),
    "kling-2.1":    (d: number) => (d >= 10 ? 120 : 60),
    "hailuo-02":    (d: number) => (d >= 10 ? 55  : 35),
    "pixverse-4.5": (_d: number) => 40,
    "wan-2.2-i2v":  (_d: number) => 25,
  } as Record<string, (d: number) => number>,
};

type CreditsResp = { credits: number };
type GrantResp   = { credits: number; granted: number };

export function useCredits() {
  return useQuery<CreditsResp>({
    queryKey: ["credits"],
    queryFn: async () => {
      try {
        const r = await fetch("/api/credits", { credentials: "include" });
        if (!r.ok) {
          const t = await r.text();
          let body: { error?: string } = {};
          try {
            body = t ? JSON.parse(t) : {};
          } catch {
            /* ignore */
          }
          throw new Error(typeof body.error === "string" ? body.error : `Failed to load credits (${r.status})`);
        }
        return r.json();
      } catch (e) {
        throw new Error(describeFetchFailure(e instanceof Error ? e : new Error(String(e))));
      }
    },
    refetchOnWindowFocus: true,
    staleTime: 10_000,
  });
}

export function useGrantTestCredits() {
  const qc = useQueryClient();
  return useMutation<GrantResp>({
    mutationFn: async () => {
      try {
        const r = await fetch("/api/credits/grant-test", {
          method: "POST",
          credentials: "include",
        });
        const raw = await r.text();
        let data: { error?: string; credits?: number; granted?: number } = {};
        try {
          data = raw ? JSON.parse(raw) : {};
        } catch {
          throw new Error(raw.trim() ? raw.slice(0, 400) : `Could not grant test credits (${r.status})`);
        }
        if (!r.ok) throw new Error(typeof data.error === "string" ? data.error : "Could not grant test credits");
        return data as GrantResp;
      } catch (e) {
        throw new Error(describeFetchFailure(e instanceof Error ? e : new Error(String(e))));
      }
    },
    onSuccess: (data) => {
      qc.setQueryData(["credits"], { credits: data.credits });
    },
  });
}
