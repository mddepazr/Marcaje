import { useEffect } from "react";
import { AlertCircle, CheckCircle2, X } from "lucide-react";

export interface ToastData {
  type: "success" | "error";
  title: string;
  message: string;
}

interface Props {
  toast: ToastData | null;
  onClose: () => void;
}

export function Toast({ toast, onClose }: Props) {
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(onClose, 4500);
    return () => clearTimeout(timer);
  }, [toast, onClose]);

  if (!toast) return null;

  const isSuccess = toast.type === "success";

  return (
    <div className="fixed bottom-5 right-5 z-50 w-full max-w-sm animate-bounce-once">
      <div
        className={`flex items-start gap-3 rounded-2xl border p-4 shadow-2xl backdrop-blur-md ${
          isSuccess
            ? "border-emerald-500/40 bg-slate-900/95 text-emerald-200"
            : "border-rose-500/40 bg-slate-900/95 text-rose-200"
        }`}
      >
        {isSuccess ? (
          <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-400" />
        ) : (
          <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-rose-400" />
        )}
        <div className="flex-1">
          <p className="text-sm font-bold text-white">{toast.title}</p>
          <p className="mt-0.5 text-xs opacity-90">{toast.message}</p>
        </div>
        <button
          onClick={onClose}
          className="rounded-lg p-1 text-slate-400 hover:bg-slate-800 hover:text-white"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
