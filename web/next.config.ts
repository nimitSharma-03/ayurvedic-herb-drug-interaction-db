import type { NextConfig } from "next";

const config: NextConfig = {
  reactStrictMode: true,
  // The build must fail on a type error rather than ship past one. Linting is
  // a separate step here (`npm run lint`), because this version of the
  // framework no longer runs ESLint as part of the build.
  typescript: { ignoreBuildErrors: false },
  poweredByHeader: false,
};

export default config;
