import Link from "next/link";
import { ArrowRight, Armchair, Clock3, UsersRound } from "lucide-react";

const details = [
  { title: "VIP booth seating", description: "Seven individual VIP booths for your group to settle into.", icon: Armchair },
  { title: "Space for your circle", description: "Explore five additional couch spaces, each with no minimum spend.", icon: UsersRound },
  { title: "Your night, your pace", description: "Join us from 9 PM and stay until closing at 4 AM.", icon: Clock3 },
];

export default function HomePage() {
  return (
    <>
      <section className="relative isolate flex min-h-[660px] items-center overflow-hidden bg-black sm:min-h-[700px] lg:min-h-[740px]">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/images/publiq-venue/venue-9.jpeg" alt="" aria-hidden="true" className="absolute inset-0 -z-20 size-full object-cover object-center lg:object-right" />
        <div aria-hidden="true" className="absolute inset-0 -z-10 bg-gradient-to-r from-black via-black/90 to-black/35" />
        <div aria-hidden="true" className="absolute inset-0 -z-10 bg-gradient-to-t from-black/85 via-transparent to-black/30" />
        <div className="mx-auto w-full max-w-7xl px-5 py-20 sm:px-8 lg:py-28">
          <div className="max-w-2xl">
            <p className="text-[11px] font-semibold uppercase tracking-[.2em] text-gold sm:text-xs">Your nightlife destination in Antipolo</p>
            <h1 className="mt-5 text-[clamp(4.5rem,14vw,9.5rem)] font-bold uppercase leading-[.85] tracking-[-.065em] text-white">PUBLIQ</h1>
            <p className="mt-4 text-[clamp(1.1rem,3.3vw,2.3rem)] font-medium uppercase tracking-[.3em] text-gold">Nightclub</p>
            <div aria-hidden="true" className="mt-8 h-px w-16 bg-gold" />
            <p className="mt-7 max-w-md text-base leading-7 text-white/85">Good company, a space of your own, and the whole night ahead. Make your next night one to remember.</p>
            <div className="mt-8 flex flex-wrap gap-3"><Link href="/reserve" className="inline-flex min-h-12 items-center justify-center gap-8 border border-gold px-5 text-xs font-semibold uppercase tracking-[.1em] text-gold transition-colors hover:bg-gold hover:text-background">Plan your reservation <ArrowRight aria-hidden="true" className="size-4" /></Link><Link href="/spaces" className="inline-flex min-h-12 items-center justify-center px-4 text-xs font-semibold uppercase tracking-[.1em] text-white/90 hover:text-gold">Explore seating</Link></div>
          </div>
        </div>
      </section>

      <section className="border-t border-line bg-background px-5 py-16 sm:px-8 sm:py-24">
        <div className="mx-auto max-w-7xl">
          <div className="mx-auto max-w-2xl text-center"><p className="flex items-center justify-center gap-4 text-[11px] font-semibold uppercase tracking-[.18em] text-gold"><span aria-hidden="true" className="h-px w-8 bg-gold/60" />The PUBLIQ experience<span aria-hidden="true" className="h-px w-8 bg-gold/60" /></p><h2 className="mt-5 text-3xl font-semibold uppercase tracking-[.05em] text-foreground sm:text-4xl">A night worth staying for.</h2><p className="mx-auto mt-4 max-w-lg text-sm leading-7 text-muted sm:text-base">Find your place, bring your people, and enjoy the night at PUBLIQ.</p></div>
          <div className="mt-10 grid gap-0 sm:mt-14 md:grid-cols-3">{details.map(({title,description,icon:Icon})=><div key={title} className="border-b border-line px-4 py-7 text-center last:border-b-0 md:border-b-0 md:border-r md:px-8 md:py-2 md:last:border-r-0"><Icon aria-hidden="true" strokeWidth={1.4} className="mx-auto size-9 text-gold" /><h3 className="mt-5 text-sm font-semibold uppercase tracking-[.08em]">{title}</h3><p className="mx-auto mt-3 max-w-xs text-sm leading-6 text-muted">{description}</p></div>)}</div>
          <div className="relative mt-12 grid min-h-[300px] overflow-hidden border border-gold/25 bg-card md:mt-16 md:grid-cols-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/images/publiq-venue/venue-7.jpeg" alt="" aria-hidden="true" loading="lazy" className="absolute inset-0 size-full object-cover object-center md:left-1/2 md:w-1/2" />
            <div aria-hidden="true" className="absolute inset-0 bg-gradient-to-r from-black via-black/90 to-black/45 md:via-black/90 md:to-black/15" />
            <div className="relative flex flex-col items-start justify-center px-6 py-12 sm:px-10"><p className="text-[11px] font-semibold uppercase tracking-[.17em] text-gold">Find your place</p><h2 className="mt-4 max-w-md text-2xl font-semibold uppercase tracking-[.04em] text-white sm:text-3xl">The night starts here.</h2><p className="mt-4 max-w-sm text-sm leading-7 text-white/80">Discover our VIP booths and couch spaces, and find the right setting for your group.</p><Link href="/spaces" className="mt-5 inline-flex min-h-11 items-center gap-4 text-xs font-semibold uppercase tracking-[.12em] text-gold hover:text-gold-soft">Explore seating <ArrowRight aria-hidden="true" className="size-4" /></Link></div>
          </div>
          <p className="mt-6 text-center text-xs leading-6 text-muted">No deposit required. VIP consumable minimums depend on your group size.</p>
        </div>
      </section>
    </>
  );
}
