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
      <div className="mx-auto w-full max-w-[72rem] px-4 py-12 sm:px-8 lg:py-16">
        <ApiUnreachable error={asApiError(error)} what="the medicine list" />
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-[72rem] px-4 py-12 sm:px-8 lg:py-16">
      <h1 className="heading-rule">Medicines</h1>
      <p className="mt-4 max-w-[70ch] text-[var(--color-ink-2)]">
        {list.count} in all. The set is fixed; a name outside it has no page.
      </p>

      <div className="mt-8">
        <MedicineSearch />
      </div>

      <MedicineBrowser medicines={list.results} />
    </div>
  );
}
