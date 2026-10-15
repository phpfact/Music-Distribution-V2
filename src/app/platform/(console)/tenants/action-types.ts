/**
 * The shapes the tenant Server Actions (actions.ts) return. A separate module
 * without "use server", so client components can import the types; every
 * import here is type-only and erased from the client bundle.
 */
import type {
  ConnectionTestField,
  ConnectionTestResult,
  CreateTenantField,
  CreateTenantFieldErrors,
  DatabaseCheck,
  LifecycleResult,
  PreviewResult,
  PreviewValues,
} from "@/lib/tenants/service";
import type { TenantCountSource } from "@/lib/tenants/rules";
import type { TenantStatus } from "./labels";
import type {
  CredentialResult,
  DomainCheckResult,
  MasterPasswordResetInput,
  MasterPasswordResetResult,
  UpdateTenantField,
  UpdateTenantFieldErrors,
} from "@/lib/tenants/service";

export type {
  ConnectionTestField,
  ConnectionTestResult,
  CreateTenantField,
  CreateTenantFieldErrors,
  DatabaseCheck,
  PreviewResult,
  PreviewValues,
};

/** useActionState state of the create form. Never contains a password except as noted. */
export type CreateTenantActionState =
  | { status: "idle" }
  | {
      status: "error";
      /** A message for the whole form (rate limit, outage, failed database checks). */
      formError?: string;
      fieldErrors: CreateTenantFieldErrors;
      /** The existing-database checks, when they ran and one failed. */
      checks?: DatabaseCheck[];
    }
  | {
      status: "created";
      tenantId: string;
      /** Login section on Auto-Generate only: shown once, never stored. */
      generatedMasterPassword?: string;
    };

export type TestConnectionInput = {
  databaseName: string;
  databaseUser: string;
  databasePassword: string;
  databasePort: string;
};

/** Suspend, reactivate and retry setup. */
export type TenantLifecycleActionResult = LifecycleResult;

// ---------------------------------------------------------------------------
// Editing, credentials and domains (manage-actions.ts)

export type { UpdateTenantField, UpdateTenantFieldErrors };

/** useActionState state of the edit form. Never contains a secret. */
export type UpdateTenantActionState =
  | { status: "idle" }
  | {
      status: "error";
      /** A message for the whole form (not found, setup running, outage). */
      formError?: string;
      fieldErrors: UpdateTenantFieldErrors;
    }
  | {
      status: "saved";
      tenantId: string;
      /** The fields that were written; empty when nothing had changed. */
      changed: UpdateTenantField[];
      /** A domain change still waits for DNS: say so in the success notice. */
      dnsPending: boolean;
    };

/** What the edit form's hidden `profileImageAction` field may hold. */
export type ProfileImageAction = "keep" | "remove" | "replace";

export type ResetMasterPasswordInput = MasterPasswordResetInput;

/** Auto mode: `generatedPassword` is shown once, never stored. */
export type ResetMasterPasswordActionResult = MasterPasswordResetResult;

/** Rotate (provisioned) and update (existing) database password. */
export type DatabasePasswordActionResult = CredentialResult;

/** "Check DNS" for the custom domain and the subdomain re-check. */
export type DomainCheckActionResult = DomainCheckResult;

// ---------------------------------------------------------------------------
// Count details (actions.ts: loadTenantCountRecordsAction)

export type { TenantCountSource };

/** One tenant in a count-details list: only what the list shows, no contact data or credentials. */
export type TenantCountRecord = {
  id: string;
  name: string;
  status: TenantStatus;
  /** ISO 8601. */
  createdAt: string;
};

/** One page of the tenants behind a count, or a safe failure message. */
export type TenantCountRecordsResult =
  | {
      ok: true;
      rows: TenantCountRecord[];
      total: number;
      /** The page served (1-based). */
      page: number;
      /** At least 1. */
      pageCount: number;
      pageSize: number;
    }
  | { ok: false; message: string };
