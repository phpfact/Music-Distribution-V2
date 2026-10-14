import { describe, expect, it } from "vitest";
import {
  isSetupInProgress,
  showsSetupCard,
  suspensionSentence,
} from "@/app/platform/(console)/tenants/details";
import {
  formatDate,
  formatDateTime,
  formatCount,
  tenantSiteUrl,
} from "@/app/platform/(console)/tenants/format";
import type { TenantStatus } from "@/app/platform/(console)/tenants/labels";
import {
  pageRowRange,
  tenantFilterHref,
  tenantListHref,
  tenantNoticeMessage,
} from "@/app/platform/(console)/tenants/list-query";

describe("tenantNoticeMessage", () => {
  it.each(["created", "updated", "updated-dns", "suspended", "reactivated"])("has a fixed message for %j", (code) => {
    expect(tenantNoticeMessage(code)).toEqual(expect.any(String));
  });

  it("gives each code its own message", () => {
    const messages = ["created", "updated", "updated-dns", "suspended", "reactivated"].map(tenantNoticeMessage);
    expect(new Set(messages).size).toBe(5);
  });

  it("says that a changed domain still needs its DNS check", () => {
    expect(tenantNoticeMessage("updated-dns")).toBe(
      "Tenant updated. The new domain needs a DNS check before it becomes active.",
    );
  });

  it("uses the first of repeated values", () => {
    expect(tenantNoticeMessage(["suspended", "x"])).toBe(tenantNoticeMessage("suspended"));
  });

  it.each([undefined, "", "unknown", "<script>", "toString", "__proto__", "constructor", []])(
    "ignores %j",
    (value) => {
      expect(tenantNoticeMessage(value as string | string[] | undefined)).toBeNull();
    },
  );
});

describe("tenantListHref", () => {
  it("leaves the defaults out", () => {
    expect(tenantListHref({})).toBe("/platform/tenants");
    expect(tenantListHref({ q: "", status: "all", page: 1 })).toBe("/platform/tenants");
  });

  it("encodes search, status and page", () => {
    expect(tenantListHref({ q: "a&b c", status: "failed", page: 3 })).toBe(
      "/platform/tenants?q=a%26b+c&status=failed&page=3",
    );
  });
});

describe("tenantFilterHref", () => {
  it("sets the search, drops the page and the notice, keeps the rest", () => {
    expect(tenantFilterHref("q=old&status=active&page=4&notice=created&x=1", { q: " new " })).toBe(
      "/platform/tenants?q=new&status=active&x=1",
    );
  });

  it("removes an emptied search and the default status", () => {
    expect(tenantFilterHref("q=acme&status=failed&page=2", { q: "  ", status: "all" })).toBe(
      "/platform/tenants",
    );
  });

  it("changes the status and keeps the search", () => {
    expect(tenantFilterHref(new URLSearchParams("q=acme"), { status: "suspended" })).toBe(
      "/platform/tenants?q=acme&status=suspended",
    );
  });
});

describe("pageRowRange", () => {
  it.each([
    [1, 20, 45, { first: 1, last: 20 }],
    [2, 20, 45, { first: 21, last: 40 }],
    [3, 20, 45, { first: 41, last: 45 }],
    [1, 20, 20, { first: 1, last: 20 }],
    [1, 20, 1, { first: 1, last: 1 }],
  ])("page %i of size %i with %i rows: %j", (page, size, total, expected) => {
    expect(pageRowRange(page, size, total)).toEqual(expected);
  });

  it("is null for an empty list and for a page past the end", () => {
    expect(pageRowRange(1, 20, 0)).toBeNull();
    expect(pageRowRange(4, 20, 45)).toBeNull();
    expect(pageRowRange(2, 20, 20)).toBeNull();
  });
});

describe("date and number formatting", () => {
  it("writes dates in UTC, whatever the local time zone", () => {
    expect(formatDate("2026-10-14T23:30:00.000Z")).toBe("14 Oct 2026");
    expect(formatDateTime("2026-10-14T07:03:09.000Z")).toBe("14 Oct 2026, 07:03 UTC");
  });

  it("shows a dash for something that is not a date", () => {
    expect(formatDate("nonsense")).toBe("—");
    expect(formatDateTime("")).toBe("—");
  });

  it("groups thousands", () => {
    expect(formatCount(0)).toBe("0");
    expect(formatCount(12345)).toBe("12,345");
  });
});

describe("tenantSiteUrl", () => {
  it("uses http and the console's port for a local base domain", () => {
    expect(tenantSiteUrl("acme.localhost", { host: "127.0.0.1:3000", forwardedProto: null })).toBe(
      "http://acme.localhost:3000",
    );
    expect(tenantSiteUrl("acme.localhost", { host: "[::1]:3000", forwardedProto: null })).toBe(
      "http://acme.localhost:3000",
    );
  });

  it("uses https without a port for a public host", () => {
    expect(tenantSiteUrl("acme.example.com", { host: "console.example.com", forwardedProto: null })).toBe(
      "https://acme.example.com",
    );
  });

  it("follows the proxy's scheme and leaves out its default port", () => {
    expect(tenantSiteUrl("acme.example.com", { host: "example.com:443", forwardedProto: "https" })).toBe(
      "https://acme.example.com",
    );
    expect(tenantSiteUrl("acme.example.com", { host: "example.com:8080", forwardedProto: "http, https" })).toBe(
      "http://acme.example.com:8080",
    );
    // Anything else in the header is ignored.
    expect(tenantSiteUrl("acme.localhost", { host: null, forwardedProto: "javascript" })).toBe(
      "http://acme.localhost",
    );
  });
});

describe("the details page's setup rules", () => {
  const statuses: TenantStatus[] = ["pending", "provisioning", "active", "failed", "suspended", "deprovisioning"];

  it("polls only while setup is pending or running", () => {
    expect(statuses.filter(isSetupInProgress)).toEqual(["pending", "provisioning"]);
  });

  it("shows the setup card until setup succeeded, and whenever it can be retried", () => {
    expect(statuses.filter((status) => showsSetupCard(status, false))).toEqual([
      "pending",
      "provisioning",
      "failed",
    ]);
    expect(showsSetupCard("provisioning", true)).toBe(true);
    expect(showsSetupCard("active", false)).toBe(false);
  });
});

describe("suspensionSentence", () => {
  it("names the date, the owner and the reason", () => {
    expect(
      suspensionSentence({ at: "2026-10-14T07:03:00.000Z", by: "owner", reason: "Unpaid invoice" }),
    ).toBe("Suspended on 14 Oct 2026, 07:03 UTC by owner: Unpaid invoice");
  });

  it("leaves out what is unknown", () => {
    expect(suspensionSentence({ at: null, by: null, reason: null })).toBe("Suspended.");
    expect(suspensionSentence({ at: null, by: "owner", reason: "Abuse" })).toBe("Suspended by owner: Abuse");
  });
});
