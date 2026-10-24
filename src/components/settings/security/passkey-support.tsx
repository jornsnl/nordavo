"use client";

import { useSyncExternalStore } from "react";
import { browserSupportsWebAuthn } from "@simplewebauthn/browser";

const noSubscribe = () => () => {};

/** Whether this browser can use passkeys. Assumes yes during server rendering. */
export function useWebAuthnSupport() {
  return useSyncExternalStore(noSubscribe, browserSupportsWebAuthn, () => true);
}
