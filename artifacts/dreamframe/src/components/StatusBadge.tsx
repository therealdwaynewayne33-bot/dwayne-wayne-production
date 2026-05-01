import { cn } from "@/lib/utils";

type Status = "queued" | "processing" | "completed" | "failed" | "draft";

const config: Record<Status, { label: string; classes: string }> = {
  queued: { label: "Queued", classes: "bg-zinc-700/60 text-zinc-300" },
  processing: { label: "Processing", classes: "bg-blue-500/20 text-blue-400 animate-pulse" },
  completed: { label: "Completed", classes: "bg-emerald-500/20 text-emerald-400" },
  failed: { label: "Failed", classes: "bg-red-500/20 text-red-400" },
  draft: { label: "Draft", classes: "bg-zinc-700/60 text-zinc-400" },
};

export function StatusBadge({ status }: { status: string }) {
  const s = status as Status;
  const { label, classes } = config[s] ?? { label: status, classes: "bg-zinc-700/60 text-zinc-400" };
  return (
    <span data-testid={`status-${status}`} className={cn("text-[11px] font-semibold uppercase tracking-widest px-2 py-0.5 rounded", classes)}>
      {label}
    </span>
  );
}
