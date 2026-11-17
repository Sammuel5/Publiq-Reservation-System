import Link from "next/link";
import { ArrowRight, Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { formatMoney } from "@/lib/utils/money";
import type { RoomView } from "@/lib/services/availability";

const CATEGORY_LABELS: Record<string, string> = {
  standard: "Standard",
  vip: "VIP",
  "premium-vip": "Premium VIP",
  "private-area": "Private Area",
};

export function categoryLabel(slug: string): string {
  return CATEGORY_LABELS[slug] ?? slug.replace(/-/g, " ");
}

/**
 * Room card used on the homepage, the rooms index and "similar rooms".
 * Fixed aspect ratio + clamped text keeps every card the same height.
 */
export function RoomCard({ room }: { room: RoomView }) {
  const image = room.coverImage ?? room.images[0] ?? "/images/room-standard.jpg";
  const isPremium = room.categorySlug !== "standard";

  return (
    <article className="group flex h-full flex-col overflow-hidden rounded-lg border border-line bg-card transition-colors duration-300 hover:border-line-strong">
      <Link
        href={`/rooms/${room.slug}`}
        className="relative block aspect-[4/3] overflow-hidden"
        tabIndex={-1}
        aria-hidden="true"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={image}
          alt=""
          loading="lazy"
          decoding="async"
          className="size-full object-cover transition-transform duration-500 ease-[var(--ease-lux)] group-hover:scale-[1.03]"
        />
        <div
          aria-hidden
          className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/10 to-transparent"
        />
        <div className="absolute left-3 top-3">
          <Badge variant={isPremium ? "gold" : "neutral"}>{categoryLabel(room.categorySlug)}</Badge>
        </div>
      </Link>

      <div className="flex flex-1 flex-col p-4 sm:p-5">
        <h3 className="text-[15px] font-semibold tracking-tight">
          <Link
            href={`/rooms/${room.slug}`}
            className="inline-flex min-h-8 items-center transition-colors hover:text-gold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold"
          >
            {room.name}
          </Link>
        </h3>

        <p className="mt-1.5 line-clamp-2 text-[13px] leading-relaxed text-muted">
          {room.shortDescription ?? room.description ?? "A private room for your group."}
        </p>

        <dl className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[12.5px] text-muted">
          <div className="flex items-center gap-1.5">
            <Users aria-hidden className="size-3.5 text-gold/70" />
            <dt className="sr-only">Capacity</dt>
            <dd>Up to {room.capacity} guests</dd>
          </div>
          <div className="flex items-center gap-1.5">
            <dt className="sr-only">Minimum booking</dt>
            <dd>{room.minimumDuration} min minimum</dd>
          </div>
        </dl>

        <div className="mt-auto flex items-end justify-between gap-3 pt-5">
          <p className="text-[13px] text-muted">
            <span className="block text-lg font-semibold text-foreground">
              {formatMoney(room.hourlyRate)}
            </span>
            <span className="text-[11.5px] text-faint">per hour · pay at the club</span>
          </p>

          <div className="flex flex-col items-end gap-1.5">
            <Link
              href={`/reserve?room=${room.slug}`}
              className="inline-flex items-center gap-1.5 rounded-md bg-gold px-3 py-2 text-[12.5px] font-semibold text-[#1a1408] transition-colors hover:bg-gold-soft"
            >
              Reserve
              <ArrowRight aria-hidden className="size-3.5" />
            </Link>
            <Link
              href={`/rooms/${room.slug}`}
              className="inline-flex min-h-8 items-center text-[11.5px] text-faint underline-offset-4 transition-colors hover:text-muted hover:underline"
            >
              View details
            </Link>
          </div>
        </div>
      </div>
    </article>
  );
}
