import Link from "next/link";
import { ArrowRight, Compass } from "lucide-react";
import { Button } from "@/components/ui/button";

/** Shared 404 body — used by both the site-group and the root not-found pages. */
export function NotFoundContent() {
  return (
    <div className="mx-auto flex w-full max-w-lg flex-col items-center px-5 py-20 text-center sm:px-8 sm:py-28">
      <span className="grid size-12 place-items-center rounded-full border border-line bg-card">
        <Compass aria-hidden className="size-5 text-gold" />
      </span>
      <p className="mt-5 font-mono text-[11.5px] uppercase tracking-[0.18em] text-faint">
        Error 404
      </p>
      <h1 className="mt-2 font-display text-3xl tracking-tight sm:text-4xl">
        This page has left the party
      </h1>
      <p className="mt-3 text-[13.5px] leading-relaxed text-muted">
        The page you were looking for isn&apos;t here. It may have moved, or the link may be
        out of date.
      </p>
      <div className="mt-7 flex flex-col gap-2 sm:flex-row">
        <Button asChild>
          <Link href="/">
            Back to the club
            <ArrowRight className="size-4" />
          </Link>
        </Button>
        <Button asChild variant="secondary">
          <Link href="/spaces">Explore seating</Link>
        </Button>
      </div>
    </div>
  );
}
