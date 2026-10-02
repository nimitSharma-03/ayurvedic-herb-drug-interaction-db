"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Leaf, Loader2, Pill, Search } from "lucide-react";

import { useMedicineSearch } from "@/hooks/use-medicine-search";
import { matchedOnLabel } from "@/lib/text";
import { cn } from "@/lib/utils";

/**
 * The catalogue search box on /medicines.
 *
 * Results come from the backend's own ranking, and each one says why it
 * matched: typing "Indian Ginseng" finds Ashwagandha and the result says
 * "matched Indian Ginseng", so the reader can see that a name they know was
 * recognised rather than wonder why a different name came back.
 *
 * A listbox with the usual keys: Down and Up move, Enter opens the highlighted
 * result, Escape closes the list. Every result is also a plain link, so the
 * whole thing works by tab and click alone.
 */
export function MedicineSearch({ autoFocus = false }: { autoFocus?: boolean }) {
  const router = useRouter();
  const [query, setQuery] = React.useState("");
  const [open, setOpen] = React.useState(false);
  const [highlighted, setHighlighted] = React.useState(-1);
  const inputId = React.useId();
  const listId = `${inputId}-results`;
  const { results, loading, error, empty } = useMedicineSearch(query);

  // Clamped during render rather than reset in an effect: a shorter list after
  // a new keystroke must not leave the highlight pointing past its end.
  const active = highlighted < results.length ? highlighted : -1;
  const showList = open && query.trim().length >= 2;

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape") {
      setOpen(false);
      return;
    }
    if (results.length === 0) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setOpen(true);
      setHighlighted((index) => (index + 1) % results.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setOpen(true);
      setHighlighted((index) => (index <= 0 ? results.length - 1 : index - 1));
    } else if (event.key === "Enter" && active >= 0) {
      const chosen = results[active];
      if (chosen) {
        event.preventDefault();
        router.push(`/medicines/${chosen.id}`);
      }
    }
  }

  return (
    <div className="relative">
      <label htmlFor={inputId} className="mb-2 block text-sm font-semibold">
        Search a herb or a medicine
      </label>

      <div className="search-glow flex items-center gap-2.5 rounded-[var(--radius-field)] border border-[var(--color-line)] bg-[var(--color-surface)] px-4">
        <Search className="size-5 shrink-0 text-[var(--color-ink-2)]" aria-hidden="true" />
        <input
          id={inputId}
          type="search"
          role="combobox"
          autoComplete="off"
          autoFocus={autoFocus}
          aria-expanded={showList}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={
            active >= 0 && results[active] ? `${listId}-${results[active].id}` : undefined
          }
          value={query}
          placeholder="Type a herb or a medicine name"
          onChange={(event) => {
            setQuery(event.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          data-testid="medicine-search"
          className="h-14 w-full min-w-0 bg-transparent text-base outline-hidden placeholder:text-[var(--color-ink-2)] sm:text-lg"
        />
        {loading ? (
          <Loader2
            className="size-4 shrink-0 animate-spin text-[var(--color-ink-2)]"
            aria-hidden="true"
          />
        ) : null}
      </div>

      <p className="mt-2 text-sm text-[var(--color-ink-2)]">
        Names in other languages and botanical names are recognised. Brand names are
        matched but never shown.
      </p>

      <div aria-live="polite" className="sr-only">
        {showList && !loading
          ? `${results.length} ${results.length === 1 ? "result" : "results"}`
          : ""}
      </div>

      {showList ? (
        <div className="absolute z-20 mt-2 w-full overflow-hidden rounded-[var(--radius-card-sm)] border border-[var(--color-line)] bg-[var(--color-surface)] shadow-[var(--shadow-lift)]">
          {error ? (
            <p className="px-4 py-4 text-sm text-[var(--color-verified)]">{error.message}</p>
          ) : null}

          {!error && empty ? (
            <p className="px-4 py-4 text-sm text-[var(--color-ink-2)]" data-testid="search-empty">
              Nothing in this database matches that. It covers a fixed set of Ayurvedic
              herbs and conventional drugs, and does not guess outside it.
            </p>
          ) : null}

          <ul id={listId} role="listbox" aria-label="Search results" className="max-h-80 overflow-y-auto">
            {results.map((result, index) => {
              const why = matchedOnLabel(result.matched_on, query, result.name);
              return (
                <li key={result.id} role="none">
                  <Link
                    id={`${listId}-${result.id}`}
                    role="option"
                    aria-selected={index === active}
                    href={`/medicines/${result.id}`}
                    onMouseEnter={() => setHighlighted(index)}
                    data-testid="search-result"
                    className={cn(
                      "flex items-center gap-3 px-4 py-3 transition-colors",
                      index === active ? "bg-[var(--color-wash)]" : "hover:bg-[var(--color-wash)]",
                    )}
                  >
                    {result.medicine_type === "herb" ? (
                      <Leaf
                        className="size-4 shrink-0 text-[var(--color-herb)]"
                        aria-hidden="true"
                      />
                    ) : (
                      <Pill
                        className="size-4 shrink-0 text-[var(--color-drug)]"
                        aria-hidden="true"
                      />
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-[family-name:var(--font-heading)] font-semibold">
                        {result.name}
                      </span>
                      <span className="block truncate text-sm text-[var(--color-ink-2)]">
                        {result.scientific_name ?? result.drug_class ?? result.generic_name ?? ""}
                        {why ? (
                          <span data-testid="matched-on">
                            {result.scientific_name || result.drug_class || result.generic_name
                              ? " · "
                              : ""}
                            {why}
                          </span>
                        ) : null}
                      </span>
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
