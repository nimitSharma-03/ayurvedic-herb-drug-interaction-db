import Link from "next/link";

import { Button } from "@/components/ui/button";
import { WatchingEyes } from "@/components/watching-eyes";

/**
 * The 404: a night page, two eyes looking for what is not there, one sentence
 * and the way back. Always dark, like the home scenes, whatever the theme.
 */
export default function NotFound() {
  return (
    <div className="night flex min-h-[calc(100svh-var(--nav-h))] items-center bg-[var(--color-charred)]">
      <div className="page-shell flex flex-col items-center py-16 text-center">
        <WatchingEyes />
        <h1 className="mt-10">That page does not exist.</h1>
        <div className="mt-8">
          <Button asChild>
            <Link href="/">Back to home</Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
