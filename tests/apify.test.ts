import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import {
  buildIndeedJobsInput,
  buildLinkedinJobsInput,
  buildPeopleSearchInput,
  companyDomainFrom,
  mapIndeedJob,
  mapLinkedinJob,
  mapPerson,
  parsePostedDate,
  runActorSync,
} from "@/lib/integrations/apify";

const now = new Date("2026-10-24T12:00:00Z");
const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
  delete process.env.APIFY_TOKEN;
});

test("mapLinkedinJob: curious_coder style item", () => {
  const job = mapLinkedinJob(
    {
      id: "4012345678",
      title: "Senior Backend Developer",
      companyName: "Acme Software B.V.",
      companyLinkedinUrl: "https://nl.linkedin.com/company/acme-software/?trk=x",
      companyWebsite: "https://www.acme.nl/",
      companyEmployeesCount: 45,
      location: "Utrecht, Utrecht, Nederland",
      postedAt: "2026-10-20",
      descriptionText: "Wij zoeken een backend developer.",
      link: "https://www.linkedin.com/jobs/view/4012345678",
    },
    now,
  );
  assert.equal(job.source, "linkedin");
  assert.equal(job.companyName, "Acme Software B.V.");
  assert.equal(job.companyDomain, "acme.nl");
  assert.equal(job.companyLinkedinUrl, "linkedin.com/company/acme-software");
  assert.equal(job.title, "Senior Backend Developer");
  assert.equal(job.employees, 45);
  assert.equal(job.postedAt, "2026-10-20T00:00:00.000Z");
  assert.equal(job.jobUrl, "https://www.linkedin.com/jobs/view/4012345678");
  assert.equal(job.description, "Wij zoeken een backend developer.");
});

test("mapLinkedinJob: bebity style item without website", () => {
  const job = mapLinkedinJob(
    {
      title: "Data Engineer",
      companyName: "Beta BV",
      companyUrl: "https://www.linkedin.com/company/beta-bv",
      publishedAt: "2026-10-01T08:00:00.000Z",
      description: "<p>Data <b>engineer</b></p><p>Python</p>",
      jobUrl: "https://www.linkedin.com/jobs/view/1",
      companySize: "11-50 employees",
    },
    now,
  );
  assert.equal(job.companyDomain, null);
  assert.equal(job.companyLinkedinUrl, "linkedin.com/company/beta-bv");
  assert.equal(job.description, "Data engineer\nPython");
  assert.equal(job.employees, 31);
});

test("mapIndeedJob: misceres style item, domain from apply link", () => {
  const job = mapIndeedJob(
    {
      positionName: "Full Stack Developer",
      company: "Gamma Logistics",
      location: "Rotterdam",
      url: "https://nl.indeed.com/viewjob?jk=abc",
      postedAt: "3 dagen geleden",
      description: "Hybride, kantoor in Rotterdam.",
      externalApplyLink: "https://werkenbij.gamma.nl/vacatures/full-stack",
      companyInfo: { indeedUrl: "https://nl.indeed.com/cmp/Gamma" },
    },
    now,
  );
  assert.equal(job.source, "indeed");
  assert.equal(job.companyDomain, "werkenbij.gamma.nl");
  assert.equal(job.title, "Full Stack Developer");
  assert.equal(job.postedAt, "2026-10-21T12:00:00.000Z");
});

test("mapIndeedJob: ATS apply link is not a company domain; valig style item", () => {
  const ats = mapIndeedJob({ positionName: "Data Analist", company: "Delta", externalApplyLink: "https://delta.recruitee.com/o/data" }, now);
  assert.equal(ats.companyDomain, null);
  const valig = mapIndeedJob(
    {
      title: "BI Developer",
      employer: { name: "Epsilon", corporateWebsite: "http://epsilon.com", employeesCount: "201-500" },
      location: { city: "Eindhoven" },
      datePublished: "2026-09-01",
      description: { text: "Power BI" },
    },
    now,
  );
  assert.equal(valig.companyName, "Epsilon");
  assert.equal(valig.companyDomain, "epsilon.com");
  assert.equal(valig.location, "Eindhoven");
  assert.equal(valig.description, "Power BI");
  assert.equal(valig.employees, 351);
});

test("companyDomainFrom rejects job boards and ATS hosts", () => {
  assert.equal(companyDomainFrom("https://www.Acme.nl/careers"), "acme.nl");
  assert.equal(companyDomainFrom("https://boards.greenhouse.io/acme"), null);
  assert.equal(companyDomainFrom("https://nl.linkedin.com/company/x"), null);
  assert.equal(companyDomainFrom("geen"), null);
});

test("parsePostedDate handles relative and absolute dates", () => {
  assert.equal(parsePostedDate("30+ days ago", now), "2026-09-24T12:00:00.000Z");
  assert.equal(parsePostedDate("Vandaag", now), now.toISOString());
  assert.equal(parsePostedDate("2 weeks ago", now), "2026-10-10T12:00:00.000Z");
  assert.equal(parsePostedDate(1_790_000_000_000, now), new Date(1_790_000_000_000).toISOString());
  assert.equal(parsePostedDate("niet bekend", now), null);
});

test("mapPerson reads both people actor shapes", () => {
  const a = mapPerson({
    first_name: "Jan",
    last_name: "de Vries",
    job_title: "CTO",
    linkedin: "http://www.linkedin.com/in/jandevries",
    company_domain: "acme.nl",
  });
  assert.deepEqual(a, { firstName: "Jan", lastName: "de Vries", title: "CTO", linkedinUrl: "linkedin.com/in/jandevries", companyDomain: "acme.nl" });
  const b = mapPerson({
    fullName: "Sanne van der Berg",
    linkedinUrl: "https://nl.linkedin.com/in/sanne-vdb/",
    currentPosition: [{ position: "Head of Data", companyName: "Acme" }],
  });
  assert.deepEqual(b, { firstName: "Sanne", lastName: "van der Berg", title: "Head of Data", linkedinUrl: "linkedin.com/in/sanne-vdb", companyDomain: null });
});

test("input builders", () => {
  const linkedin = buildLinkedinJobsInput({ days: 7, limit: 100, roles: ["data engineer"] });
  assert.equal(linkedin.count, 100);
  assert.match(linkedin.urls[0], /keywords=data\+engineer/);
  assert.match(linkedin.urls[0], /f_TPR=r604800/);
  const indeed = buildIndeedJobsInput({ days: 5, limit: 50, roles: ["BI developer"] });
  assert.match(indeed.startUrls[0].url, /fromage=7/);
  assert.equal(indeed.country, "NL");
  const people = buildPeopleSearchInput({ domain: "acme.nl", companyLinkedinUrl: "linkedin.com/company/acme", titles: ["CTO"], limit: 10 });
  assert.deepEqual(people.company_domain, ["acme.nl"]);
  assert.deepEqual(people.companies, ["https://www.linkedin.com/company/acme"]);
});

test("runActorSync posts the input and returns items", async () => {
  process.env.APIFY_TOKEN = "test-token";
  let calledUrl = "";
  let auth = "";
  globalThis.fetch = async (input, init) => {
    calledUrl = String(input);
    auth = new Headers(init?.headers).get("authorization") ?? "";
    return new Response(JSON.stringify([{ title: "x" }]), { status: 200 });
  };
  const items = await runActorSync("user~actor", { a: 1 }, { maxItems: 5, timeoutSecs: 60 });
  assert.deepEqual(items, [{ title: "x" }]);
  assert.match(calledUrl, /acts\/user~actor\/run-sync-get-dataset-items/);
  assert.match(calledUrl, /maxItems=5/);
  assert.equal(auth, "Bearer test-token");
  assert.doesNotMatch(calledUrl, /test-token/);
});

test("runActorSync fails loudly on errors and odd bodies", async () => {
  process.env.APIFY_TOKEN = "test-token";
  globalThis.fetch = async () => new Response("timeout", { status: 408 });
  await assert.rejects(runActorSync("user~actor", {}), /Verlaag --limit/);
  globalThis.fetch = async () => new Response(JSON.stringify({ data: {} }), { status: 200 });
  await assert.rejects(runActorSync("user~actor", {}), /geen lijst/);
});
