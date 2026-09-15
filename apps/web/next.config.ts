import type { NextConfig } from "next";
const nextConfig: NextConfig = { output: "standalone", outputFileTracingRoot: new URL("../../", import.meta.url).pathname, transpilePackages: ["@lake-tech/contracts", "@lake-tech/core", "@lake-tech/db"] };
export default nextConfig;
