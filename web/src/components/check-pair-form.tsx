"use client";

import * as React from "react";
import { useSearchParams } from "next/navigation";
import { ArrowLeftRight, Loader2 } from "lucide-react";

import { Disclaimer } from "@/components/disclaimer";
import { InteractionRow } from "@/components/interaction-row";
import { MedicineCombobox } from "@/components/medicine-combobox";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import type { ApiError} from "@/lib/api";
import { api, asApiError } from "@/lib/api";
import { cn } from "@/lib/utils";
import type { InteractionRecord, MedicineNotFoundResponse } from "@/lib/types";

type Answer = InteractionRecord | MedicineNotFoundResponse;

function isNotFound(answer: Answer): answer is MedicineNotFoundResponse {
  return answer.status === "medicine_not_found";
}

/** A pair, in the order the reader asked, so a swap can be recognised. */
interface Asked {
  a: string;
  b: string;
}

function sameAnswer(left: Answer, right: Answer): boolean {
  if (isNotFound(left) || isNotFound(right)) return false;
  return (
    left.status === right.status &&
    left.severity === right.severity &&
    left.evidence_level === right.evidence_level &&
    left.description === right.description
  );
}

/**
 * The pair check.
 *
 * Every state the backend can answer with is rendered, and they are kept
 * distinct: a documented interaction, nothing found in the sources, no adequate
 * basis to answer, the same medicine twice, and a name that is not in scope.
 * The middle one is never worded as safety -- the backend's own description
 * says the literature was searched and nothing was found, and that sentence is
 * shown as it is sent.
 *
 * After a swap the previous answer is compared with the new one, and the page
 * says "Same answer in either order" when they match. The pair key is sorted in
 * the database, so they always should; saying so out loud is how a reader can
 * see that for themselves rather than take it on trust.
 */
export function CheckPairForm() {
  const params = useSearchParams();
  const [a, setA] = React.useState(params.get("a") ?? "");
  const [b, setB] = React.useState(params.get("b") ?? "");
  const [pending, setPending] = React.useState(false);
  const [asked, setAsked] = React.useState<Asked | null>(null);
  const [answer, setAnswer] = React.useState<Answer | null>(null);
  const [failure, setFailure] = React.useState<ApiError | null>(null);
  const [swapMatched, setSwapMatched] = React.useState(false);
  const [rotation, setRotation] = React.useState(0);

  const previous = React.useRef<{ asked: Asked; answer: Answer } | null>(null);

  const identical =
    a.trim().length > 0 && a.trim().toLowerCase() === b.trim().toLowerCase();

  async function run(nextA: string, nextB: string) {
    const left = nextA.trim();
    const right = nextB.trim();
    if (!left || !right) return;

    setPending(true);
    setFailure(null);

    const wasSwapped =
      previous.current !== null &&
      previous.current.asked.a.toLowerCase() === right.toLowerCase() &&
      previous.current.asked.b.toLowerCase() === left.toLowerCase();

    try {
      const result = await api.checkPair({ medicine_a: left, medicine_b: right });
      setAnswer(result);
      setAsked({ a: left, b: right });
      setSwapMatched(
        wasSwapped && previous.current !== null && sameAnswer(previous.current.answer, result),
      );
      previous.current = { asked: { a: left, b: right }, answer: result };
    } catch (error) {
      setAnswer(null);
      setAsked({ a: left, b: right });
      setSwapMatched(false);
      setFailure(asApiError(error));
    } finally {
      setPending(false);
    }
  }

  function swap() {
    setRotation((value) => value + 180);
    const nextA = b;
    const nextB = a;
    setA(nextA);
    setB(nextB);
    if (answer || failure) void run(nextA, nextB);
  }

  return (
    <div className="mt-8">
      <form
        className="panel flex flex-col gap-4 p-5 sm:p-6"
        onSubmit={(event) => {
          event.preventDefault();
          void run(a, b);
        }}
      >
        <div className="grid items-end gap-4 sm:grid-cols-[1fr_auto_1fr]">
          <MedicineCombobox
            label="First medicine"
            value={a}
            onChange={setA}
            testId="pick-a"
          />

          <Button
            type="button"
            variant="secondary"
            size="icon"
            onClick={swap}
            aria-label="Swap the two medicines"
            data-testid="swap"
            className="mb-0.5 justify-self-center"
          >
            <ArrowLeftRight
              className="size-4 transition-transform duration-300"
              style={{ transform: `rotate(${rotation}deg)` }}
              aria-hidden="true"
            />
          </Button>

          <MedicineCombobox
            label="Second medicine"
            value={b}
            onChange={setB}
            testId="pick-b"
          />
        </div>

        {identical ? (
          <p
            role="status"
            data-testid="same-medicine"
            className="rounded-[var(--radius-card-sm)] border border-[var(--color-line)] bg-[var(--color-wash)] p-4 text-sm"
          >
            Those are the same medicine. An interaction needs two different ones.
          </p>
        ) : null}

        <div>
          <Button type="submit" size="lg" disabled={pending || !a.trim() || !b.trim() || identical}>
            {pending ? (
              <>
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                Checking
              </>
            ) : (
              "Check this pair"
            )}
          </Button>
        </div>
      </form>

      <div aria-live="polite" className="mt-6">
        {pending ? (
          <div className="flex flex-col gap-3" data-testid="check-loading">
            <Skeleton className="h-6 w-1/3" />
            <Skeleton className="h-28 w-full" />
          </div>
        ) : null}

        {!pending && failure ? <CheckFailure error={failure} asked={asked} /> : null}

        {!pending && answer && asked ? (
          <div className="animate-reveal flex flex-col gap-4">
            {swapMatched ? (
              <p
                data-testid="same-either-order"
                className="rounded-[var(--radius-card-sm)] border border-[var(--color-line)] bg-[var(--color-wash)] p-3 text-sm font-semibold"
              >
                Same answer in either order.
              </p>
            ) : null}

            {isNotFound(answer) ? (
              <div
                role="alert"
                data-testid="medicine-not-found"
                className="card-surface p-5"
              >
                <h2 className="text-lg">That name is not in this database</h2>
                <p className="mt-2 text-sm text-[var(--color-ink-2)]">
                  {answer.error.message}
                </p>
                <p className="mt-2 text-sm text-[var(--color-ink-2)]">
                  The set of herbs and drugs here is fixed, so a name outside it returns
                  nothing rather than a made-up record.
                </p>
              </div>
            ) : (
              <>
                <h2 className="text-2xl">
                  {asked.a} and {asked.b}
                </h2>
                <InteractionRow record={answer} />
                {answer.status === "insufficient_evidence" ? (
                  <p
                    data-testid="insufficient-reason"
                    className={cn(
                      "rounded-[var(--radius-card-sm)] border p-4 text-sm",
                      "border-[var(--color-insufficient)]/40 bg-[var(--color-insufficient)]/10 text-[var(--color-ink-2)]",
                    )}
                  >
                    {answer.evidence_basis ??
                      "No basis is recorded for why the evidence is insufficient."}
                  </p>
                ) : null}
                <Disclaimer text={answer.disclaimer} />
              </>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}

/**
 * A 400 or 409 from the check.
 *
 * `identical_medicine` is its own state rather than a generic error: two names
 * for one substance is a reasonable thing for a reader to try, and the answer
 * is that an interaction needs two different medicines.
 */
function CheckFailure({ error, asked }: { error: ApiError; asked: Asked | null }) {
  if (error.code === "identical_medicine") {
    return (
      <div role="alert" data-testid="same-medicine-resolved" className="card-surface p-5">
        <h2 className="text-lg">Those are two names for the same medicine</h2>
        <p className="mt-2 text-sm text-[var(--color-ink-2)]">{error.message}</p>
        {asked ? (
          <p className="mt-2 text-sm text-[var(--color-ink-2)]">
            {asked.a} and {asked.b} resolve to one record here.
          </p>
        ) : null}
      </div>
    );
  }

  if (error.code === "ambiguous_medicine") {
    return (
      <div role="alert" data-testid="ambiguous-medicine" className="card-surface p-5">
        <h2 className="text-lg">That name matches more than one medicine</h2>
        <p className="mt-2 text-sm text-[var(--color-ink-2)]">{error.message}</p>
        {error.body?.candidates?.length ? (
          <ul className="mt-3 list-inside list-disc text-sm">
            {error.body.candidates.map((candidate) => (
              <li key={candidate}>{candidate}</li>
            ))}
          </ul>
        ) : null}
      </div>
    );
  }

  return (
    <div role="alert" data-testid="check-error" className="card-surface p-5">
      <h2 className="text-lg">
        {error.isUnreachable ? "The database server is not responding" : "That check did not work"}
      </h2>
      <p className="mt-2 text-sm text-[var(--color-ink-2)]">{error.message}</p>
      {error.isUnreachable ? (
        <p className="mt-2 text-sm text-[var(--color-ink-2)]">
          Start it with{" "}
          <code className="rounded-sm bg-[var(--color-wash)] px-1.5 py-0.5 font-[family-name:var(--font-mono)] text-xs">
            python -m hdi.api
          </code>
          , then try again.
        </p>
      ) : null}
    </div>
  );
}
