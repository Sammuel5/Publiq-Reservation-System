import * as React from "react";
import { formatClubTime12h, minutesToHHMM } from "@/lib/utils/datetime";
import { cn } from "@/lib/utils/cn";

/** Display a consistent 12-hour clock while keeping HH:mm values for the API. */
export function TimeSelect({ value, onChange, id, disabled, required, className, ...props }: React.SelectHTMLAttributes<HTMLSelectElement> & { value: string; id: string }) {
  const times = Array.from({length: 96}, (_, index) => minutesToHHMM(index * 15));
  // Preserve older values outside the 15-minute grid instead of silently changing them.
  if (/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value) && !times.includes(value)) times.push(value);
  times.sort();
  return <select {...props} id={id} value={value} onChange={onChange} disabled={disabled} required={required} className={cn("min-h-11 w-full rounded-md border border-line bg-surface px-3 text-base text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold disabled:opacity-60", className)}>
    <option value="">Choose a time</option>
    {times.map(time => <option key={time} value={time}>{formatClubTime12h(time)}</option>)}
  </select>;
}
