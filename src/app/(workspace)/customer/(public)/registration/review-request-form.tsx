"use client";

import { CircleAlert, Send } from "lucide-react";
import { useActionState, useId, useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { REVIEW_MESSAGE_MAX_LENGTH, validateReviewMessage } from "@/lib/workspace/rules";
import { requestReviewAction, type ReviewRequestState } from "./actions";

const initialState: ReviewRequestState = { status: "idle" };

/**
 * Description: Let a rejected applicant ask the tenant for a new review.
 * Input: None.
 * Output: An optional message (max 1000 characters, live counter and
 *   validation) and a "Request review" button that shows "Sending…" and blocks
 *   repeat clicks while pending. The typed message is kept after an error.
 * Use case: /customer/registration while the registration is rejected.
 * Author: Mr. Sachin Sharma
 * Created: 2026-10-16
 * Last modified: 2026-10-16
 */
export function ReviewRequestForm() {
  const [state, formAction, pending] = useActionState(requestReviewAction, initialState);
  const [message, setMessage] = useState("");
  const [clientError, setClientError] = useState<string | null>(null);
  const id      = useId();
  const errorId = `${id}-error`;
  const countId = `${id}-count`;
  const error   = clientError ?? state.fieldError;

  return (
    <form
      action={formAction}
      onSubmit={(event) => {
        // The same rule as the server: block an over-long message before sending.
        const result = validateReviewMessage(message);
        if (!result.ok) {
          event.preventDefault();
          setClientError(result.error);
        }
      }}
      noValidate
      className="flex flex-col gap-3"
    >
      {state.formError ? (
        <Alert variant="destructive">
          <CircleAlert aria-hidden="true" />
          <AlertDescription>{state.formError}</AlertDescription>
        </Alert>
      ) : null}
      <div className="flex flex-col gap-2">
        <Label htmlFor={id}>Message to the reviewer (optional)</Label>
        <Textarea
          id={id}
          name="message"
          rows={4}
          maxLength={REVIEW_MESSAGE_MAX_LENGTH}
          value={message}
          onChange={(event) => {
            setMessage(event.currentTarget.value);
            if (clientError) {
              const result = validateReviewMessage(event.currentTarget.value);
              setClientError(result.ok ? null : result.error);
            }
          }}
          placeholder="Tell the team what has changed or why your account should be reconsidered."
          aria-invalid={error ? true : undefined}
          aria-describedby={[countId, error ? errorId : null].filter(Boolean).join(" ")}
        />
        <p id={countId} className="text-right text-xs text-muted-foreground">
          {message.length} / {REVIEW_MESSAGE_MAX_LENGTH}
        </p>
        {error ? (
          <p id={errorId} className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
      </div>
      <Button type="submit" disabled={pending} aria-busy={pending || undefined} className="self-start">
        {pending ? <Spinner /> : <Send aria-hidden="true" />}
        {pending ? "Sending…" : "Request review"}
      </Button>
    </form>
  );
}
