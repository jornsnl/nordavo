import { test } from "node:test";
import assert from "node:assert/strict";
import {
  allTimeZones,
  cityLabel,
  groupedTimeZones,
  isListedTimeZone,
  normalizeTimeZone,
  popularTimeZones,
  utcOffsetLabel,
} from "@/lib/work/time-zones";

test("the picker offers the full IANA list, not eight zones", () => {
  const zones = allTimeZones();
  assert.ok(zones.length > 300, `only ${zones.length} zones`);
  for (const zone of [...popularTimeZones, "America/Argentina/Salta", "Pacific/Chatham", "Asia/Kathmandu"]) {
    assert.ok(zones.includes(zone), zone);
  }
  // Current names, not the old ones ICU reports first.
  assert.ok(!zones.includes("Asia/Calcutta"));
  assert.deepEqual([...zones].sort((a, b) => a.localeCompare(b)), zones);
  assert.equal(new Set(zones).size, zones.length);
});

test("the server accepts exactly the listed zones", () => {
  assert.ok(isListedTimeZone("Europe/Amsterdam"));
  assert.ok(isListedTimeZone("Asia/Kolkata"));
  assert.ok(isListedTimeZone("UTC"));
  assert.ok(isListedTimeZone("America/Argentina/Salta"));
  // Another name of a listed zone is fine (values stored before) and is stored as the listed name.
  assert.ok(isListedTimeZone("Asia/Calcutta"));
  assert.equal(normalizeTimeZone("Asia/Calcutta"), "Asia/Kolkata");
  assert.ok(isListedTimeZone("America/Argentina/Buenos_Aires"));
  assert.ok(allTimeZones().includes(normalizeTimeZone("America/Argentina/Buenos_Aires")));
  assert.equal(normalizeTimeZone("europe/amsterdam"), "Europe/Amsterdam");
  assert.equal(normalizeTimeZone("Europe/Amsterdam"), "Europe/Amsterdam");
  assert.equal(normalizeTimeZone("Mars/Olympus"), "Mars/Olympus");

  for (const bad of ["Mars/Olympus", "", "Not a zone", "Europe/Amsterdam ", "x".repeat(65), null, 42, undefined]) {
    assert.ok(!isListedTimeZone(bad), String(bad));
  }
});

test("every listed zone works with Intl, so deadlines can be shown in it", () => {
  for (const zone of allTimeZones()) {
    assert.doesNotThrow(() => new Intl.DateTimeFormat("en-GB", { timeZone: zone }).format(new Date()), zone);
  }
});

test("labels and groups for the picker", () => {
  assert.equal(cityLabel("America/Argentina/Buenos_Aires"), "Argentina / Buenos Aires");
  assert.equal(cityLabel("Asia/Kolkata"), "Kolkata");
  assert.equal(utcOffsetLabel("Asia/Kolkata", new Date("2026-11-08T12:00:00Z")), "UTC+05:30");
  assert.equal(utcOffsetLabel("Europe/Amsterdam", new Date("2026-07-01T12:00:00Z")), "UTC+02:00");
  assert.equal(utcOffsetLabel("UTC"), "UTC+00:00");

  const groups = groupedTimeZones(new Date("2026-11-08T12:00:00Z"));
  assert.equal(groups[0].region, "Popular");
  assert.deepEqual(groups[0].zones.map((z) => z.value), popularTimeZones);
  const regions = groups.map((g) => g.region);
  for (const region of ["Africa", "America", "Asia", "Europe", "Pacific"]) assert.ok(regions.includes(region), region);
  const kolkata = groups.find((g) => g.region === "Asia")!.zones.find((z) => z.value === "Asia/Kolkata")!;
  assert.ok(kolkata.search.includes("+05:30") && kolkata.search.includes("kolkata"));
  // Every listed zone is in exactly one region group.
  const grouped = groups.slice(1).flatMap((g) => g.zones.map((z) => z.value));
  assert.deepEqual([...grouped].sort((a, b) => a.localeCompare(b)), allTimeZones());
});
