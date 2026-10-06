import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The TypeScript compiler API is installed and typechecked in the project.
  // Using it avoids the CLI subprocess returning empty captured output in some
  // local runtimes during Next's jsconfig parsing.
  experimental: { useTypeScriptCli: false },
};

export default nextConfig;
