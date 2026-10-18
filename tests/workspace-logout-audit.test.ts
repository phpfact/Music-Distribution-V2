import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReadyWorkspace } from "@/lib/workspace/context";
import { requestContextFromHeaders } from "@/lib/request-context";
import { revokeWorkspaceSession } from "@/lib/workspace/logout";

const mocks = vi.hoisted(() => ({
  validateUser: vi.fn(), validateRegistration: vi.fn(), revokeUser: vi.fn(), revokeRegistration: vi.fn(),
}));
vi.mock("@/lib/workspace/sessions", () => ({
  validateUserSession: mocks.validateUser,
  validateRegistrationSession: mocks.validateRegistration,
  revokeUserSession: mocks.revokeUser,
  revokeRegistrationSession: mocks.revokeRegistration,
}));
const workspace = { state: "ready", tenant: { id: "verified-tenant", name: "Workspace" }, db: {} } as ReadyWorkspace;
const context = requestContextFromHeaders(new Headers({ "x-forwarded-for": "203.0.113.18" }), { pathname: "/customer/registration", method: "POST" });
beforeEach(() => {
  vi.resetAllMocks();
  mocks.validateUser.mockResolvedValue({ id: "verified-user" });
  mocks.validateRegistration.mockResolvedValue({ registrationId: "verified-applicant" });
  mocks.revokeUser.mockResolvedValue(undefined);
  mocks.revokeRegistration.mockResolvedValue(undefined);
});
afterEach(() => { vi.restoreAllMocks(); });

describe("workspace logout attribution", () => {
  it.each(["tenant", "customer", "registration"] as const)("records successful %s logout with verified actor and safe context", async (area) => {
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    await revokeWorkspaceSession(workspace, area, "private-cookie-token", context);
    const event = JSON.parse(log.mock.calls[0]![0] as string);
    expect(event).toMatchObject({ event: "auth.logout", area, tenantId: "verified-tenant", actorId: area === "registration" ? "verified-applicant" : "verified-user", reason: "logged_out", outcome: "success", clientIp: "203.0.113.18", request: { requestId: context.requestId, method: "POST" } });
    expect(JSON.stringify(log.mock.calls)).not.toContain("private-cookie-token");
    if (area === "registration") expect(mocks.revokeRegistration).toHaveBeenCalledWith(workspace.db, workspace.tenant.id, "private-cookie-token");
    else expect(mocks.validateUser).toHaveBeenCalledWith(workspace.db, workspace.tenant.id, area, "private-cookie-token", { touch: false });
  });

  it("still revokes when attribution fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    mocks.validateUser.mockRejectedValue(new Error("database unavailable"));
    await expect(revokeWorkspaceSession(workspace, "tenant", "private-cookie-token", context)).resolves.toBeUndefined();
    expect(mocks.revokeUser).toHaveBeenCalled();
  });

  it("reports revocation failure without preventing cookie cleanup", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    mocks.revokeRegistration.mockRejectedValue(new Error("database unavailable"));
    await expect(revokeWorkspaceSession(workspace, "registration", "private-cookie-token", context)).resolves.toBeUndefined();
    expect(JSON.parse(warn.mock.calls[0]![0] as string)).toMatchObject({ event: "auth.logout", area: "registration", actorId: "verified-applicant", outcome: "unavailable", reason: "unavailable" });
  });
});
