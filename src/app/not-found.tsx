import type { Metadata } from "next";
import { NotFoundContent } from "@/components/site/not-found-content";

export const metadata: Metadata = {
  title: "Page not found",
  robots: { index: false, follow: false },
};

/** Root boundary: catches URLs that don't match any route at all. */
export default function NotFound() {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-background">
      <NotFoundContent />
    </main>
  );
}
