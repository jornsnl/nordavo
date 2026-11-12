"use client";

import { PlugZap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { testDriveConnectionAction } from "@/app/content/actions/media";
import { useContentButton } from "./use-content-action";

/** Test connection: a token for the service account and one small Drive request; the result is a toast. */
export function DriveConnectionTest() {
  const button = useContentButton();
  return (
    <Button size="sm" variant="secondary" disabled={button.pending} onClick={() => button.run(() => testDriveConnectionAction())}>
      <PlugZap className={button.pending ? "animate-pulse" : ""} aria-hidden="true" />
      {button.pending ? "Testing" : "Test connection"}
    </Button>
  );
}
