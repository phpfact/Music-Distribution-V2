import { checkMasterPassword } from "@/lib/tenants/rules";
import { Icon } from "../../_components/icons";

type PasswordChecklistProps = {
  /**
   * Referenced by the password input's aria-describedby.
   */
  id: string;
  password: string;
  username: string;
};

/**
 * Description: Show the master password policy (§4) as a live checklist.
 * Input: The list's id (for aria-describedby), the password and the username.
 * Output: Each requirement marked met or not (from the server's own rule) and a
 *   polite announcement once something is typed.
 * Use case: Master password fields (create Manual login, Reset master password).
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-14
 * Last modified: 2026-10-15
 */
export function PasswordChecklist({
  id,
  password,
  username,
}: PasswordChecklistProps) {
  const { valid, requirements } = checkMasterPassword(password, username);
  const met = requirements.filter((requirement) => requirement.met).length;

  return (
    <div className="flex flex-col gap-1">
      <ul id={id} className="flex flex-col gap-1">
        {requirements.map((requirement) => (
          <li
            key={requirement.id}
            className={`flex items-start gap-2 text-xs ${
              requirement.met ? "text-success" : "text-fg-muted"
            }`}
          >
            <Icon
              name={requirement.met ? "circle-check" : "circle"}
              className="mt-px size-3.5 shrink-0"
            />
            <span className="min-w-0">
              <span className="sr-only">
                {requirement.met ? "Met: " : "Not met: "}
              </span>
              {requirement.label}
            </span>
          </li>
        ))}
      </ul>
      {/* Announced as the password changes; silent until something is typed. */}
      <p aria-live="polite" className="sr-only">
        {password === ""
          ? ""
          : valid
            ? "The password meets every requirement."
            : `${met} of ${requirements.length} password requirements met.`}
      </p>
    </div>
  );
}
