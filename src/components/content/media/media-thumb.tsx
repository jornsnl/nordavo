import { FileText, Film, File as FileIcon } from "lucide-react";
import type { MediaKind } from "@/lib/content/media-utils";

/** A square thumbnail: the image itself, or an icon for PDFs, videos and other files. */
export function MediaThumb({
  url,
  kind,
  name,
  className = "",
}: {
  url: string | null;
  kind: MediaKind;
  name: string;
  className?: string;
}) {
  if (kind === "image" && url) {
    // Signed URLs change every hour, so next/image caching gains nothing here.
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={url} alt={name} loading="lazy" className={`aspect-square w-full rounded-xl bg-surface object-cover ${className}`} />;
  }
  const Icon = kind === "pdf" ? FileText : kind === "video" ? Film : FileIcon;
  return (
    <div className={`flex aspect-square w-full flex-col items-center justify-center gap-1.5 rounded-xl bg-brand-50 p-2 text-brand-600 ${className}`}>
      <Icon className="size-7" aria-hidden="true" />
      <span className="line-clamp-2 text-center text-[11px] break-all text-muted">{name}</span>
    </div>
  );
}
