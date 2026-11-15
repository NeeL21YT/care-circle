import { cn } from "@/lib/utils";

/** Decorative: the patient's name is always rendered next to it, so alt is empty. */
export function Avatar({ name, src, size = "md" }: { name: string; src?: string | null; size?: "md" | "lg" }) {
  const dim = size === "lg" ? "size-20 text-3xl" : "size-14 text-xl";
  const initials = name.split(/\s+/).slice(0, 2).map((p) => p[0]?.toUpperCase()).join("");
  return src ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt="" className={cn("shrink-0 rounded-full border-2 border-border object-cover", dim)} />
  ) : (
    <span aria-hidden="true" className={cn("flex shrink-0 items-center justify-center rounded-full bg-secondary font-bold text-secondary-foreground", dim)}>{initials}</span>
  );
}
