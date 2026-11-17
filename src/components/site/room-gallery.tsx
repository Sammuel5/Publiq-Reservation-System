"use client";

import * as React from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils/cn";

/**
 * Room image gallery: large frame + thumbnails on desktop, swipeable strip with
 * arrows on mobile. Keyboard accessible (arrow keys) and never wider than the
 * viewport.
 */
export function RoomGallery({
  images,
  alt,
  fallback = "/images/room-standard.jpg",
}: {
  images: string[];
  alt: string;
  fallback?: string;
}) {
  const gallery = images.length > 0 ? images : [fallback];
  const [index, setIndex] = React.useState(0);
  const current = gallery[Math.min(index, gallery.length - 1)] ?? fallback;

  const go = React.useCallback(
    (delta: number) => {
      setIndex((value) => (value + delta + gallery.length) % gallery.length);
    },
    [gallery.length],
  );

  return (
    <div className="space-y-3">
      <div
        className="group relative aspect-[16/10] w-full overflow-hidden rounded-lg border border-line bg-card"
        onKeyDown={(event) => {
          if (event.key === "ArrowRight") go(1);
          if (event.key === "ArrowLeft") go(-1);
        }}
        tabIndex={0}
        role="group"
        aria-roledescription="carousel"
        aria-label={`${alt} photo gallery`}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          key={current}
          src={current}
          alt={`${alt} — photo ${index + 1} of ${gallery.length}`}
          className="size-full animate-[lux-overlay-in_300ms_ease-out] object-cover"
        />

        {gallery.length > 1 ? (
          <>
            <button
              type="button"
              onClick={() => go(-1)}
              aria-label="Previous photo"
              className="absolute left-3 top-1/2 grid size-10 -translate-y-1/2 place-items-center rounded-full border border-white/15 bg-black/50 text-white backdrop-blur transition-opacity hover:bg-black/70 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold"
            >
              <ChevronLeft className="size-5" />
            </button>
            <button
              type="button"
              onClick={() => go(1)}
              aria-label="Next photo"
              className="absolute right-3 top-1/2 grid size-10 -translate-y-1/2 place-items-center rounded-full border border-white/15 bg-black/50 text-white backdrop-blur transition-opacity hover:bg-black/70 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold"
            >
              <ChevronRight className="size-5" />
            </button>
            <span className="absolute bottom-3 right-3 rounded-full bg-black/60 px-2.5 py-1 text-[11px] text-white/90 backdrop-blur">
              {index + 1} / {gallery.length}
            </span>
          </>
        ) : null}
      </div>

      {gallery.length > 1 ? (
        <ul className="grid grid-cols-4 gap-2 sm:grid-cols-5">
          {gallery.map((image, thumbIndex) => (
            <li key={image}>
              <button
                type="button"
                onClick={() => setIndex(thumbIndex)}
                aria-label={`Show photo ${thumbIndex + 1}`}
                aria-current={thumbIndex === index}
                className={cn(
                  "relative block aspect-[4/3] w-full overflow-hidden rounded-md border transition-colors",
                  thumbIndex === index
                    ? "border-gold"
                    : "border-line hover:border-line-strong",
                )}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={image}
                  alt=""
                  loading="lazy"
                  className="size-full object-cover"
                />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
