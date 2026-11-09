"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { recordLessonOpen } from "@/app/academy/actions";

/**
 * Records that the lesson was opened (academy_open_lesson) once it is on
 * screen, not during render, so prefetching a lesson never counts as a
 * visit. Refreshes when that changed what the page shows: the first visit
 * (progress row, "continue" target) or a lesson that is now done.
 */
export function LessonOpenTracker({
  lessonId,
  courseId,
  started,
  completed,
  enabled,
}: {
  lessonId: string;
  courseId: string;
  started: boolean;
  completed: boolean;
  enabled: boolean;
}) {
  const router = useRouter();
  const sent = useRef<string | null>(null);

  useEffect(() => {
    if (!enabled || sent.current === lessonId) return;
    sent.current = lessonId;
    void recordLessonOpen(lessonId, courseId).then((result) => {
      if (!started || (result.completed && !completed)) router.refresh();
    });
  }, [lessonId, courseId, started, completed, enabled, router]);

  return null;
}
