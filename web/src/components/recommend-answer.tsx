"use client";

import { PhoneCall, TriangleAlert } from "lucide-react";

import { ApiUnreachable } from "@/components/api-unreachable";
import { Disclaimer, EvidenceNote } from "@/components/disclaimer";
import { OptionCard } from "@/components/option-card";
import { WarningGraph } from "@/components/warning-graph";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import type { ApiError } from "@/lib/api";
import { OPTION_ORDER_NOTE, markedOptionsFor } from "@/lib/options";
import { percent } from "@/lib/text";
import type { RecommendResponse, SupportedCondition } from "@/lib/types";

/**
 * Everything /recommend can answer with, as components.
 *
 * Kept apart from the form so that each state can be rendered on its own: the
 * honesty tests mount this with every captured response and scan the text that
 * comes out, which is the only way to check what a reader actually sees rather
 * than what the API sent.
 */
export function AnswerSkeleton() {
  return (
    <div className="flex flex-col gap-6" data-testid="ask-loading">
      <Skeleton className="h-7 w-56" />
      <div className="grid gap-4 lg:grid-cols-2">
        {[0, 1, 2, 3].map((index) => (
          <Skeleton key={index} className="h-64 w-full" />
        ))}
      </div>
      <Skeleton className="h-40 w-full" />
    </div>
  );
}

export function RequestFailure({
  error,
  onPickCondition,
}: {
  error: ApiError;
  onPickCondition: (id: string) => void;
}) {
  // An unknown condition id comes back with the supported list attached, so the
  // reader can recover without a second round trip.
  const offered = error.body?.supported_conditions;
  if (offered?.length) {
    return (
      <div role="alert" className="card-surface p-5">
        <h2 className="text-lg">That condition is not one of these</h2>
        <p className="mt-2 text-sm text-[var(--color-ink-2)]">{error.message}</p>
        <ConditionChips conditions={offered} onPick={onPickCondition} />
      </div>
    );
  }
  return <ApiUnreachable error={error} what="the options" />;
}

export function Answer({
  response,
  fallbackConditions,
  conditionsNote,
  onPickCondition,
}: {
  response: RecommendResponse;
  fallbackConditions: SupportedCondition[];
  conditionsNote: string;
  onPickCondition: (id: string) => void;
}) {
  if (response.status === "emergency") {
    return <Emergency response={response} />;
  }

  if (response.status === "out_of_scope" || response.status === "low_confidence") {
    return (
      <NoMatch
        response={response}
        fallbackConditions={fallbackConditions}
        conditionsNote={conditionsNote}
        onPickCondition={onPickCondition}
      />
    );
  }

  return <Results response={response} />;
}

/**
 * The emergency panel.
 *
 * The API's own message, red-flag labels and actions, and a tel: link big
 * enough to use in a hurry. No options, no search box and nothing else to read:
 * the backend returned none, and this page offers none.
 */
export function Emergency({ response }: { response: RecommendResponse }) {
  return (
    <section
      role="alert"
      data-testid="emergency"
      className="animate-reveal rounded-[var(--radius-panel)] border-2 border-[var(--color-verified)] bg-[var(--color-verified)]/8 p-5 sm:p-8"
    >
      <div className="flex items-center gap-2.5 text-[var(--color-verified)]">
        <TriangleAlert className="size-6 shrink-0" aria-hidden="true" />
        <h2 className="text-2xl">Get medical help now</h2>
      </div>

      <p className="mt-4 text-lg">{response.message}</p>

      {response.red_flags?.length ? (
        <ul className="mt-5 flex flex-col gap-3">
          {response.red_flags.map((flag) => (
            <li key={flag.category} data-testid="red-flag">
              <Badge tone="verified">{flag.label}</Badge>
              <p className="mt-1.5">{flag.message}</p>
            </li>
          ))}
        </ul>
      ) : null}

      <a
        href="tel:112"
        data-testid="call-112"
        className="mt-7 flex items-center justify-center gap-3 rounded-[var(--radius-card)] bg-[var(--color-verified)] px-6 py-5 font-[family-name:var(--font-heading)] text-2xl font-semibold text-white dark:text-[var(--color-paper)]"
      >
        <PhoneCall className="size-6" aria-hidden="true" />
        Call 112
      </a>

      {response.actions?.length ? (
        <ul className="mt-5 flex list-inside list-disc flex-col gap-2">
          {response.actions.map((action) => (
            <li key={action}>{action}</li>
          ))}
        </ul>
      ) : null}

      <div className="mt-6">
        <Disclaimer text={response.disclaimer} />
      </div>
    </section>
  );
}

export function NoMatch({
  response,
  fallbackConditions,
  conditionsNote,
  onPickCondition,
}: {
  response: RecommendResponse;
  fallbackConditions: SupportedCondition[];
  conditionsNote: string;
  onPickCondition: (id: string) => void;
}) {
  const conditions = response.supported_conditions ?? fallbackConditions;
  const lowConfidence = response.status === "low_confidence";

  return (
    <section
      className="panel animate-reveal p-5 sm:p-7"
      data-testid={lowConfidence ? "low-confidence" : "out-of-scope"}
    >
      <h2 className="text-2xl">
        {lowConfidence
          ? "That could not be matched confidently"
          : "That is outside what this database covers"}
      </h2>
      {response.note ? (
        <p className="mt-3 text-[var(--color-ink-2)]">{response.note}</p>
      ) : null}

      <h3 className="mt-6 text-lg">Conditions this database covers</h3>
      <p className="mt-1 text-sm text-[var(--color-ink-2)]">{conditionsNote}</p>
      <ConditionChips conditions={conditions} onPick={onPickCondition} />

      <div className="mt-6">
        <Disclaimer text={response.disclaimer} />
      </div>
    </section>
  );
}

export function ConditionChips({
  conditions,
  onPick,
}: {
  conditions: SupportedCondition[];
  onPick: (id: string) => void;
}) {
  return (
    <ul className="mt-4 flex flex-wrap gap-2">
      {conditions.map((condition) => (
        <li key={condition.condition_id}>
          <button
            type="button"
            onClick={() => onPick(condition.condition_id)}
            data-testid="condition-chip"
            data-condition-id={condition.condition_id}
            className="rounded-full border border-[var(--color-line)] bg-[var(--color-surface)] px-4 py-2 text-sm font-semibold transition-colors hover:border-[var(--color-herb)] hover:bg-[var(--color-wash)]"
          >
            {condition.name}
          </button>
        </li>
      ))}
    </ul>
  );
}

export function Results({ response }: { response: RecommendResponse }) {
  const { ayurvedic, allopathic } = markedOptionsFor(response);
  const classifierDetected = response.detected_conditions.some(
    (condition) => condition.source === "classifier",
  );

  return (
    <div className="animate-reveal flex flex-col gap-8" data-testid="results">
      <section className="panel p-5 sm:p-7">
        <h2 className="text-xl">We read this as</h2>
        <ul className="mt-3 flex flex-wrap gap-2" data-testid="detected-conditions">
          {response.detected_conditions.map((condition) => (
            <li key={condition.condition_id}>
              <Badge tone="herb" className="px-3 py-1 text-sm">
                {condition.name}
                <span className="font-normal text-[var(--color-ink-2)]">
                  {condition.source === "classifier"
                    ? ` ${percent(condition.confidence)} confidence`
                    : " you chose this"}
                </span>
              </Badge>
            </li>
          ))}
        </ul>

        {classifierDetected ? (
          <p className="mt-4 text-sm text-[var(--color-ink-2)]" data-testid="classifier-note">
            Conditions were identified by a classifier trained on written-out phrasings
            rather than on anything a real person typed, so check them before relying on
            what is below.
          </p>
        ) : null}

        {response.caution_notes.length > 0 ? (
          <ul className="mt-4 flex flex-col gap-2.5" data-testid="caution-notes">
            {response.caution_notes.map((caution) => (
              <li
                key={caution}
                className="rounded-[var(--radius-card-sm)] border border-[var(--color-mechanism)]/35 bg-[var(--color-mechanism)]/8 p-3 text-sm"
              >
                {caution}
              </li>
            ))}
          </ul>
        ) : null}

        {response.current_medicines ? (
          <CurrentMedicinesReadback response={response} />
        ) : null}
      </section>

      <section>
        <div className="flex flex-wrap items-baseline gap-x-3">
          <h2 className="text-2xl">Options</h2>
          <p className="text-sm text-[var(--color-ink-2)]">{OPTION_ORDER_NOTE}</p>
        </div>

        <div className="mt-5 grid gap-8 lg:grid-cols-2">
          <OptionColumn
            title="Ayurvedic options"
            accent="herb"
            options={ayurvedic}
            empty="No herb in this database is recorded for what was detected."
          />
          <OptionColumn
            title="Allopathic options"
            accent="drug"
            options={allopathic}
            empty="No drug in this database is recorded for what was detected."
          />
        </div>
      </section>

      <WarningGraph response={response} />

      {response.evidence_note ? <EvidenceNote text={response.evidence_note} /> : null}
      <Disclaimer text={response.disclaimer} />
    </div>
  );
}

export function OptionColumn({
  title,
  accent,
  options,
  empty,
}: {
  title: string;
  accent: "herb" | "drug";
  options: ReturnType<typeof markedOptionsFor>["ayurvedic"];
  empty: string;
}) {
  return (
    <div data-testid={`options-${accent}`}>
      <h3
        className="font-[family-name:var(--font-heading)] text-xl font-semibold"
        style={{ color: `var(--color-${accent})` }}
      >
        {title}
      </h3>
      {options.length === 0 ? (
        <p className="mt-3 rounded-[var(--radius-card-sm)] border border-dashed border-[var(--color-line)] p-4 text-sm text-[var(--color-ink-2)]">
          {empty}
        </p>
      ) : (
        <ul className="mt-3 flex flex-col gap-4">
          {options.map((marked) => (
            <li key={`${marked.option.medicine_id}-${marked.option.condition_id}`}>
              <OptionCard marked={marked} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * What the backend made of the medicines the reader named.
 *
 * Printed in full because it is the only place a reader can see that "Glycomet"
 * was understood as the medicine it is, that "blood thinner" was taken as a
 * whole class, or that something they typed was not recognised at all and so
 * was not checked.
 */
export function CurrentMedicinesReadback({ response }: { response: RecommendResponse }) {
  const current = response.current_medicines;
  if (!current) return null;
  const anything =
    current.resolved.length +
    current.drug_classes.length +
    current.unresolved.length +
    current.ambiguous.length;
  if (anything === 0) return null;

  return (
    <div className="mt-5 border-t border-[var(--color-line)] pt-4" data-testid="current-readback">
      <h3 className="text-sm font-semibold text-[var(--color-ink-2)]">
        What you said you take
      </h3>
      <ul className="mt-2 flex flex-col gap-1.5 text-sm">
        {current.resolved.map((item) => (
          <li key={item.medicine_id}>
            {item.query.toLowerCase() === item.name.toLowerCase()
              ? item.name
              : `${item.query} — read as ${item.name}`}
          </li>
        ))}
        {current.drug_classes.map((item) => (
          <li key={item.drug_class}>
            {item.query} — read as a whole group: {item.drug_class} (
            {item.members.join(", ")})
          </li>
        ))}
        {current.ambiguous.map((item) => (
          <li key={item.query} className="text-[var(--color-mechanism)]">
            {item.query} — matches more than one medicine, so it was not checked
          </li>
        ))}
        {current.unresolved.map((item) => (
          <li key={item} className="text-[var(--color-insufficient)]">
            {item} — not a name this database holds, so it was not checked
          </li>
        ))}
      </ul>
    </div>
  );
}
