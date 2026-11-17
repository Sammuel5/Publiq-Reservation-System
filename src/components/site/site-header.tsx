"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { CalendarCheck, Menu, Phone } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { PubliqLogo } from "@/components/brand/publiq-logo";
import { Button } from "@/components/ui/button";

const NAV_LINKS = [
  { label: "Home", href: "/" },
  { label: "Seating", href: "/spaces" },
  { label: "About", href: "/about" },
  { label: "Contact", href: "/contact" },
  { label: "My booking", href: "/my-seating-bookings" },
] as const;

/**
 * Sticky site navigation.
 * Transparent over the hero, solid once scrolled — collapses to a drawer on
 * mobile (native disclosure stays usable even before JavaScript loads).
 */
export function SiteHeader({
  clubName,
  contactNumber,
}: {
  clubName: string;
  contactNumber: string;
}) {
  const pathname = usePathname();
  const [scrolled, setScrolled] = React.useState(false);
  const menuRef = React.useRef<HTMLDetailsElement>(null);

  React.useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 16);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  React.useEffect(() => {
    if (menuRef.current) menuRef.current.open = false;
  }, [pathname]);

  return (
    <header
      className={cn(
        "sticky top-0 z-40 transition-colors duration-300",
        scrolled
          ? "border-b border-line bg-background/90 backdrop-blur-xl"
          : "border-b border-line/70 bg-background",
      )}
    >
      <div className="mx-auto flex h-16 w-full max-w-[1440px] items-center justify-between gap-4 px-5 sm:h-18 sm:px-8">
        <Link
          href="/"
          className="flex items-center gap-3 rounded-md focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-gold"
          aria-label={`${clubName} — home`}
        >
          <PubliqLogo decorative className="w-[96px] sm:w-[104px]" />
        </Link>

        <nav aria-label="Main navigation" className="hidden items-center gap-2 lg:flex">
          {NAV_LINKS.map((link) => {
            const active =
              link.href === "/" ? pathname === "/" : pathname.startsWith(link.href);
            return (
              <Link
                key={link.href}
                href={link.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "rounded-md px-3 py-2 text-[13.5px] font-medium transition-colors",
                  active ? "text-foreground" : "text-muted hover:text-foreground",
                )}
              >
                {link.label}
              </Link>
            );
          })}
        </nav>

        <div className="flex items-center gap-2">
          <a
            href={`tel:${contactNumber.replace(/[^\d+]/g, "")}`}
            className="hidden items-center gap-2 rounded-md px-3 py-2 text-[13px] text-muted transition-colors hover:text-foreground sm:flex"
          >
            <Phone aria-hidden className="size-3.5" />
            {contactNumber}
          </a>

          <Button asChild size="sm" className="hidden sm:inline-flex">
            <Link href="/reserve">
              <CalendarCheck className="size-3.5" />
              Reserve Now
            </Link>
          </Button>

          <details ref={menuRef} className="group lg:hidden">
            <summary aria-label="Open navigation menu" className="mobile-menu-trigger flex min-h-11 cursor-pointer list-none items-center gap-2 rounded-md border border-line px-3 text-sm font-medium text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold">
              <Menu aria-hidden className="size-5" /> <span>Menu</span>
            </summary>
            <div className="absolute left-0 right-0 top-full z-50 max-h-[calc(100dvh-4rem)] overflow-y-auto overscroll-contain border-b border-line bg-surface px-5 py-4 shadow-2xl">
              <nav aria-label="Mobile navigation">
                <ul className="space-y-1">
                  {NAV_LINKS.map((link) => {
                    const active = link.href === "/" ? pathname === "/" : pathname.startsWith(link.href);
                    return <li key={link.href}><a href={link.href} onClick={() => { if (menuRef.current) menuRef.current.open = false; }} aria-current={active ? "page" : undefined} className={cn("block rounded-md px-3 py-3 text-base font-medium focus-visible:outline-2 focus-visible:outline-gold", active ? "bg-gold/10 text-gold" : "text-muted hover:bg-card hover:text-foreground")}>{link.label}</a></li>;
                  })}
                </ul>
              </nav>
              <a href="/reserve" onClick={() => { if (menuRef.current) menuRef.current.open = false; }} className="mt-4 flex min-h-12 items-center justify-center gap-2 rounded-md bg-gold px-4 font-semibold text-background"><CalendarCheck aria-hidden className="size-4" /> Reservations</a>
              <a href={`tel:${contactNumber.replace(/[^\d+]/g, "")}`} className="mt-2 flex min-h-11 items-center justify-center gap-2 rounded-md border border-line px-4 text-sm text-muted"><Phone aria-hidden className="size-4" /> {contactNumber}</a>
            </div>
          </details>
        </div>
      </div>
    </header>
  );
}
