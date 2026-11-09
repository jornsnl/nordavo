import { test } from "node:test";
import assert from "node:assert/strict";
import { isAcademyOnlyRole, landingPathFor, routeForRole } from "@/lib/academy/routing";
import { canSeePath, effectiveModules, moduleForPath } from "@/lib/modules";
import { modulesForTable } from "@/lib/mcp/module-scope";

test("developers and candidates only reach the Academy and signing in", () => {
  for (const role of ["developer", "candidate"]) {
    assert.ok(isAcademyOnlyRole(role));
    for (const path of ["/academy", "/academy/courses/x", "/academy/security", "/auth/signout", "/auth/password", "/login", "/login/verify"]) {
      assert.deepEqual(routeForRole(role, path), { kind: "allow" }, `${role} ${path}`);
    }
    for (const path of ["/dashboard", "/dashboard/academy", "/portal", "/work", "/caller", "/academyx"]) {
      assert.deepEqual(routeForRole(role, path), { kind: "redirect", to: "/academy" }, `${role} ${path}`);
    }
    assert.deepEqual(routeForRole(role, "/api/mcp"), { kind: "forbidden" });
  }
});

test("clients reach the portal and the Academy", () => {
  for (const path of ["/portal", "/portal/placements", "/academy", "/academy/courses/1", "/auth/confirm", "/work"]) {
    assert.deepEqual(routeForRole("client", path), { kind: "allow" }, path);
  }
  for (const path of ["/dashboard", "/dashboard/academy", "/caller"]) {
    assert.deepEqual(routeForRole("client", path), { kind: "redirect", to: "/portal" }, path);
  }
});

test("other roles are left to the existing rules", () => {
  for (const role of ["admin", "member", "external", null, undefined]) {
    assert.deepEqual(routeForRole(role, "/dashboard"), { kind: "allow" });
    assert.ok(!isAcademyOnlyRole(role));
  }
});

test("landing after sign in honours next only where the role may go", () => {
  assert.equal(landingPathFor("candidate", null), "/academy");
  assert.equal(landingPathFor("developer", "/academy/courses/1"), "/academy/courses/1");
  assert.equal(landingPathFor("developer", "/dashboard"), "/academy");
  assert.equal(landingPathFor("developer", "//evil.example"), "/academy");
  assert.equal(landingPathFor("client", undefined), "/portal");
  assert.equal(landingPathFor("client", "/academy"), "/academy");
  assert.equal(landingPathFor("client", "/dashboard/clients"), "/portal");
  assert.equal(landingPathFor("member", "/dashboard/leads"), "/dashboard/leads");
});

test("module academy for team members", () => {
  assert.equal(moduleForPath("/dashboard/academy/people"), "academy");
  assert.ok(effectiveModules("admin", null).includes("academy"));
  assert.ok(!effectiveModules("developer", ["academy"]).includes("academy"));
  assert.ok(!canSeePath("/dashboard/academy", ["sales"]));
  assert.deepEqual(modulesForTable("academy_lessons"), ["academy"]);
  assert.deepEqual(modulesForTable("candidates"), ["recruitment"]);
});
