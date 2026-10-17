"use client";

import { BanIcon, PlusIcon, RotateCcwIcon, XIcon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import { ConfirmDialog, EmptyState, Notice, SensitiveValue } from "@/components/shared";
import { NoValue } from "@/components/rbac/assigned-users";
import { DirectoryPaging } from "@/components/rbac/directory-parts";
import { formatRbacDate } from "@/components/rbac/format";
import { hasRbacFilters, rbacListHref, type RbacListQuery } from "@/components/rbac/list-href";
import { UserStatusBadge } from "@/components/rbac/role-badges";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type {
  CustomerActionResult,
  CustomerPage,
  CustomerRow,
  CustomerStatusChange,
} from "@/lib/workspace/customer-rules";
import { accountTypeLabel } from "@/lib/workspace/rules";
import { CustomerSourceBadge } from "./customer-records";

// Shown when the Server Action itself could not be reached.
const ACTION_FAILED = "The change could not be saved. Check your connection and try again.";

export type CustomersDirectoryProps = {
  /** One server page (search, status filter and paging already applied by the server). */
  page: CustomerPage;
  /** The parsed URL query (search, status, page). */
  query: RbacListQuery;
  /** The list path ("/tenant/customers"); New and paging links derive from it. */
  basePath: string;
  /** The viewer holds tenant.customers.create (empty-state "Add customer"). */
  canCreate: boolean;
  /**
   * Bound action, only with tenant.customers.suspend: makes `change`
   * ("suspend" for a row shown active, "reactivate" for one shown suspended).
   */
  toggleStatusAction?: (customerId: string, change: CustomerStatusChange) => Promise<CustomerActionResult>;
};

/**
 * Description: The tenant's customers directory.
 * Input: See CustomersDirectoryProps: one server page, the query, the list
 *   path, the create permission and the bound suspend/reactivate action.
 * Output: A table from xl and cards below with Customer, Username and Email
 *   (masked with an eye toggle), Account type, Source, Status, Created and
 *   Suspend / Reactivate (with confirmation) when permitted. Success messages
 *   appear above the list and only the server data is refreshed (no full
 *   reload). Paging keeps the search and filter. Empty states offer
 *   "Add customer" or "Clear filters".
 * Use case: /tenant/customers.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-17
 * Last modified: 2026-10-17
 */
export function CustomersDirectory({ page, query, basePath, canCreate, toggleStatusAction }: CustomersDirectoryProps) {
  const router                = useRouter();
  const [, startTransition]   = useTransition();
  const [success, setSuccess] = useState<string | null>(null);
  const filtered              = hasRbacFilters(query);

  /**
   * Description: Show a row action's success and refresh only the server data.
   * Input: The success message.
   * Output: A dismissible success notice; the page data re-renders.
   * Use case: onDone of the row actions.
   * Author: Mr. Sachin Sharma
   * Created: 2026-10-17
   * Last modified: 2026-10-17
   */
  function done(message: string) {
    setSuccess(message);
    startTransition(() => router.refresh());
  }

  return (
    <div className="flex flex-col gap-4">
      {success ? (
        <Notice variant="success" onDismiss={() => setSuccess(null)}>
          {success}
        </Notice>
      ) : null}

      {page.total === 0 ? (
        <EmptyState
          icon="user"
          title={filtered ? "No customers match" : "No customers yet"}
          description={
            filtered
              ? "Try another search or status, or clear the filters."
              : "Add your first artist, label or white-label partner, or approve a sign-up on the Registrations page."
          }
          action={
            filtered ? (
              <Button asChild variant="outline">
                <Link href={rbacListHref(basePath, {})}>
                  <XIcon aria-hidden="true" />
                  Clear filters
                </Link>
              </Button>
            ) : canCreate ? (
              <Button asChild>
                <Link href={`${basePath}/new`}>
                  <PlusIcon aria-hidden="true" />
                  Add customer
                </Link>
              </Button>
            ) : undefined
          }
        />
      ) : (
        <>
          {/* Wide screens: a table (from xl). */}
          <div className="hidden overflow-x-auto rounded-lg border xl:block">
            <Table>
              <TableCaption className="sr-only">Customers</TableCaption>
              <TableHeader>
                <TableRow>
                  <TableHead>Customer</TableHead>
                  <TableHead>Username</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Account type</TableHead>
                  <TableHead>Source</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Created</TableHead>
                  {toggleStatusAction ? <TableHead className="text-right">Actions</TableHead> : null}
                </TableRow>
              </TableHeader>
              <TableBody>
                {page.rows.map((row) => (
                  <TableRow key={row.id} className="align-top">
                    <TableCell className="max-w-72 font-medium break-words whitespace-normal">{row.name}</TableCell>
                    <TableCell>{row.username ? <SensitiveValue value={row.username} noun="username" /> : <NoValue />}</TableCell>
                    <TableCell>{row.email ? <SensitiveValue value={row.email} noun="email" monospace={false} /> : <NoValue />}</TableCell>
                    <TableCell>{accountTypeLabel(row.accountType)}</TableCell>
                    <TableCell>
                      <CustomerSourceBadge source={row.source} />
                    </TableCell>
                    <TableCell>
                      <UserStatusBadge status={row.status} />
                    </TableCell>
                    <TableCell className="whitespace-nowrap">{formatRbacDate(row.createdAt)}</TableCell>
                    {toggleStatusAction ? (
                      <TableCell>
                        <CustomerStatusButton row={row} toggleStatusAction={toggleStatusAction} onDone={done} />
                      </TableCell>
                    ) : null}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {/* Phones and tablets: one card per customer (actions always visible). */}
          <ul className="flex flex-col gap-3 xl:hidden">
            {page.rows.map((row) => (
              <li key={row.id} className="flex flex-col gap-3 rounded-lg border bg-card p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-medium break-words">{row.name}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {accountTypeLabel(row.accountType)} · Created {formatRbacDate(row.createdAt)}
                    </p>
                  </div>
                  <UserStatusBadge status={row.status} />
                </div>
                <dl className="grid gap-2 text-sm">
                  <div className="flex flex-col gap-0.5">
                    <dt className="text-xs text-muted-foreground">Username</dt>
                    <dd>{row.username ? <SensitiveValue value={row.username} noun="username" /> : <NoValue />}</dd>
                  </div>
                  <div className="flex flex-col gap-0.5">
                    <dt className="text-xs text-muted-foreground">Email</dt>
                    <dd>{row.email ? <SensitiveValue value={row.email} noun="email" monospace={false} /> : <NoValue />}</dd>
                  </div>
                  <div className="flex flex-col gap-0.5">
                    <dt className="text-xs text-muted-foreground">Source</dt>
                    <dd>
                      <CustomerSourceBadge source={row.source} />
                    </dd>
                  </div>
                </dl>
                {toggleStatusAction ? <CustomerStatusButton row={row} toggleStatusAction={toggleStatusAction} onDone={done} /> : null}
              </li>
            ))}
          </ul>

          <DirectoryPaging basePath={basePath} query={query} page={page} label="Customers pages" />
        </>
      )}
    </div>
  );
}

type CustomerStatusButtonProps = {
  row: CustomerRow;
  /** Bound action (tenant.customers.suspend is checked again on the server). */
  toggleStatusAction: (customerId: string, change: CustomerStatusChange) => Promise<CustomerActionResult>;
  /** Called with the success message after a change. */
  onDone: (message: string) => void;
};

/**
 * Description: The Suspend / Reactivate button of one customer, with its confirmation.
 * Input: The row, the bound action and the success callback.
 * Output: A button that opens a confirmation dialog explaining the effect;
 *   confirming sends the change this row's shown status means ("suspend" for
 *   active, "reactivate" for suspended) exactly once (spinner, repeat clicks
 *   ignored). A refusal (e.g. already changed in another tab) stays in the dialog.
 * Use case: CustomersDirectory table rows and cards.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-17
 * Last modified: 2026-10-17
 */
function CustomerStatusButton({ row, toggleStatusAction, onDone }: CustomerStatusButtonProps) {
  const [open, setOpen]       = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError]     = useState<string | null>(null);
  // Synchronous guard against a second confirm before React re-renders.
  const running    = useRef(false);
  const suspending = row.status === "active";

  /**
   * Description: Run the confirmed suspend / reactivate once.
   * Input: None (reads the row).
   * Output: Success: the dialog closes and onDone gets the message; failure:
   *   the friendly error is shown in the dialog.
   * Use case: ConfirmDialog onConfirm.
   * Author: Mr. Sachin Sharma
   * Created: 2026-10-17
   * Last modified: 2026-10-17
   */
  async function confirm() {
    if (running.current) return;
    running.current = true;
    setPending(true);
    setError(null);
    try {
      const result = await toggleStatusAction(row.id, suspending ? "suspend" : "reactivate");
      if (result.ok) {
        setOpen(false);
        onDone(result.message);
      } else {
        setError(result.error);
      }
    } catch {
      setError(ACTION_FAILED);
    } finally {
      running.current = false;
      setPending(false);
    }
  }

  return (
    <div className="flex justify-end">
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => {
          setError(null);
          setOpen(true);
        }}
        aria-label={`${suspending ? "Suspend" : "Reactivate"} ${row.name}`}
      >
        {suspending ? <BanIcon aria-hidden="true" /> : <RotateCcwIcon aria-hidden="true" />}
        {suspending ? "Suspend" : "Reactivate"}
      </Button>
      <ConfirmDialog
        open={open}
        onClose={() => {
          setOpen(false);
          setError(null);
        }}
        title={suspending ? `Suspend ${row.name}?` : `Reactivate ${row.name}?`}
        description={
          suspending
            ? `${row.name} is signed out everywhere and cannot log in until you reactivate the account. Their sub-customers cannot log in either.`
            : `${row.name} can log in again, and so can their active sub-customers.`
        }
        confirmLabel={suspending ? "Suspend" : "Reactivate"}
        confirmVariant={suspending ? "danger" : "primary"}
        pending={pending}
        error={error}
        onConfirm={() => void confirm()}
      />
    </div>
  );
}
