# Coding Rules

**Goal:** simple, well-structured, heavily commented, production-quality code that is easy to read, debug and maintain, and consistent across the project. Write for a future developer with no project knowledge. Readability > performance.

## Communication Language (mandatory)

- The user may write in Hinglish, Hindi, English or any other language. Always reply **only in Hinglish**: every question, clarification, suggestion, recommendation, implementation discussion and conversational response.
- Never switch to Hindi-only or English-only when communicating directly with the user.
- Instructions, questions, prompts and other text you give to a terminal/CLI, another AI tool or an AI coding agent must also be in Hinglish.
- Scope: this rule applies strictly to conversations and direct communication — with the user, and the terminal/AI-tool input above.

## Before Coding (strict)

Mandatory order: understand requirement → inspect module → understand architecture/behavior → identify changes → resolve ambiguity → implement → verify.

### Never assume or guess

If anything is ambiguous, uncertain, missing or doubtful (implementation, business logic, expected behavior, edge cases, requirements):

- Don't write or modify code, assume, guess, or pick an implementation by personal preference.
- Ask me one clear question at a time (in Hinglish) and wait for my answer. Repeat until everything is clear, then code.

### Understand existing modules first (mandatory)

Before changing an existing module, fully understand it, not just the obvious file:

- Inspect related files, components, controllers, models, services, APIs, DB interactions, routes, validations and logic.
- Understand its data flow, business logic, UI/UX behavior, user flow, and how the change fits the architecture.
- Reuse existing patterns, utilities and coding standards (see _Reuse, Don't Duplicate_ and _Formatting_).

### Protect existing functionality

- Implement only the requirements in my prompt; stay focused on the requested task.
- Don't break or remove existing behavior unless explicitly requested.
- Don't touch unrelated functionality or code, refactor unnecessarily, or rewrite/restructure/replace working code.
- Don't change DB structure, APIs, naming conventions or architecture unless the requirement needs it.
- Test/verify the implementation before considering the task complete.

## Git Worktree & Branch Workflow (mandatory)

Every independent coding task gets its own isolated **Git branch + Git Worktree + working directory**. This applies especially when multiple AI agents work on the project at the same time, the same AI agent works on several tasks at the same time, or different features, bug fixes, improvements or modules are developed simultaneously. Never let two independent tasks work inside the same active worktree.

Required flow: check worktrees → create task branch → create dedicated worktree → implement → test/verify → commit → merge into `main`/`master` → verify merge → clean up (if appropriate).

1. **Check existing worktrees first.** Run `git worktree list` before creating anything.
   - Same task already has a dedicated worktree and branch → reuse it; never create a duplicate.
   - Branch already checked out by another worktree → don't force it into another worktree; create/use the appropriate dedicated task branch instead.
2. **Name the branch.** Read my complete prompt, identify the actual coding task, and give the branch a clear, descriptive name: `feature/user-login`, `feature/user-signup`, `feature/payment-integration`, `feature/dashboard`, `fix/login-validation`, `fix/checkout-error`, `refactor/user-service`. Never use generic names such as `test`, `new`, `task`, `branch1`, `changes`.
3. **Create a real worktree** with `git worktree add <worktree-path> <branch-name>` (never a normal folder called a worktree) and implement the task only inside it.
4. **Stay isolated.** Never sacrifice, overwrite, reset or delete another AI agent's work. Never modify another task's worktree, branch, files or active changes:
   - Don't reset another worktree, check out another task's branch, delete another task's worktree, or stash another task's changes.
   - Don't overwrite another AI agent's changes or modify files outside the current task's worktree.
5. **Implement** following _Before Coding_ and every other rule in this file.
6. **Commit** once implemented and verified: review the changes, make sure there are no unrelated modifications (stage only this task's files), and commit to the dedicated task branch with a clear message describing the completed task (e.g. `git commit -m "Implement user login functionality"`).
7. **Merge (mandatory).** Once the task is finished, tested and committed:
   - Identify the repository's primary integration branch: check whether `main` or `master` actually exists/is used; never assume.
   - Merge the task branch into it and verify the merge completed successfully.
   - Never overwrite or discard other completed work. On a merge conflict, stop and resolve it carefully without deleting unrelated work.
   - The task is **not complete** until it is merged, unless the merge is technically blocked by an unresolved conflict or another explicit repository constraint.
8. **Clean up last.** Don't remove the worktree until the implementation is committed, merged and the merge verified; only then clean it up if appropriate. Use `git worktree list` to verify worktree state.
9. **Final response:** a concise summary:

   ```
   Task:                  <task name>
   Branch:                <branch name>
   Worktree:              <worktree path>
   Changes:               <summary of files/features changed>
   Commit:                <commit hash/message>
   Merged Into:           <main or master>
   Merge Status:          <success/conflict>
   Implementation Status: <completed / blocked>
   ```

## Module Memory (`.vibe/memory/`)

Every module has **exactly one** markdown memory file in `.vibe/memory/` (lowercase kebab-case, e.g. `user-management.md`, `fresh-case-entry.md`). It is the single source of truth for AI editors and developers: reading only that file, without the source code, anyone should understand what the module does, why it exists, how it works, why decisions were made, what changed and what's planned.

- Never combine modules in one file.
- Use only `.vibe/memory/` for module memory. Don't assume any other directory structure unless I provide it.

### Workflow (never skip)

For any work on a module:

1. Locate its memory file; create it if missing.
2. Update the memory file with the requested changes.
3. Implement the code changes.
4. Ensure code and memory describe the same behavior.

- Never update one without the other: code changes → update memory; new requirements in memory → update code.
- Update memory for every meaningful change: new module/feature, enhancement, flow, bug fix, validation, UI, database, API, business rule, performance, refactoring, security, caching, configuration or dependency change.
- Keep the file current with the implementation, but never overwrite important history (significant design decisions, major features, architectural changes).

### Contents (where applicable, written clearly and professionally)

- **Overview:** name, purpose, business goal, current status
- **Features:** current, completed, future enhancements
- **User Flow:** end-to-end
- **Admin Flow:** administrative workflow
- **Business Rules:** logic, important rules, constraints
- **Validations:** frontend, backend, database
- **UI Behavior:** screen behavior, dynamic fields, conditional logic
- **Database:** tables, relationships, important columns, constraints, indexes
- **APIs:** endpoints, request/response structure, error handling
- **Security:** authentication, authorization, permissions, input validation, considerations
- **Performance:** query optimizations, caching strategy, considerations
- **Dependencies:** other modules, shared helpers, services, APIs, external integrations
- **Edge Cases:** known edge cases, special scenarios
- **Design Decisions:** why important decisions were made; trade-offs
- **Technical Notes:** implementation details future developers should know
- **Known Bugs:** unresolved issues
- **Resolved Bugs:** history of fixed issues
- **Pending Improvements:** future enhancement ideas
- **Change History:** chronological; date, version (if available), summary

## Code Quality

### Readability Over Optimization

- No clever/compact code that hurts readability.
- Optimize only for a proven performance problem, never prematurely.
- Higher priority than performance: clear comments, step-by-step logic, readable Query Builder code, easy debugging, easy modification.

### Step-by-Step Logic

- Split each business process into small sequential steps, each readable, debuggable and modifiable independently:
  1. Fetch required data.
  2. Fetch related data.
  3. Apply business logic.
  4. Save/update records.
- Don't merge DB operations into one complex query to optimize. Extra queries are fine; easy debugging matters more.

### Comments

- Comment every important line: what it does, why it exists, why this approach, which business requirement it serves, assumptions/edge cases. Code must be understandable without reverse engineering or external docs.
- Every function starts with a doc block, so a developer understands the function without reading its body:
  - Description and purpose
  - Input
  - Output
  - Use case
  - `Author: Mr. Sachin Sharma` on new functions. Never change or remove an existing author name.
  - Created date
  - Last modified date

### Reuse, Don't Duplicate

- Before writing business logic, search for an existing helper. If one fits, reuse it.
- If none exists and the logic is reusable, create a generic helper (e.g. active user/complex/district/status lists, common dropdown data, frequently reused queries).
- Never copy-paste logic across controllers, services, views or JS files; put it in a reusable helper, service or function.

### Formatting (strict)

- Follow the existing project style: consistent indentation, spacing, alignment and structure in all new and modified code.
- In grouped assignments, vertically align `=` in one column. No random, excessive or inconsistent spacing.

## Data Handling

- **Server-side tables:** Pagination, search and filters (date, status, category, user, district, etc.) run at the database query level so pages stay fast as data grows. Never load full datasets to the frontend to page, search or filter.
- **Transactions:** Run dependent multi-step DB operations in one transaction. Roll back everything if any step fails; commit only when all succeed.
- **Duplicates:** Before every insert and update, check it won't create a duplicate record. Also add DB-level UNIQUE constraints to prevent race conditions.

## Validation

### Backend

- Never rely on frontend validation; validate every important input on the server.
- Show each backend validation error directly below its field (e.g. username error under Username).

### Frontend

- Validate every field by data type and business rules; block invalid input before the request is sent.
- **Names:** Only letters, spaces and required special characters. No numbers or invalid characters unless the business requires them.
- **Mobile:** Valid format only; Indian numbers exactly 10 digits. Block letters, spaces and unneeded special characters.
- **Length:** Enforce min/max length per business rules (e.g. username 3–50 chars, PIN 6 digits).
- **Date of birth:** Age 18–100 only, enforced with dynamic `min`/`max` on the datepicker so invalid dates can't be selected.
- **Date ranges:** To Date must not be before From Date unless the business explicitly allows it.
- **Files:** Validate allowed extensions and MIME types (e.g. no JPG/EXE/ZIP in a PDF field).
- **Whitespace:** Trim fields where leading/trailing spaces are meaningless (username, email, mobile, codes, etc.). Required text fields must reject whitespace-only input.
- **Real-time:** Validate important fields while typing or on blur, not only on submit.
- **On failure:** Scroll to the first invalid field, bring it into view and focus it where appropriate (especially in long/multi-section forms).
- **Boundary cases:** Handle min, max, empty, too long, invalid format, special characters, spaces, pasted and unexpected values.

## UI/UX

**Applies everywhere:** Every UI rule below applies consistently to all applicable modules, pages, forms, tables, lists, detail views, dialogs, popups, dropdowns, menus, charts, dashboards, widgets, reports, settings/configuration screens and upload results — never restricted to a specific module or page. Implement each shared behavior as a reusable component or shared solution; never create separate, inconsistent per-module implementations.

### Shadcn UI & Theme

- **Shadcn UI only:** Use Shadcn UI components throughout the dashboard and leverage their built-in features wherever possible. Don't create custom Tailwind CSS components when an appropriate Shadcn UI component is available.
- **Other UI libraries:** Reuse existing ones (SweetAlert2, Toaster, Datepicker, etc.); don't add or mix libraries unnecessarily. Never use JS `alert()`/`confirm()`.
- **Default theme:** Shadcn's official black-and-white, neutral appearance, matching its standard light theme.
- **Appearance customization:** Users must be able to change their dashboard appearance through the Appearance settings in their own panel.
- **Theme compatibility (strict):** Every component (forms, tables, dialogs, popups, dropdowns, menus, charts, dashboard pages, etc.) must fully support Light Mode, Dark Mode and user-selected appearance themes without visual inconsistencies or broken functionality. Never hardcode colors or create components that bypass the theme system.
- **Assets:** Prefer local libraries/assets over CDN so the app works offline. If the project already uses a CDN, keep it unless there's a specific reason to change.

### General Behavior

- **Empty states:** Never show only plain text like "No records found". Show an illustration (PNG/SVG or the project's existing empty-state asset), a short heading, a concise description and, if relevant, an action button ("Add New", "Create Record", "Clear Filters", "Get Started"). Applies to pages, tables, lists, dashboards, search results, sections and any other component. Keep it clean, responsive, reusable and consistent with the project UI.
- **Loading states:** Every async operation shows a spinner, skeleton, loading text or disabled state as fits the context. Buttons, tables, dropdowns, modals and pages must not appear blank.
- **Dependent fields (AJAX):** While loading, show a small "Loading..." indicator and keep the field disabled. When done, remove the loader and enable the field with fresh data. Apply to all such fields.
- **Submit buttons:** While submitting, block repeat clicks/duplicate requests and change the text by form type ("Submitting...", "Please wait...", "Loading...", "Searching...").
- **Confirm risky actions:** Every destructive, irreversible or risky action (not only Delete) needs a short, clear confirmation dialog first.
- **Preserve input/state:** Don't unnecessarily clear entered or selected values after validation/API errors, refreshes, filter/search or other UI events. Keep applied filters selected after results load; store them in the URL where appropriate. Prefill Edit forms with saved values.
- **No full page reloads:** CRUD, filters, search, pagination and other interactions update only the required UI/data where appropriate.

### Forms

- **Required fields:** Red asterisk (\*) next to every required field label. Without a label, indicate it via placeholder or another clear method.
- **Searchable selects:** Almost all select/dropdown fields must include a search input so users can quickly find and select options. Exclude search only where it is unnecessary or impractical.
- **Category-wise organization:** Group all form fields by purpose into appropriate categories, each a section in the secondary menu. Personal details (name, title, full name, profile, etc.) go under _Personal Information_, bank-related fields under _Bank Information_, and similarly for other categories. Never mix unrelated fields in the same category.
- **Image upload preview:** For every image upload field (profile and others), show a small preview near the field as soon as an image is chosen, before submitting, matching the project theme.

### Secondary Menu Navigation (mandatory)

- **When required:** Every module with a long form, create/edit page, settings page, or any page with multiple sections must use a secondary menu to navigate between its sections. Never omit it from an applicable page.
- **Context-aware:** Dynamically show only the sections relevant to the currently opened page.
- **Click-to-scroll:** Clicking a menu item smoothly scrolls the main content to that section and positions its heading correctly within the visible area.
- **Bidirectional sync:** While the user manually scrolls up or down, the menu automatically highlights the section currently visible. Menu clicks and manual scrolling stay synchronized at all times; the active item always accurately reflects the current section.
- **Dynamic sections:** Automatically support all relevant sections, including ones added, removed, expanded or collapsed, without breaking navigation or active-section detection.
- **Sticky, never obscuring:** Keep the menu accessible while the main content scrolls, properly positioned without overlapping the primary navigation, page header or content. It must never obscure form fields, section headings, validation messages or other content.
- **Layout:** Clean, minimal, premium UI with proper spacing, alignment and responsive behavior.

### Sensitive Information & Password Fields (mandatory)

- **Masked by default:** Never display sensitive or security-related information in plain text by default anywhere in the UI. This includes, but is not limited to: usernames, email addresses, phone numbers, passwords, OTPs, authentication tokens, API keys, database names, database usernames, database passwords, connection strings, secret keys and any other confidential or security-related information.
- **Eye toggle:** Every field or display element containing sensitive information has an eye-shaped SVG button. Clicking it reveals the value; clicking again immediately masks it.
- **Password inputs:** Every password field (including confirmation) has the eye icon at the end to show/hide. Toggling never clears or changes the value; the icon stays aligned and accessible on all screen sizes.
- **No side effects:** Masking and visibility toggling must not interfere with existing functionality, form submissions, data processing or validation.

### Count Transparency & Details Popup (mandatory)

- **Clickable counts:** Every count, calculation, total, statistic or calculated value displayed anywhere (modules, dashboards, widgets, reports, tables, charts, upload results) must be clickable and open a clear, user-friendly details popup. Never display one without access to its supporting details.
- **Exact records:** The popup shows the exact records contributing to the value. E.g. after an Excel upload, clicking "10 Successful" shows those 10 records and "5 Failed" shows those 5 records.
- **Explain calculations:** For user counts, domain counts, widget statistics and other calculated values, clearly show which records are included and how the value was calculated, in a well-organized, easy-to-understand format so users can independently verify its accuracy.

## Errors & Logging

- Never show raw PHP, SQL, database or server errors to users. Show a friendly message; log technical details on the server.
- Log all important events: successes, errors, unexpected exceptions, warnings, crashes.
- Logger choice, in order: existing project logging helper (if actively used) → framework's built-in logger → new reusable logging helper, used consistently project-wide.

## Auth

- After logout, the Back button must not show protected pages: invalidate the session, require auth on protected pages, and redirect to Login instead of showing cached dashboard content.

## STRICT: Multi-Tenant Isolation, Hierarchy and Authorization

**NON-NEGOTIABLE:** No Tenant, Sub-Tenant, Customer or Sub-Customer may access data outside its explicitly authorized hierarchy. Only the Platform Owner may perform authorized cross-tenant administrative operations. Enforce every rule on the backend; never assume the frontend provides security.

### 1. Absolute Tenant Isolation

- Every Tenant must be **100% isolated** from every other Tenant. No Tenant or Sub-Tenant may view, modify, delete or otherwise access another Tenant's data under any circumstances (ABC Tenant never accesses XYZ Tenant's data, and vice versa).

### 2. Strict User Hierarchy

Hierarchy: **Platform Owner → Tenant → Sub-Tenant / Customer → Sub-Customer**. Sub-Tenants and Customers are separate branches under their owning Tenant.

- **Tenant:** accesses and manages only its own data, Sub-Tenants, Customers and those Customers' Sub-Customers.
- **Sub-Tenant:** only its own authorized data and the permissions explicitly granted by its parent Tenant.
- **Customer:** only its own data and its own Sub-Customers' data; never another Customer's data or another Customer's Sub-Customers.
- **Sub-Customer:** never another Sub-Customer's or Customer's data, or any Tenant or Platform Owner restricted data.
- **Sub-Platform Owner:** only the Platform Owner modules and data permitted by its assigned role.

### 3. Platform Owner Administrative Access

- The Platform Owner can view and manage all Tenants and their authorized data from the Platform Owner panel without logging into individual Tenant accounts.
- The Platform Owner can perform operations on behalf of a selected Tenant, including creating and managing that Tenant's Customers and Sub-Customers, wherever the Platform Owner's authorized capabilities permit.
- Platform Owner cross-tenant access must be explicitly authorized, securely scoped to the selected Tenant, and audited.
- Platform Owner administrative access must never grant Tenants access to one another's data or bypass the isolation of Customer and Sub-Customer data.

### 4. Strict Role and Privilege Isolation

- Platform Owner, Sub-Platform Owner, Tenant, Sub-Tenant, Customer and Sub-Customer access must each follow their own authorization boundaries.
- Each user can have **exactly one assigned role**. Multiple roles and permission merging are prohibited.
- Every role must contain only permissions belonging to its authorized panel and delegation scope.
- Master Platform, Master Tenant and Master Customer roles must remain strictly isolated. Each master role grants access only to its own panel's authorized capabilities, never another panel's permissions.
- Administrators can assign only privileges they are authorized to delegate. Never allow privilege escalation through role creation, role editing, user creation or manipulated requests.

### 5. Backend Enforcement and Immediate Revocation

- Enforce authentication, current permissions, account status, resource ownership, hierarchy and tenant isolation on the backend for **every request, protected operation and database operation**. Hiding menus or buttons is never sufficient.
- Never trust client-supplied tenant IDs, user-supplied roles or ownership identifiers, client-side checks, or stale session permissions.
- If a privilege is removed, disabled or revoked, access must stop immediately after the change is committed. Do not rely on logout, browser refresh or session expiration.
- Permission changes, role changes, account suspension and disabled modules must invalidate or update all relevant authorization caches and active-session permission state.

### 6. Security, Data Integrity, and Testing

- Apply tenant and customer ownership filters to every relevant database query, API, server action, file access, export, download and background operation.
- Prevent cross-tenant and cross-customer IDOR, unauthorized data leakage, privilege escalation, and access through direct URLs or manually constructed requests.
- Preserve existing functionality while migrating all existing dynamic modules and actions into the centralized authorization system.
- Log sensitive administrative actions and role/permission changes without exposing passwords, secrets or credentials.
- Add automated negative tests proving that cross-tenant access, cross-customer access, unauthorized role assignment and revoked permissions are rejected.
