import Image from "next/image";
import { cn } from "@/lib/utils/cn";

/** The supplied PUBLIQ Superclub artwork, with its black background removed. */
export function PubliqLogo({ className, decorative = false }: { className?: string; decorative?: boolean }) {
  return (
    <Image
      src="/images/publiq-logo.png"
      alt={decorative ? "" : "PUBLIQ Superclub"}
      width={1044}
      height={585}
      className={cn("h-auto w-28 object-contain", className)}
    />
  );
}

/** The crown-and-diamond emblem from the same artwork, for compact spaces. */
export function PubliqEmblem({ className }: { className?: string }) {
  return <Image src="/images/publiq-emblem.png" alt="" width={297} height={335} className={cn("h-9 w-8 object-contain", className)} />;
}
