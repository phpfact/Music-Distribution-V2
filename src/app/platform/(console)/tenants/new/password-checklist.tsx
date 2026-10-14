import { checkMasterPassword } from "@/lib/tenants/rules";
import { Icon } from "../../_components/icons";

type PasswordChecklistProps = {
  /** Referenced by the password input's aria-describedby. */
  id: string;
  password: string;
  username: string;
};

/** The master password policy (§4) as a live checklist, from the server's own rule. */
export function PasswordChecklist({ id, password, username }: PasswordChecklistProps) {
  const { valid, requirements } = checkMasterPassword(password, username);
  const met = requirements.filter((requirement) => requirement.met).length;

  return (
    <div className="flex flex-col gap-1">
      <ul id={id} className="flex flex-col gap-1">
        {requirements.map((requirement) => (
          <li
            key={requirement.id}
            className={`flex items-start gap-2 text-xs ${
              requirement.met ? "text-emerald-700 dark:text-emerald-300" : "text-fg-muted"
            }`}
          >
            <Icon
              name={requirement.met ? "circle-check" : "circle"}
              className="mt-px size-3.5 shrink-0"
            />
            <span className="min-w-0">
              <span className="sr-only">{requirement.met ? "Met: " : "Not met: "}</span>
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
