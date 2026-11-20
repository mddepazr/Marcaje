import { useEffect } from "react";
import { Banner } from "@astryxdesign/core/Banner";

export interface ToastData {
  type: "success" | "error" | "info";
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
    const t = setTimeout(onClose, 4500);
    return () => clearTimeout(t);
  }, [toast, onClose]);

  if (!toast) return null;

  return (
    <div className="fixed bottom-5 right-5 z-50 w-full max-w-sm">
      <Banner
        status={toast.type === "error" ? "error" : toast.type === "success" ? "success" : "info"}
        title={toast.title}
        description={toast.message}
        container="card"
        elevation="high"
        isDismissable
        onDismiss={onClose}
      />
    </div>
  );
}
