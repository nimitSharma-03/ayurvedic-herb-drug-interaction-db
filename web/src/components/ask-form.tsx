"use client";

import * as React from "react";
import { Loader2 } from "lucide-react";

import { MedicineTokenInput } from "@/components/medicine-token-input";
import { Answer, AnswerSkeleton, RequestFailure } from "@/components/recommend-answer";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { ApiError } from "@/lib/api";
import { api, asApiError } from "@/lib/api";
import type {
  CautionFlags,
  RecommendResponse,
  SupportedCondition,
} from "@/lib/types";

const MAX_TEXT = 500;

const CAUTIONS: { key: keyof CautionFlags; label: string }[] = [
  { key: "pregnant_or_breastfeeding", label: "Pregnant or breastfeeding" },
  { key: "under_18", label: "Under 18" },
  { key: "kidney_or_liver_disease", label: "Kidney or liver disease" },
];

/**
 * The /recommend form and every state its answer can be in.
 *
 * The four statuses are handled separately because they mean different things.
 * `emergency` shows the red panel and no options at all -- the backend screens
 * for red flags before it classifies anything or reads the database, and this
 * page must not undo that by offering a herb beside the referral.
 * `out_of_scope` and `low_confidence` both offer the supported conditions as
 * chips, and choosing one re-runs the request with `condition_ids`, which skips
 * the classifier rather than the safety check.
 */
export function AskForm({
  supportedConditions,
  note,
}: {
  supportedConditions: SupportedCondition[];
  note: string;
}) {
  const [text, setText] = React.useState("");
  const [current, setCurrent] = React.useState<string[]>([]);
  const [cautions, setCautions] = React.useState<CautionFlags>({
    pregnant_or_breastfeeding: false,
    under_18: false,
    kidney_or_liver_disease: false,
  });
  const [pending, setPending] = React.useState(false);
  const [answer, setAnswer] = React.useState<RecommendResponse | null>(null);
  const [failure, setFailure] = React.useState<ApiError | null>(null);
  const textId = React.useId();
  const counterId = `${textId}-count`;

  async function run(conditionIds?: string[]) {
    const trimmed = text.trim();
    if (!trimmed && !conditionIds?.length) return;

    setPending(true);
    setFailure(null);
    try {
      const response = await api.recommend({
        ...(trimmed ? { text: trimmed } : {}),
        ...(current.length ? { current_medicines: current } : {}),
        cautions,
        ...(conditionIds?.length ? { condition_ids: conditionIds } : {}),
      });
      setAnswer(response);
    } catch (error) {
      setAnswer(null);
      setFailure(asApiError(error));
    } finally {
      setPending(false);
    }
  }

  const remaining = MAX_TEXT - text.length;

  return (
    <div className="mt-8 flex flex-col gap-8">
      <form
        className="panel flex flex-col gap-6 p-5 sm:p-7"
        onSubmit={(event) => {
          event.preventDefault();
          void run();
        }}
      >
        <div>
          <Label htmlFor={textId}>What is the problem?</Label>
          <Textarea
            id={textId}
            value={text}
            maxLength={MAX_TEXT}
            aria-describedby={counterId}
            onChange={(event) => setText(event.target.value.slice(0, MAX_TEXT))}
            placeholder="For example: my sugar is high and I feel thirsty all the time"
            data-testid="problem-text"
            className="mt-1.5"
          />
          <p
            id={counterId}
            aria-live="polite"
            className="mt-1.5 text-right text-sm text-[var(--color-ink-2)]"
          >
            {text.length} of {MAX_TEXT} characters
            {remaining <= 50 ? ` · ${remaining} left` : ""}
          </p>
        </div>

        <MedicineTokenInput
          label="Medicines or herbs you already take"
          description="Any name works, including what is printed on the strip. The answer says what it understood."
          values={current}
          onChange={setCurrent}
        />

        <fieldset>
          <legend className="text-sm font-semibold">Anything that applies</legend>
          <p className="mt-1 mb-3 text-sm text-[var(--color-ink-2)]">
            These only add notes. Nothing is removed from the answer on their account,
            because deciding a herb is unsuitable is a clinical judgement this database
            has no sourced basis for.
          </p>
          <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:gap-x-8">
            {CAUTIONS.map((caution) => (
              <div key={caution.key} className="flex items-center gap-2.5">
                <Checkbox
                  id={caution.key}
                  checked={cautions[caution.key]}
                  onCheckedChange={(checked) =>
                    setCautions((previous) => ({
                      ...previous,
                      [caution.key]: checked === true,
                    }))
                  }
                  data-testid={`caution-${caution.key}`}
                />
                <Label htmlFor={caution.key} className="font-normal">
                  {caution.label}
                </Label>
              </div>
            ))}
          </div>
        </fieldset>

        <div>
          <Button type="submit" size="lg" disabled={pending || text.trim().length === 0}>
            {pending ? (
              <>
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                Looking it up
              </>
            ) : (
              "Show options"
            )}
          </Button>
        </div>
      </form>

      <div aria-live="polite" aria-busy={pending}>
        {pending ? <AnswerSkeleton /> : null}

        {!pending && failure ? (
          <RequestFailure
            error={failure}
            onPickCondition={(id) => void run([id])}
          />
        ) : null}

        {!pending && answer ? (
          <Answer
            response={answer}
            fallbackConditions={supportedConditions}
            conditionsNote={note}
            onPickCondition={(id) => void run([id])}
          />
        ) : null}
      </div>
    </div>
  );
}
