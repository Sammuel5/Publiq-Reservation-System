"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowDown,
  ArrowUp,
  GripVertical,
  Pencil,
  Plus,
  Save,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ActionError, PromptActionButton } from "@/components/admin/action-controls";
import { adminFetch, type FieldErrors } from "@/components/admin/api-client";
import { Money } from "@/components/admin/money";
import { centavosToPesosInput } from "@/lib/utils/money";

/**
 * Room and category management.
 *
 * Ordering is offered three ways on purpose: drag with a pointer, Move up/Move
 * down buttons, and a numeric `sortOrder` in the edit form. A list you can only
 * reorder by dragging is unusable on a phone at the door and hostile to a
 * keyboard, and both of those are how this screen actually gets used.
 *
 * The whole ordered id list is sent after every change rather than a delta, so
 * two people reordering at once converge on the last write instead of producing
 * a scrambled mix.
 */

type Room = {
  id: string;
  name: string;
  slug: string;
  categorySlug: string;
  categoryName: string;
  shortDescription: string | null;
  description: string | null;
  capacity: number;
  hourlyRate: number;
  minimumDuration: number;
  slotMinutes: number;
  amenities: string[];
  images: string[];
  coverImage: string | null;
  isActive: boolean;
  isAvailable: boolean;
  maintenanceStatus: string;
  maintenanceNote: string | null;
  sortOrder: number;
  stats: { bookings: number; todayBookings: number; upcomingBookings: number; revenue: number; openBlocks: number };
};

type Category = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  accent: string;
  sortOrder: number;
  isActive: boolean;
  roomCount: number;
};

export function RoomsAdmin({
  rooms,
  categories,
  currency,
  canManage,
}: {
  rooms: Room[];
  categories: Category[];
  currency: string;
  canManage: boolean;
}) {
  const router = useRouter();
  const [order, setOrder] = React.useState<string[]>(() => rooms.map((room) => room.id));
  const [savingOrder, setSavingOrder] = React.useState(false);
  const [dragging, setDragging] = React.useState<string | null>(null);

  // Re-sync when the server data changes (a save elsewhere on the page).
  React.useEffect(() => {
    setOrder(rooms.map((room) => room.id));
  }, [rooms]);

  const byId = new Map(rooms.map((room) => [room.id, room]));
  const ordered = order.map((id) => byId.get(id)).filter((room): room is Room => Boolean(room));

  const persistOrder = async (next: string[]) => {
    setOrder(next);
    setSavingOrder(true);
    const result = await adminFetch("/api/admin/rooms/order", { method: "PUT", body: { order: next } });
    setSavingOrder(false);
    if (!result.ok) {
      toast.error(result.message);
      return;
    }
    router.refresh();
  };

  const move = (id: string, direction: -1 | 1) => {
    const index = order.indexOf(id);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= order.length) return;
    const next = [...order];
    const [removed] = next.splice(index, 1);
    next.splice(target, 0, removed!);
    void persistOrder(next);
  };

  const onDrop = (targetId: string) => {
    if (!dragging || dragging === targetId) return;
    const next = order.filter((id) => id !== dragging);
    const at = next.indexOf(targetId);
    next.splice(at + 1, 0, dragging);
    setDragging(null);
    void persistOrder(next);
  };

  return (
    <div className="space-y-6">
      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-[13px] text-muted">
            {savingOrder ? "Saving order…" : "Drag a row, or use the arrows. Order here is the order guests see on the site."}
          </p>
          {canManage ? <RoomFormDialog categories={categories} currency={currency} /> : null}
        </div>

        <Card className="overflow-hidden">
          <div className="divide-y divide-line">
            {ordered.map((room, index) => (
              <div
                key={room.id}
                draggable={canManage}
                onDragStart={() => canManage && setDragging(room.id)}
                onDragEnd={() => setDragging(null)}
                onDragOver={(event) => canManage && event.preventDefault()}
                onDrop={() => canManage && onDrop(room.id)}
                data-room-row={room.slug}
                data-dragging={dragging === room.id ? "true" : undefined}
                className={`flex flex-wrap items-start gap-3 p-3.5 transition-colors sm:p-4 ${
                  dragging === room.id ? "bg-gold/[0.07]" : "hover:bg-card/40"
                }`}
              >
                {canManage ? (
                  <span
                    aria-hidden
                    className="mt-1 hidden cursor-grab text-faint active:cursor-grabbing sm:block"
                    title="Drag to reorder"
                  >
                    <GripVertical className="size-4" />
                  </span>
                ) : null}

                {room.coverImage ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={room.coverImage}
                    alt=""
                    className="size-14 shrink-0 rounded-md border border-line object-cover"
                  />
                ) : (
                  <span className="grid size-14 shrink-0 place-items-center rounded-md border border-line bg-surface text-[11px] text-faint">
                    no photo
                  </span>
                )}

                <div className="min-w-0 flex-1 space-y-1">
                  <p className="flex flex-wrap items-center gap-2 text-[14px] font-semibold tracking-tight">
                    {room.name}
                    <span className="font-mono text-[11px] font-normal text-faint">/{room.slug}</span>
                    {!room.isActive ? <Badge variant="outline">Hidden</Badge> : null}
                    {!room.isAvailable ? <Badge variant="warning">Not bookable</Badge> : null}
                    {room.maintenanceStatus !== "OPERATIONAL" ? (
                      <Badge variant="danger">
                        {room.maintenanceStatus === "IN_PROGRESS" ? "Maintenance" : "Scheduled"}
                      </Badge>
                    ) : null}
                  </p>
                  <p className="text-[12.5px] text-muted">
                    {room.categoryName} · seats {room.capacity} · <Money centavos={room.hourlyRate} currency={currency} />/h ·
                    min {room.minimumDuration} min
                  </p>
                  <p className="text-[12px] text-faint">
                    {room.stats.bookings} booking{room.stats.bookings === 1 ? "" : "s"} all time ·{" "}
                    {room.stats.todayBookings} tonight · {room.stats.upcomingBookings} upcoming ·{" "}
                    {room.stats.openBlocks > 0 ? `${room.stats.openBlocks} block window(s)` : "no blocks"} ·{" "}
                    <Money centavos={room.stats.revenue} currency={currency} /> earned
                  </p>
                  {room.shortDescription ? (
                    <p className="line-clamp-2 max-w-2xl text-[12.5px] leading-relaxed text-muted">
                      {room.shortDescription}
                    </p>
                  ) : null}
                </div>

                <div className="flex flex-wrap items-center gap-1.5">
                  {canManage ? (
                    <>
                      <Button
                        size="sm"
                        variant="ghost"
                        aria-label={`Move ${room.name} up`}
                        disabled={index === 0 || savingOrder}
                        onClick={() => move(room.id, -1)}
                      >
                        <ArrowUp aria-hidden />
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        aria-label={`Move ${room.name} down`}
                        disabled={index === ordered.length - 1 || savingOrder}
                        onClick={() => move(room.id, 1)}
                      >
                        <ArrowDown aria-hidden />
                      </Button>
                      <RoomFormDialog room={room} categories={categories} currency={currency} />
                      <PromptActionButton
                        href={`/api/admin/rooms/${room.id}`}
                        label={
                          <>
                            <Trash2 aria-hidden />
                            Delete
                          </>
                        }
                        title={`Delete ${room.name}?`}
                        description="A space can only be deleted while nothing has ever been booked in it. Otherwise switch it off instead — the history stays."
                        method="DELETE"
                        askForReason={false}
                        payload={(reason) => ({ reason })}
                        successMessage="Room deleted."
                        triggerVariant="ghost"
                        destructive
                      />
                    </>
                  ) : null}
                  <Button asChild size="sm" variant="outline">
                    <Link href={`/rooms/${room.slug}`} target="_blank" rel="noreferrer">
                      View
                    </Link>
                  </Button>
                </div>
              </div>
            ))}
            {ordered.length === 0 ? (
              <CardContent className="text-[13.5px] text-muted">
                No spaces yet. Add one and it appears on the site straight away.
              </CardContent>
            ) : null}
          </div>
        </Card>
      </section>

      <section className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="font-serif text-[19px] tracking-tight">Space categories</h3>
          {canManage ? <CategoryFormDialog /> : null}
        </div>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {categories.map((category) => (
            <Card key={category.id}>
              <CardContent className="space-y-1.5">
                <p className="flex flex-wrap items-center gap-2 text-[14px] font-semibold">
                  {category.name}
                  <Badge variant={category.accent === "purple" ? "purple" : category.accent === "neutral" ? "neutral" : "gold"}>
                    {category.roomCount} space{category.roomCount === 1 ? "" : "s"}
                  </Badge>
                  {!category.isActive ? <Badge variant="outline">Hidden</Badge> : null}
                </p>
                <p className="text-[12px] text-faint">/{category.slug} · order {category.sortOrder}</p>
                {category.description ? (
                  <p className="line-clamp-2 text-[12.5px] leading-relaxed text-muted">{category.description}</p>
                ) : null}
                {canManage ? (
                  <div className="flex flex-wrap items-center gap-1.5 pt-1">
                    <CategoryFormDialog category={category} />
                    <PromptActionButton
                      href={`/api/admin/categories/${category.id}`}
                      label="Delete"
                      title={`Delete ${category.name}?`}
                      description="Only an empty category can be deleted — spaces must be moved somewhere first."
                      method="DELETE"
                      askForReason={false}
                      successMessage="Category deleted."
                      triggerVariant="ghost"
                      destructive
                    />
                  </div>
                ) : null}
              </CardContent>
            </Card>
          ))}
        </div>
      </section>
    </div>
  );
}

// ------------------------------------------------------------------ room form --

const BLANK_ROOM = {
  name: "",
  slug: "",
  categorySlug: "standard",
  shortDescription: "",
  description: "",
  capacity: "6",
  hourlyRate: "1000.00",
  minimumDuration: "60",
  slotMinutes: "30",
  amenities: "",
  images: "",
  coverImage: "/images/room-standard.jpg",
  isActive: true,
  isAvailable: true,
  maintenanceStatus: "OPERATIONAL",
  maintenanceNote: "",
};

function RoomFormDialog({
  room,
  categories,
  currency,
}: {
  room?: Room;
  categories: Array<{ slug: string; name: string }>;
  currency: string;
}) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [fields, setFields] = React.useState<FieldErrors>({});
  const editing = Boolean(room);

  const [form, setForm] = React.useState(() => ({
    ...BLANK_ROOM,
    ...(room
      ? {
          name: room.name,
          slug: room.slug,
          categorySlug: room.categorySlug,
          shortDescription: room.shortDescription ?? "",
          description: room.description ?? "",
          capacity: String(room.capacity),
          hourlyRate: centavosToPesosInput(room.hourlyRate),
          minimumDuration: String(room.minimumDuration),
          slotMinutes: String(room.slotMinutes),
          amenities: room.amenities.join(", "),
          images: room.images.join("\n"),
          coverImage: room.coverImage ?? "",
          isActive: room.isActive,
          isAvailable: room.isAvailable,
          maintenanceStatus: room.maintenanceStatus,
          maintenanceNote: room.maintenanceNote ?? "",
        }
      : {}),
  }));

  const update = (key: keyof typeof form) => (
    event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>,
  ) => {
    const target = event.target as HTMLInputElement;
    setForm((prev) => ({
      ...prev,
      [key]: target.type === "checkbox" ? target.checked : target.value,
    }));
  };

  React.useEffect(() => {
    if (open) {
      setError(null);
      setFields({});
    }
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {editing ? (
          <Button size="sm" variant="secondary">
            <Pencil aria-hidden />
            Edit
          </Button>
        ) : (
          <Button size="sm">
            <Plus aria-hidden />
            New space
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{editing ? `Edit ${room?.name}` : "Add a room"}</DialogTitle>
          <DialogDescription>
            Price is what the website quotes and what bookings are charged at — {currency}, per hour.
            Changing it does not re-price bookings that already exist.
          </DialogDescription>
        </DialogHeader>

        <form
          className="grid gap-4 sm:grid-cols-2"
          onSubmit={async (event) => {
            event.preventDefault();
            setPending(true);
            setError(null);
            setFields({});
            const payload = {
              name: form.name,
              slug: form.slug || undefined,
              categorySlug: form.categorySlug,
              shortDescription: form.shortDescription || undefined,
              description: form.description || undefined,
              capacity: Number(form.capacity),
              hourlyRate: form.hourlyRate,
              minimumDuration: Number(form.minimumDuration),
              slotMinutes: Number(form.slotMinutes),
              amenities: form.amenities,
              images: form.images,
              coverImage: form.coverImage,
              isActive: form.isActive,
              isAvailable: form.isAvailable,
              maintenanceStatus: form.maintenanceStatus,
              maintenanceNote: form.maintenanceNote || undefined,
            };
            const result = editing
              ? await adminFetch(`/api/admin/rooms/${room!.id}`, { method: "PATCH", body: payload })
              : await adminFetch("/api/admin/rooms", { method: "POST", body: payload });
            setPending(false);
            if (!result.ok) {
              setError(result.message);
              setFields(result.fields);
              return;
            }
            toast.success(editing ? "Room updated." : "Room created.");
            setOpen(false);
            // The list is server-rendered, so it only changes if we ask for it:
            // without this the room exists but is invisible until a reload.
            router.refresh();
          }}
        >
          <FormField id="room-name" label="Name" error={fields.name} required>
            <Input id="room-name" value={form.name} maxLength={80} onChange={update("name")} />
          </FormField>

          <FormField id="room-slug" label="Web address" hint={editing ? undefined : "Generated from the name if blank"} error={fields.slug}>
            <Input id="room-slug" value={form.slug} maxLength={90} onChange={update("slug")} placeholder="velvet-suite" />
          </FormField>

          <FormField id="room-category" label="Category" error={fields.categorySlug} required>
            <select
              id="room-category"
              className="min-h-10 w-full rounded-md border border-line bg-surface px-3 text-[13.5px] text-foreground focus-visible:border-gold/60 focus-visible:outline-none"
              value={form.categorySlug}
              onChange={update("categorySlug")}
            >
              {categories.map((category) => (
                <option key={category.slug} value={category.slug}>
                  {category.name}
                </option>
              ))}
            </select>
          </FormField>

          <FormField id="room-capacity" label="Seats" error={fields.capacity} required>
            <Input id="room-capacity" type="number" min={1} max={100} value={form.capacity} onChange={update("capacity")} />
          </FormField>

          <FormField id="room-rate" label={`Hourly rate (${currency})`} error={fields.hourlyRate} required>
            <Input id="room-rate" inputMode="decimal" value={form.hourlyRate} onChange={update("hourlyRate")} />
          </FormField>

          <FormField id="room-min" label="Minimum booking (minutes)" error={fields.minimumDuration}>
            <Input
              id="room-min"
              type="number"
              min={30}
              max={720}
              step={30}
              value={form.minimumDuration}
              onChange={update("minimumDuration")}
            />
          </FormField>

          <FormField id="room-grid" label="Slot grid (minutes)" hint="Start times guests may pick" error={fields.slotMinutes}>
            <Input id="room-grid" type="number" min={15} max={120} step={15} value={form.slotMinutes} onChange={update("slotMinutes")} />
          </FormField>

          <FormField id="room-amenities" label="Amenities" hint="Comma separated" className="sm:col-span-2" error={fields.amenities}>
            <Input id="room-amenities" value={form.amenities} onChange={update("amenities")} placeholder="Karaoke booth, DJ deck, Private bar" />
          </FormField>

          <FormField
            id="room-short"
            label="One-line pitch"
            hint="Shown on the space cards"
            className="sm:col-span-2"
            error={fields.shortDescription}
          >
            <Input id="room-short" value={form.shortDescription} maxLength={240} onChange={update("shortDescription")} />
          </FormField>

          <FormField id="room-desc" label="Full description" className="sm:col-span-2" error={fields.description}>
            <Textarea id="room-desc" rows={3} maxLength={2000} value={form.description} onChange={update("description")} />
          </FormField>

          <FormField
            id="room-cover"
            label="Cover image"
            hint="/images/… or https://…"
            className="sm:col-span-2"
            error={fields.coverImage}
          >
            <Input id="room-cover" value={form.coverImage} maxLength={300} onChange={update("coverImage")} />
          </FormField>

          <FormField
            id="room-images"
            label="Gallery"
            hint="One path per line, max 10"
            className="sm:col-span-2"
            error={fields.images}
          >
            <Textarea id="room-images" rows={3} value={form.images} onChange={update("images")} placeholder="/images/space-vip.jpg" />
          </FormField>

          <FormField id="room-maintenance" label="Maintenance" error={fields.maintenanceStatus}>
            <select
              id="room-maintenance"
              className="min-h-10 w-full rounded-md border border-line bg-surface px-3 text-[13.5px] text-foreground focus-visible:border-gold/60 focus-visible:outline-none"
              value={form.maintenanceStatus}
              onChange={update("maintenanceStatus")}
            >
              <option value="OPERATIONAL">Operational</option>
              <option value="SCHEDULED">Scheduled</option>
              <option value="IN_PROGRESS">In progress</option>
            </select>
          </FormField>

          <FormField id="room-maintenance-note" label="Maintenance note" error={fields.maintenanceNote}>
            <Input id="room-maintenance-note" value={form.maintenanceNote} maxLength={500} onChange={update("maintenanceNote")} />
          </FormField>

          <div className="flex flex-wrap gap-4 sm:col-span-2">
            <label className="flex min-h-9 items-center gap-2.5 text-[13px] text-muted">
              <input type="checkbox" checked={form.isActive} onChange={update("isActive")} className="size-4 accent-[#c9a45c]" />
              Visible on the site
            </label>
            <label className="flex min-h-9 items-center gap-2.5 text-[13px] text-muted">
              <input type="checkbox" checked={form.isAvailable} onChange={update("isAvailable")} className="size-4 accent-[#c9a45c]" />
              Accepting bookings
            </label>
          </div>

          {error ? (
            <div className="sm:col-span-2">
              <ActionError message={error} />
            </div>
          ) : null}

          <DialogFooter className="sm:col-span-2">
            <Button type="button" variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? <Save aria-hidden className="animate-pulse" /> : <Save aria-hidden />}
              {editing ? "Save changes" : "Create room"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ----------------------------------------------------------- category dialog --

function CategoryFormDialog({ category }: { category?: Category }) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [fields, setFields] = React.useState<FieldErrors>({});
  const [form, setForm] = React.useState({
    name: category?.name ?? "",
    slug: category?.slug ?? "",
    description: category?.description ?? "",
    accent: category?.accent ?? "gold",
    sortOrder: String(category?.sortOrder ?? 0),
    isActive: category?.isActive ?? true,
  });

  const update = (key: keyof typeof form) => (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const target = event.target as HTMLInputElement;
    setForm((prev) => ({ ...prev, [key]: target.type === "checkbox" ? target.checked : target.value }));
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant={category ? "ghost" : "default"}>
          {category ? (
            <>
              <Pencil aria-hidden />
              Edit
            </>
          ) : (
            <>
              <Plus aria-hidden />
              New category
            </>
          )}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{category ? `Edit ${category.name}` : "New category"}</DialogTitle>
          <DialogDescription>
            Categories group spaces on the website and drive the badge colour. Renaming one moves its spaces
            to the new address automatically.
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={async (event) => {
            event.preventDefault();
            setPending(true);
            setError(null);
            setFields({});
            const payload = {
              name: form.name,
              slug: form.slug || undefined,
              description: form.description || undefined,
              accent: form.accent,
              sortOrder: Number(form.sortOrder),
              isActive: form.isActive,
            };
            const result = category
              ? await adminFetch(`/api/admin/categories/${category.id}`, { method: "PATCH", body: payload })
              : await adminFetch("/api/admin/categories", { method: "POST", body: payload });
            setPending(false);
            if (!result.ok) {
              setError(result.message);
              setFields(result.fields);
              return;
            }
            toast.success(category ? "Category updated." : "Category created.");
            setOpen(false);
            router.refresh();
          }}
        >
          <FormField id="cat-name" label="Name" error={fields.name} required>
            <Input id="cat-name" value={form.name} maxLength={60} onChange={update("name")} />
          </FormField>
          <FormField id="cat-slug" label="Web address" error={fields.slug}>
            <Input id="cat-slug" value={form.slug} maxLength={60} onChange={update("slug")} placeholder="vip" />
          </FormField>
          <FormField id="cat-desc" label="Description" error={fields.description}>
            <Textarea id="cat-desc" rows={2} maxLength={500} value={form.description} onChange={update("description")} />
          </FormField>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField id="cat-accent" label="Badge colour" error={fields.accent}>
              <select
                id="cat-accent"
                className="min-h-10 w-full rounded-md border border-line bg-surface px-3 text-[13.5px] text-foreground focus-visible:border-gold/60 focus-visible:outline-none"
                value={form.accent}
                onChange={update("accent")}
              >
                <option value="gold">Gold</option>
                <option value="purple">Purple</option>
                <option value="neutral">Neutral</option>
              </select>
            </FormField>
            <FormField id="cat-order" label="Order" error={fields.sortOrder}>
              <Input id="cat-order" type="number" min={0} max={9999} value={form.sortOrder} onChange={update("sortOrder")} />
            </FormField>
          </div>
          <label className="flex min-h-9 items-center gap-2.5 text-[13px] text-muted">
            <input type="checkbox" checked={form.isActive} onChange={update("isActive")} className="size-4 accent-[#c9a45c]" />
            Show this category on the site
          </label>

          {error ? <ActionError message={error} /> : null}

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)} disabled={pending}>
              Cancel
            </Button>
            <Button type="submit" disabled={pending}>
              {pending ? <Save aria-hidden className="animate-pulse" /> : <Save aria-hidden />}
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
