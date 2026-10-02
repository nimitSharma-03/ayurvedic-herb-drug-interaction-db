"use client";

import * as React from "react";
import { Loader2, Plus, X } from "lucide-react";

import { useMedicineSearch } from "@/hooks/use-medicine-search";
import { matchedOnLabel } from "@/lib/text";
import { cn } from "@/lib/utils";

/**
 * The "medicines you already take" field.
 *
 * Tokens, with suggestions from the backend's search. Anything typed can be
 * added whether or not it matched a suggestion, because the backend takes names
 * this app does not know about -- a lay class name ("blood thinner") or a brand
 * printed on a strip -- and reports back what it understood. Silently refusing
 * a word the reader is holding in their hand would be worse than passing it on
 * and letting the answer say it was not recognised.
 *
 * Brand names are matched by the backend and never printed by it. The token
 * shows what the reader typed, which is the only place a brand ever appears,
 * and it appears because they wrote it.
 */
export function MedicineTokenInput({
  label,
  description,
  values,
  onChange,
  max = 20,
}: {
  label: string;
  description?: string;
  values: string[];
  onChange: (next: string[]) => void;
  max?: number;
}) {
  const [term, setTerm] = React.useState("");
  const [open, setOpen] = React.useState(false);
  const inputId = React.useId();
  const listId = `${inputId}-suggestions`;
  const { results, loading, empty } = useMedicineSearch(term);

  const full = values.length >= max;

  function add(name: string) {
    const value = name.trim();
    if (!value || full) return;
    if (values.some((existing) => existing.toLowerCase() === value.toLowerCase())) {
      setTerm("");
      return;
    }
    onChange([...values, value]);
    setTerm("");
    setOpen(false);
  }

  function remove(name: string) {
    onChange(values.filter((value) => value !== name));
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter" || event.key === ",") {
      event.preventDefault();
      add(term);
    } else if (event.key === "Backspace" && term === "" && values.length > 0) {
      remove(values[values.length - 1]!);
    } else if (event.key === "Escape") {
      setOpen(false);
    }
  }

  const showSuggestions = open && term.trim().length >= 2;

  return (
    <div>
      <label htmlFor={inputId} className="mb-1.5 block text-sm font-semibold">
        {label}
      </label>
      {description ? (
        <p className="mb-2 text-sm text-[var(--color-ink-2)]">{description}</p>
      ) : null}

      {values.length > 0 ? (
        <ul className="mb-2 flex flex-wrap gap-2" aria-label={`${label}, chosen`}>
          {values.map((value) => (
            <li key={value}>
              <span
                data-testid="medicine-token"
                className="inline-flex items-center gap-1.5 rounded-full border border-[var(--color-line)] bg-[var(--color-wash)] py-1 pr-1 pl-3 text-sm"
              >
                {value}
                <button
                  type="button"
                  onClick={() => remove(value)}
                  aria-label={`Remove ${value}`}
                  className="rounded-[var(--radius-tight)] p-1 text-[var(--color-ink-2)] transition-colors hover:bg-[var(--color-surface)] hover:text-[var(--color-ink)]"
                >
                  <X className="size-3.5" aria-hidden="true" />
                </button>
              </span>
            </li>
          ))}
        </ul>
      ) : null}

      <div className="relative">
        <div className="search-glow flex items-center gap-2 rounded-[var(--radius-field)] border border-[var(--color-line)] bg-[var(--color-surface)] px-3.5">
          <input
            id={inputId}
            type="text"
            role="combobox"
            autoComplete="off"
            aria-expanded={showSuggestions}
            aria-controls={listId}
            aria-autocomplete="list"
            disabled={full}
            value={term}
            onChange={(event) => {
              setTerm(event.target.value);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            onKeyDown={onKeyDown}
            placeholder={full ? `That is the most this can take (${max})` : "Type a name and press Enter"}
            data-testid="current-medicines"
            className="h-11 w-full min-w-0 bg-transparent outline-hidden placeholder:text-[var(--color-ink-2)] disabled:cursor-not-allowed"
          />
          {loading ? (
            <Loader2
              className="size-4 shrink-0 animate-spin text-[var(--color-ink-2)]"
              aria-hidden="true"
            />
          ) : null}
          {term.trim() ? (
            <button
              type="button"
              onClick={() => add(term)}
              aria-label={`Add ${term.trim()}`}
              className="rounded-[var(--radius-tight)] p-1.5 text-[var(--color-ink-2)] transition-colors hover:bg-[var(--color-wash)] hover:text-[var(--color-ink)]"
            >
              <Plus className="size-4" aria-hidden="true" />
            </button>
          ) : null}
        </div>

        {showSuggestions ? (
          <ul
            id={listId}
            role="listbox"
            aria-label="Suggestions"
            className="absolute z-20 mt-2 max-h-64 w-full overflow-y-auto rounded-[var(--radius-tight)] border border-[var(--color-line)] bg-[var(--color-surface)] shadow-[var(--shadow-lift)]"
          >
            {results.map((result) => {
              const why = matchedOnLabel(result.matched_on, term, result.name);
              return (
                <li key={result.id} role="none">
                  <button
                    type="button"
                    role="option"
                    aria-selected={false}
                    onClick={() => add(result.name)}
                    data-testid="token-suggestion"
                    className={cn(
                      "flex w-full items-center gap-2 px-3.5 py-2.5 text-left transition-colors hover:bg-[var(--color-wash)]",
                    )}
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold">
                        {result.name}
                      </span>
                      {why ? (
                        <span className="block truncate text-sm text-[var(--color-ink-2)]">
                          {why}
                        </span>
                      ) : null}
                    </span>
                  </button>
                </li>
              );
            })}
            {!loading && empty ? (
              <li className="px-3.5 py-3 text-sm text-[var(--color-ink-2)]">
                Not a name this database knows. You can still add it, and the answer will
                say it was not recognised.
              </li>
            ) : null}
          </ul>
        ) : null}
      </div>
    </div>
  );
}
