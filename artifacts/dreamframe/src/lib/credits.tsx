import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

// Mirror of the per-feature prices in
// `artifacts/api-server/src/lib/credits.ts`. Keep in sync — server is the
// source of truth, this is only used for displaying cost hints in the UI
// before submission.
export const CREDIT_COSTS = {
  bgReplace: 50,
  bgReplaceFixFace: 15,
  scene: {
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
      const r = await fetch("/api/credits", { credentials: "include" });
      if (!r.ok) throw new Error("Failed to load credits");
      return r.json();
    },
    refetchOnWindowFocus: true,
    staleTime: 10_000,
  });
}

export function useGrantTestCredits() {
  const qc = useQueryClient();
  return useMutation<GrantResp>({
    mutationFn: async () => {
      const r = await fetch("/api/credits/grant-test", {
        method: "POST",
        credentials: "include",
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error ?? "Could not grant test credits");
      return data;
    },
    onSuccess: (data) => {
      qc.setQueryData(["credits"], { credits: data.credits });
    },
  });
}
