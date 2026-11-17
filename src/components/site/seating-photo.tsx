/** Native disclosure: the photo can open even if JavaScript fails or is slow. */
export function SeatingPhoto({ image, name, seat, bookingEnabled = false }: { image: number; name: string; seat?: string; bookingEnabled?: boolean }) {
  const src = `/images/publiq-venue/venue-${image}.jpeg`;
  return (
    <details className="group/photo">
      <summary className="photo-trigger relative block w-full cursor-pointer list-none text-left focus-visible:outline-2 focus-visible:outline-offset-[-4px] focus-visible:outline-gold group-open/photo:fixed group-open/photo:right-4 group-open/photo:top-4 group-open/photo:z-[70] group-open/photo:w-auto group-open/photo:rounded-md group-open/photo:bg-black group-open/photo:px-4 group-open/photo:py-3 group-open/photo:text-white">
        <span className="block group-open/photo:hidden">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={src} alt={name} className="aspect-[4/3] w-full object-cover" loading="lazy" />
          <span className="absolute bottom-3 right-3 flex min-h-11 items-center rounded-md bg-black/80 px-4 text-sm font-semibold text-white">View photo</span>
        </span>
        <span className="hidden group-open/photo:block">Close photo <span aria-hidden="true">×</span></span>
      </summary>
      <div className="fixed inset-0 z-[60] overflow-y-auto bg-black/95 px-4 pb-6 pt-20 text-white" aria-label={`${name} enlarged photo`}>
        <div className="mx-auto flex min-h-[calc(100dvh-7rem)] max-w-3xl flex-col justify-center">
          <h3 className="font-display text-2xl">{name}</h3>
          <p className="mt-1 text-sm text-white/70">{seat ? "View this seating option." : "Venue photo; individual couch assignment is not yet confirmed."}</p>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={src} alt={name} className="mt-4 max-h-[55dvh] w-full rounded-md bg-black object-contain" />
          {seat ? <div className="mt-5"><a href={`/reserve?seat=${encodeURIComponent(seat)}`} className="inline-flex min-h-12 w-full items-center justify-center rounded-md bg-gold px-5 text-sm font-semibold text-background focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold">Continue to booking</a><p className="mt-2 text-xs text-white/70">{bookingEnabled ? "Google sign-in is required to book." : "Online booking is not available yet."}</p></div> : null}
        </div>
      </div>
    </details>
  );
}
