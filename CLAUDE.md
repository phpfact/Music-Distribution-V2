# Coding Rules

Goal: simple, well-structured, heavily commented, production-quality code that is easy to read, debug and maintain, and consistent across the project. Write for a future developer with no project knowledge. Readability > performance.

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
- Every function starts with a doc block:
  - Description and purpose
  - Input
  - Output
  - Use case
  - `Author: Mr. Sachin Sharma` on new functions. Never change or remove an existing author name.
  - Created date
  - Last modified date
- A developer should understand the function without reading its body.

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
- **Length:** Enforce min/max length per business rules (e.g. username 3–50 chars, PIN 6 digits, mobile 10 digits).
- **Date of birth:** Age 18–100 only, enforced with dynamic `min`/`max` on the datepicker so invalid dates can't be selected.
- **Date ranges:** To Date must not be before From Date unless the business explicitly allows it.
- **Files:** Validate allowed extensions and MIME types (e.g. no JPG/EXE/ZIP in a PDF field).
- **Whitespace:** Trim fields where leading/trailing spaces are meaningless (username, email, mobile, codes, etc.). Required text fields must reject whitespace-only input.
- **Real-time:** Validate important fields while typing or on blur, not only on submit.
- **On failure:** Scroll to the first invalid field, bring it into view and focus it where appropriate (especially in long/multi-section forms).
- **Boundary cases:** Handle min, max, empty, too long, invalid format, special characters, spaces, pasted and unexpected values.

## UI/UX

- **Empty states:** Never show only plain text like "No records found". Show an illustration (PNG/SVG or the project's existing empty-state asset), a short heading, a concise description and, if relevant, an action button ("Add New", "Create Record", "Clear Filters", "Get Started"). Applies to pages, tables, lists, dashboards, search results, sections and any other component. Keep it clean, responsive, reusable and consistent with the project UI.
- **Loading states:** Every async operation shows a spinner, skeleton, loading text or disabled state as fits the context. Buttons, tables, dropdowns, modals and pages must not appear blank.
- **Dependent fields (AJAX):** While loading, show a small "Loading..." indicator and keep the field disabled. When done, remove the loader and enable the field with fresh data. Apply to all such fields.
- **Submit buttons:** While submitting, block repeat clicks/duplicate requests and change the text by form type ("Submitting...", "Please wait...", "Loading...", "Searching...").
- **Confirm risky actions:** Every destructive, irreversible or risky action (not only Delete) needs a short, clear confirmation dialog first.
- **Preserve input/state:** Don't unnecessarily clear entered or selected values after validation/API errors, refreshes, filter/search or other UI events. Keep applied filters selected after results load; store them in the URL where appropriate. Prefill Edit forms with saved values.
- **No full page reloads:** CRUD, filters, search, pagination and other interactions update only the required UI/data where appropriate.
- **Password fields:** Every password field (including confirmation) has an eye icon at the end to show/hide. Toggling never clears or changes the value; it stays aligned and accessible on all screen sizes.
- **Required fields:** Red asterisk (\*) on the label. Without a label, indicate it via placeholder or another clear method.
- **Image upload preview:** For every image upload field (profile and others), show a small preview near the field as soon as an image is chosen, before submitting, matching the project theme.
- **UI libraries:** Reuse existing ones (SweetAlert2, Toaster, Datepicker, etc.); don't add or mix libraries unnecessarily. Never use JS `alert()`/`confirm()`.
- **Assets:** Prefer local libraries/assets over CDN so the app works offline. If the project already uses a CDN, keep it unless there's a specific reason to change.

## Errors & Logging

- Never show raw PHP, SQL, database or server errors to users. Show a friendly message; log technical details on the server.
- Log all important events: successes, errors, unexpected exceptions, warnings, crashes.
- Logger choice, in order: existing project logging helper (if actively used) → framework's built-in logger → new reusable logging helper, used consistently project-wide.

## Auth

- After logout, the Back button must not show protected pages: invalidate the session, require auth on protected pages, and redirect to Login instead of showing cached dashboard content.

## Module Memory (`.vibe/memory/`)

Every module has exactly one markdown memory file in `.vibe/memory/` (lowercase kebab-case, e.g. `user-management.md`, `fresh-case-entry.md`). It is the single source of truth for AI editors and developers: reading only that file, without the source code, anyone should understand what the module does, why it exists, how it works, why decisions were made, what changed and what's planned.

- Never combine modules in one file.
- Use only `.vibe/memory/` for module memory. Don't assume any other directory structure unless I provide it.

### Workflow (never skip)

For any work on a module:

1. Locate its memory file; create it if missing.
2. Update the memory file with the requested changes.
3. Implement the code changes.
4. Ensure code and memory describe the same behavior. Never update one without the other: code changes → update memory; new requirements in memory → update code.

Update memory for every meaningful change: new module/feature, enhancement, flow, bug fix, validation, UI, database, API, business rule, performance, refactoring, security, caching, configuration or dependency change.

Keep the file current with the implementation, but never overwrite important history (significant design decisions, major features, architectural changes).

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

## Before Coding (strict)

### Never assume or guess

If anything is ambiguous, uncertain, missing or doubtful (implementation, business logic, expected behavior, edge cases, requirements):

- Don't write or modify code, assume, guess, or pick an implementation by personal preference.
- Ask me one clear question at a time and wait for my answer. Repeat until everything is clear, then code.

### Understand existing modules first (mandatory)

Before changing an existing module, fully understand it, not just the obvious file:

- Inspect related files, components, controllers, models, services, APIs, DB interactions, routes, validations and logic.
- Understand its data flow, business logic, UI/UX behavior, user flow, and how the change fits the architecture.
- Reuse existing patterns and utilities.

Order: understand requirement → inspect module → understand architecture/behavior → identify changes → resolve ambiguity → implement → verify.

### Protect existing functionality

- Don't break or remove existing behavior unless explicitly requested.
- Don't touch unrelated functionality, refactor unnecessarily, or rewrite/restructure/replace working code.
- Don't change DB structure, APIs, naming conventions or architecture unless the requirement needs it.
- Stay focused on the requested task.
