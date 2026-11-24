# Platform Owner Management

## Overview
- **Name:** Platform Owner Management & Role-Based Access Control (RBAC)
- **Purpose:** Manage all platform owners and their roles from a centralized interface with strict Role-Based Access Control (RBAC).
- **Business Goal:** Allow the Super Admin / Main Platform Owner to create multiple platform owners, assign specific roles, and independently control which modules, features, pages, and actions each platform owner can access.
- **Current Status:** Completed / Active

## Features
- **Platform Owner Directory:** Searchable and filterable listing of platform owners displaying Full Name, Email, Mobile, Role, Account Status, Created Date, Last Login, and Actions.
- **Search & Filters:** Search by name, email, and mobile; filter by role and active/inactive status; pagination; sorting.
- **Metrics Summary & Transparency:** Total Platform Owners, Active Platform Owners, Inactive Platform Owners, and Total Roles, with clickable details popups.
- **Create Platform Owner:** Mandatory role selection with delegation ceiling validation, duplicate email/mobile checks, password strength validation with checklist, eye toggles for sensitive fields.
- **View Owner Details:** Dedicated modal/page showing complete profile, assigned role, effective privileges breakdown, login history, and creation metadata.
- **Edit Platform Owner:** Update full name, email, mobile, and account status with instant server-side validation.
- **Change Role:** Reassign role with immediate permission recalculation and session cache invalidation.
- **Reset Password:** Administrative password reset with confirmation and session revocation.
- **Activate / Deactivate:** Toggle account status with confirmation; deactivation immediately revokes active sessions.
- **Delete Platform Owner:** Safe deletion preventing self-deletion, primary Super Admin deletion, and removal of the last administrator.
- **Role Management:** Create, edit, and delete custom roles with module-wise permission grouping, select all/clear all, expand/collapse, and delegation ceiling enforcement.
- **Audit Logging:** Comprehensive tracking of all administrative operations (created, updated, role changed, status changed, password reset, deleted).
- **Dashboard:** Platform owner statistics, active/inactive counts, roles count, and recently created owners.

## User Flow
1. Super Admin logs in to the platform console (`/platform/login`).
2. Navigates to Platform Owners (`/platform/users`).
3. Views the summary cards and directory of all platform owners.
4. Uses search or filters to locate specific accounts.
5. Clicks "Add Platform Owner" to create an account, selects a mandatory role, fills details, and submits.
6. The newly created platform owner logs in and only sees permitted navigation, pages, and actions according to their assigned role.

## Admin Flow
- **Role Assignment:** Super Admin creates custom roles with specific module permissions (e.g. Finance Manager with payment/withdrawal access, Support Manager with ticket access).
- **Owner Account Administration:** Super Admin edits contact information, changes roles, resets passwords, or deactivates compromised accounts.
- **Audit Review:** Administrative actions are recorded in immutable audit events for security history.

## Business Rules
1. **Mandatory Role:** A platform owner cannot exist without an assigned valid role.
2. **Delegation Ceiling:** An administrator cannot grant permissions they do not possess, nor create or assign roles higher than their own authority.
3. **Primary Super Admin Protection:** The primary Super Admin (`isPrimary: true`) cannot be deactivated, deleted, or have their master role demoted.
4. **Self-Lockout Protection:** A logged-in administrator cannot deactivate or delete their own account.
5. **Last Admin Protection:** The system prevents deleting or deactivating the last active administrator with master/admin access.
6. **Unique Identities:** Emails and mobile numbers must be unique across all platform owner accounts.
7. **Immediate Enforcement:** Role updates and status changes take effect on the user's very next request. Deactivation immediately deletes active sessions.
8. **Deny by Default:** Unpermitted routes, APIs, and actions are denied with an Access Denied response.

## Validations
- **Full Name:** Required, 2-200 characters, letters, spaces, and allowed special characters.
- **Email:** Required, valid RFC-compliant email, case-insensitively unique.
- **Mobile Number:** Required, valid phone format (10-digit Indian standard or E.164 format), unique.
- **Password:** Minimum 10 characters, requiring uppercase, lowercase, number, and special character; must match confirmation.
- **Role ID:** Required, must be a valid active role UUID within the administrator's assignment ceiling.

## UI Behavior
- Built strictly with Shadcn UI components and design tokens.
- Fully supports Light, Dark, and user-selected appearance themes.
- Sensitive values (passwords, emails, phone numbers) masked by default with eye toggle.
- Count transparency: clickable summary numbers with detailed breakdown popups.
- Dynamic secondary menu for section navigation on multi-section forms.
- Reduced motion-aware scrolling and focus management on validation errors.

## Database
- **Table:** `platform_owners`
  - Columns: `id` (UUID), `username` (VARCHAR 64), `email` (VARCHAR 320 UNIQUE), `phone` (VARCHAR 20 UNIQUE), `password_hash` (VARCHAR 255), `full_name` (VARCHAR 200), `status` (ENUM active/disabled), `is_primary` (BOOLEAN), `role_id` (UUID FK -> platform_roles), `created_by_id` (UUID FK -> platform_owners), `created_at`, `updated_at`, `last_login_at`.
- **Table:** `platform_roles`
  - Columns: `id`, `name`, `description`, `status`, `system_key`, `created_by_id`, `created_at`, `updated_at`.
- **Table:** `platform_role_permissions`
  - Columns: `role_id` (FK), `permission_key` (FK).
- **Table:** `platform_owner_sessions`
  - Columns: `id`, `owner_id`, `token_hash`, `created_at`, `last_used_at`, `expires_at`.
- **Table:** `audit_events`
  - Append-only audit trail with actor details, action name, target, metadata, and IP address.

## Security
- Centralized server-side authorization on every action and page render.
- Passwords hashed using Argon2id (PHC format).
- Sessions stored with SHA-256 token hashes in HTTP-only secure cookies.
- CSRF protection via Next.js Server Actions.
- Protection against privilege escalation, IDOR, and duplicate submission.

## Change History
- **2026-11-24:** Complete implementation of Platform Owner Management module with email, phone, last login, view details, change role, reset password, safe deletion, and role permission UI controls.
- **Author:** Mr. Sachin Sharma
