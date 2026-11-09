import { PageSkeleton } from "@/components/ui/skeleton";

/** Shown at once on navigation, inside the section's shell, until the page streams in. */
export default function Loading() {
  return <PageSkeleton />;
}
