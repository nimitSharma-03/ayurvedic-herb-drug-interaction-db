"use client";

import * as React from "react";
import { Check, ChevronDown, Leaf, Loader2, Pill } from "lucide-react";

import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useMedicineSearch } from "@/hooks/use-medicine-search";
import { matchedOnLabel } from "@/lib/text";
import type { SearchResult } from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * An alias-aware picker for one medicine.
 *
 * Suggestions come from the backend's ranked search, so typing a name in
 * another language or a botanical name finds the medicine, and each suggestion
 * says which name matched. Client-side filtering is switched off for the same
 * reason: the backend already decided what matches and in what order, and
 * filtering again here would drop alias hits whose text does not contain what
 * was typed.
 *
 * The chosen value is the medicine's name, which is what the pair check takes.
 */
export function MedicineCombobox({
  label,
  value,
  onChange,
  placeholder = "Type a name",
  testId,
}: {
  label: string;
  value: string;
  onChange: (name: string) => void;
  placeholder?: string;
  testId?: string;
}) {
  const [open, setOpen] = React.useState(false);
  const [term, setTerm] = React.useState("");
  const labelId = React.useId();
  const { results, loading, empty, error } = useMedicineSearch(term);

  function choose(result: SearchResult) {
    onChange(result.name);
    setTerm("");
    setOpen(false);
  }

  return (
    <div>
      <span id={labelId} className="mb-1.5 block text-sm font-medium">
        {label}
      </span>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          type="button"
          role="combobox"
          aria-labelledby={labelId}
          aria-expanded={open}
          data-testid={testId}
          className="search-glow flex h-12 w-full items-center gap-2 rounded-[var(--radius-field)] border border-[var(--color-line)] bg-[var(--color-surface)] px-3.5 text-left"
        >
          <span
            className={cn(
              "min-w-0 flex-1 truncate",
              value ? "text-[var(--color-ink)]" : "text-[var(--color-ink-2)]",
            )}
          >
            {value || placeholder}
          </span>
          <ChevronDown
            className="size-4 shrink-0 text-[var(--color-ink-2)]"
            aria-hidden="true"
          />
        </PopoverTrigger>

        <PopoverContent className="p-0">
          <Command shouldFilter={false} label={label}>
            <CommandInput
              value={term}
              onValueChange={setTerm}
              placeholder="Search herbs and medicines"
            />
            <CommandList>
              {loading ? (
                <div className="flex items-center justify-center gap-2 px-3 py-6 text-sm text-[var(--color-ink-2)]">
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                  Searching
                </div>
              ) : null}

              {error ? (
                <p className="px-3 py-6 text-sm text-[var(--color-verified)]">
                  {error.message}
                </p>
              ) : null}

              {!loading && !error && term.trim().length < 2 ? (
                <p className="px-3 py-6 text-sm text-[var(--color-ink-2)]">
                  Type at least two letters. Other names and botanical names are
                  recognised.
                </p>
              ) : null}

              {!loading && empty ? (
                <CommandEmpty>
                  Nothing in this database matches that. It covers a fixed set of herbs
                  and drugs and does not guess outside it.
                </CommandEmpty>
              ) : null}

              {results.map((result) => {
                const why = matchedOnLabel(result.matched_on, term, result.name);
                return (
                  <CommandItem
                    key={result.id}
                    value={result.id}
                    onSelect={() => choose(result)}
                    data-testid="combobox-option"
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
                      <span className="block truncate font-semibold">{result.name}</span>
                      {result.scientific_name || result.drug_class || why ? (
                        <span className="block truncate text-sm text-[var(--color-ink-2)]">
                          {[result.scientific_name ?? result.drug_class, why]
                            .filter(Boolean)
                            .join(" · ")}
                        </span>
                      ) : null}
                    </span>
                    {value.toLowerCase() === result.name.toLowerCase() ? (
                      <Check className="size-4 shrink-0" aria-hidden="true" />
                    ) : null}
                  </CommandItem>
                );
              })}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  );
}
