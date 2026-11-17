import type { Metadata } from "next";
import Link from "next/link";
import { customerGoogleConfig } from "@/lib/customer-auth/config";
import { SeatingPhoto } from "@/components/site/seating-photo";

export const metadata: Metadata = { title: "Seating", description: "Explore every VIP booth and couch at PUBLIQ." };

const vipBooths = [
  { name: "VIP 1", image: 7 },
  { name: "VIP 2", image: 8 },
  { name: "VIP 3", image: 9, note: "Can be combined with VIP 4." },
  { name: "VIP 4", image: 9, note: "Can be combined with VIP 3." },
  { name: "VIP 5", image: 1, note: "8–10 guests" },
  { name: "VIP 6", image: 2, note: "8–10 guests" },
  { name: "VIP 7", image: 3 },
];
const couches = [2, 3, 4, 5, 6];
const tiers = [["1–5 guests", "No minimum"], ["6–8 guests", "₱7,000"], ["9 guests", "₱8,500"], ["10–12 guests", "₱10,000"]];

export const dynamic = "force-dynamic";
export default function SeatingPage() {
  const bookingEnabled = process.env.CUSTOMER_BOOKINGS_ENABLED === "true" && Boolean(customerGoogleConfig());
  return (
    <div className="mx-auto max-w-7xl px-5 py-14 sm:px-8 sm:py-20">
      <header className="max-w-3xl">
        <p className="text-[11px] font-semibold uppercase tracking-[.22em] text-gold">Seating at PUBLIQ</p>
        <h1 className="mt-3 font-display text-5xl leading-[1.05] tracking-tight sm:text-6xl">Find your place for the night.</h1>
        <p className="mt-4 max-w-2xl text-base leading-relaxed text-muted">Explore seven VIP booths and five couch spaces. {bookingEnabled ? "Sign in with Google to reserve an available VIP booth." : "Reservations are being updated and aren’t available online yet."}</p>
        <nav aria-label="Seating categories" className="mt-6 flex flex-wrap gap-3">
          <a href="#vip" className="inline-flex min-h-11 items-center rounded-md border border-gold/40 px-4 text-sm font-semibold text-gold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold">VIP booths</a>
          <a href="#couches" className="inline-flex min-h-11 items-center rounded-md border border-line px-4 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold">Couches</a>
        </nav>
      </header>

      <section id="vip" className="scroll-mt-24 mt-16" aria-labelledby="vip-heading">
        <div className="flex flex-wrap items-end justify-between gap-4 border-b border-line pb-5">
          <div><h2 id="vip-heading" className="font-display text-3xl sm:text-4xl">VIP booths</h2><p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted">Seven individual spaces. VIP 3 and VIP 4 can also be arranged together as one larger space.</p></div>
          <div className="flex flex-wrap items-center gap-4"><span className="text-sm text-faint">7 booths</span><Link href="/reserve?seat=VIP%203%20%2B%204" className="inline-flex min-h-11 items-center text-sm font-semibold text-gold">VIP 3 + 4 booking details</Link></div>
        </div>
        <div className="mt-6 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {vipBooths.map((booth) => (
            <article key={booth.name} className="overflow-hidden rounded-lg border border-line bg-surface">
              <SeatingPhoto image={booth.image} name={booth.name === "VIP 3" || booth.name === "VIP 4" ? `${booth.name} (VIP 3 and 4 seating)` : booth.name} seat={booth.name} bookingEnabled={bookingEnabled} />
              <div className="p-5"><h3 className="font-display text-2xl">{booth.name}</h3><p className="mt-2 min-h-5 text-sm text-muted">{booth.note ?? "VIP booth"}</p></div>
            </article>
          ))}
        </div>
        <div className="mt-8 grid gap-6 rounded-lg border border-line bg-surface p-6 md:grid-cols-2 sm:p-8">
          <div><h3 className="font-display text-2xl">VIP consumable minimum</h3><p className="mt-3 max-w-md text-sm leading-relaxed text-muted">The minimum depends on your group size. It is consumable spend, not an hourly charge or deposit. No deposit is required.</p></div>
          <dl className="divide-y divide-line text-sm">{tiers.map(([label, amount]) => <div key={label} className="flex justify-between gap-4 py-3 first:pt-0"><dt>{label}</dt><dd className="font-semibold text-gold">{amount}</dd></div>)}</dl>
        </div>
      </section>

      <section id="couches" className="scroll-mt-24 mt-16" aria-labelledby="couch-heading">
        <div className="flex flex-wrap items-end justify-between gap-4 border-b border-line pb-5"><div><h2 id="couch-heading" className="font-display text-3xl sm:text-4xl">Couches</h2><p className="mt-2 max-w-2xl text-sm leading-relaxed text-muted">Five individual spaces, with no price or minimum spend. Couches 4 and 6 share one style; 2, 3 and 5 share another.</p></div><span className="text-sm text-faint">5 couches</span></div>
        <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">{couches.map((number) => <article key={number} className="rounded-lg border border-line bg-card p-5"><h3 className="font-display text-xl">Couch {number}</h3><p className="mt-2 text-sm text-muted">No minimum spend</p><Link href={`/reserve?seat=${encodeURIComponent(`Couch ${number}`)}`} className="mt-3 inline-flex min-h-11 items-center text-sm font-semibold text-gold">Booking details</Link></article>)}</div>
        <h3 className="mt-8 text-lg font-semibold">Couch seating photos</h3><p className="mt-1 text-sm text-muted">Venue photos; individual couch photo assignments are not yet confirmed.</p>
        <div className="mt-4 grid gap-4 sm:grid-cols-3">{[4, 5, 6].map((image) => <div key={image} className="overflow-hidden rounded-lg"><SeatingPhoto image={image} name={`Couch seating photo ${image}`} /></div>)}</div>
      </section>
      <div className="mt-14 rounded-lg border border-gold/30 bg-gold/5 p-6"><h2 className="text-lg font-semibold">{bookingEnabled ? "Plan your visit" : "Online reservations are being updated"}</h2><p className="mt-2 text-sm leading-relaxed text-muted">{bookingEnabled ? "VIP booths can be reserved after Google sign-in. Couch and combined VIP capacities are awaiting confirmation." : "Booking is not yet available online. Please contact the club for assistance."}</p><Link href="/contact" className="mt-4 inline-flex min-h-11 items-center rounded-md border border-line px-4 text-sm font-semibold">Contact PUBLIQ</Link></div>
    </div>
  );
}
