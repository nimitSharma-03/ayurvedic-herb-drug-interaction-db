/**
 * Reading the repository's own reference files.
 *
 * The honesty tests need the real medicine names, condition names and brand
 * names, and the only honest place to get them is the files the backend is
 * built from. Writing them into a test file would be exactly the hardcoding
 * those tests exist to forbid.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

const REPO_ROOT = join(process.cwd(), "..");
const REFERENCE = join(REPO_ROOT, "data", "reference");

/** A very small CSV reader: enough for these files, which are quoted plainly. */
function readCsv(path: string): Record<string, string>[] {
  const text = readFileSync(path, "utf-8").replace(/^﻿/, "");
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i]!;
    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        field += char;
      }
      continue;
    }
    if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (char !== "\r") {
      field += char;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  const [header, ...body] = rows;
  if (!header) return [];
  return body
    .filter((line) => line.some((cell) => cell.trim().length > 0))
    .map((line) =>
      Object.fromEntries(header.map((key, index) => [key, line[index] ?? ""])),
    );
}

export function herbNames(): string[] {
  return readCsv(join(REFERENCE, "herbs.csv"))
    .map((row) => row.herb_name!)
    .filter(Boolean);
}

export function drugNames(): string[] {
  // One row per class, with its drugs semicolon-separated in `example_drugs`.
  return readCsv(join(REFERENCE, "drug_classes.csv"))
    .flatMap((row) => (row.example_drugs ?? "").split(";"))
    .map((name) => name.trim())
    .filter(Boolean);
}

export function drugClassNames(): string[] {
  return [
    ...new Set(
      readCsv(join(REFERENCE, "drug_classes.csv"))
        .map((row) => row.drug_class!)
        .filter(Boolean),
    ),
  ];
}

export function conditionNames(): string[] {
  return readCsv(join(REFERENCE, "conditions.csv"))
    .map((row) => row.name ?? row.condition_name ?? "")
    .filter(Boolean);
}

export function brandNames(): string[] {
  return readCsv(join(REFERENCE, "medicine_aliases.csv"))
    .filter((row) => row.alias_type === "brand_name")
    .map((row) => row.alias!)
    .filter(Boolean);
}
