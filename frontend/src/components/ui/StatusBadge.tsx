import { CheckCircle2, XCircle } from "lucide-react";

interface Props {
  label: string;
  active: boolean;
}

export function StatusBadge({ label, active }: Props) {
  return (
    <div
      className={`flex items-center justify-between rounded-xl border px-3.5 py-2.5 text-sm font-medium transition ${
        active
          ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
          : "border-rose-500/30 bg-rose-500/10 text-rose-300"
      }`}
    >
      <span>{label}</span>
      {active ? <CheckCircle2 className="h-4 w-4 text-emerald-400" /> : <XCircle className="h-4 w-4 text-rose-400" />}
    </div>
  );
}
