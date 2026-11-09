import type { Tone } from "@/lib/labels";
import type { EnrollmentStatus, SequenceChannel } from "@/lib/sales/database";
import { sequenceChannels } from "@/lib/sales/labels";

export function channelLabel(channel: SequenceChannel) {
  return sequenceChannels.find((c) => c.value === channel)?.label ?? channel;
}

export const enrollmentStatuses: { value: EnrollmentStatus; label: string; tone: Tone }[] = [
  { value: "active", label: "Active", tone: "success" },
  { value: "paused", label: "Paused", tone: "warning" },
  { value: "finished", label: "Finished", tone: "brand" },
  { value: "stopped", label: "Stopped", tone: "neutral" },
];
