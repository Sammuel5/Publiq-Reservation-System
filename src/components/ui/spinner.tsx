import { cn } from "@/lib/utils/cn";

export function Spinner({
  className,
  label = "Loading",
}: {
  className?: string;
  label?: string;
}) {
  return (
    <span role="status" aria-live="polite" className="inline-flex items-center gap-2">
      <span
        aria-hidden
        className={cn(
          "size-4 animate-spin rounded-full border-2 border-gold border-t-transparent",
          className,
        )}
      />
      <span className="sr-only">{label}</span>
    </span>
  );
}

export function FullPageLoader({ label = "Loading" }: { label?: string }) {
  return (
    <div className="flex min-h-[50vh] w-full items-center justify-center">
      <div className="flex flex-col items-center gap-3">
        <Spinner className="size-6" label={label} />
        <p className="text-sm text-muted">{label}</p>
      </div>
    </div>
  );
}
