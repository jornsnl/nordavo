import { CalendarPlus, ClipboardList, Code, Eye, Lightbulb, Mail, Palette, PenLine, Phone, Search, Users, Video, type LucideIcon } from "lucide-react";
import type { WorkTaskType } from "@/lib/work/database";

/** The icon of each task type (the same as on the task board of Athmium). */
export const taskTypeIcons: Record<WorkTaskType, LucideIcon> = {
  call: Phone,
  schedule: CalendarPlus,
  meeting: Users,
  teams: Video,
  brainstorm: Lightbulb,
  programming: Code,
  design: Palette,
  writing: PenLine,
  email: Mail,
  research: Search,
  review: Eye,
  admin: ClipboardList,
};

export function TaskTypeIcon({ type, className = "size-3.5" }: { type: WorkTaskType; className?: string }) {
  const Icon = taskTypeIcons[type];
  return <Icon className={className} aria-hidden="true" />;
}
