import type { Metadata } from "next";

import { ApiUnreachable } from "@/components/api-unreachable";
import { MedicineBrowser } from "@/components/medicine-browser";
import { MedicineSearch } from "@/components/medicine-search";
import { api, asApiError } from "@/lib/api";
import type { MedicineListResponse } from "@/lib/types";

export const metadata: Metadata = {
  title: "Medicines",
  description:
    "Search or browse every Ayurvedic herb and conventional drug this database covers, by any of the names each one is known by.",
};

export default async function MedicinesPage() {
  let list: MedicineListResponse;
  try {
    // One request for the whole catalogue. The scope is frozen and small, so
    // filtering and searching in the browser is instant and needs no round
    // trip; the backend's own ranked search still backs the box above the
    // list, where a reader is typing a name rather than scanning a list.
    list = await api.medicines({ limit: 100 });
  } catch (error) {
    return (
      <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6">
        <ApiUnreachable error={asApiError(error)} what="the medicine list" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-10 sm:px-6">
      <h1 className="text-3xl sm:text-4xl">Medicines in this database</h1>
      <p className="mt-3 max-w-2xl text-[var(--color-ink-2)]">
        {list.count} in all. The set is fixed: a herb or a drug that is not here is
        outside what this project covers, and nothing is added on the fly.
      </p>

      <div className="panel mt-8 p-5 sm:p-6">
        <MedicineSearch />
      </div>

      <MedicineBrowser medicines={list.results} />
    </div>
  );
}
