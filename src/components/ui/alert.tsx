import * as React from "react";
import { AlertCircle, CheckCircle2, Info, TriangleAlert } from "lucide-react";
import { cn } from "@/lib/utils/cn";

type Tone = "info" | "success" | "warning" | "danger";

const TONE: Record<Tone, { wrap: string; icon: React.ElementType }> = {
  info: { wrap: "border-info/30 bg-info/8 text-[#cfe0ff]", icon: Info },
  success: { wrap: "border-success/30 bg-success/8 text-[#c9f5d7]", icon: CheckCircle2 },
  warning: { wrap: "border-warning/30 bg-warning/8 text-[#f7e6a8]", icon: TriangleAlert },
  danger: { wrap: "border-danger/30 bg-danger/8 text-[#ffd0d0]", icon: AlertCircle },
};

export function Alert({
  tone = "info",
  title,
  children,
  className,
  role = "status",
}: {
  tone?: Tone;
  title?: string;
  children?: React.ReactNode;
  className?: string;
  role?: "status" | "alert";
}) {
  const { wrap, icon: Icon } = TONE[tone];
  return (
    <div
      role={role}
      className={cn("flex gap-3 rounded-md border p-3.5 text-sm leading-relaxed", wrap, className)}
    >
      <Icon aria-hidden className="mt-0.5 size-4 shrink-0" />
      <div className="min-w-0 space-y-1">
        {title ? <p className="font-semibold">{title}</p> : null}
        {children ? <div className="text-[13px] opacity-90">{children}</div> : null}
      </div>
    </div>
  );
}
