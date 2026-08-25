import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactCompiler: true,
  transpilePackages: ["@agents/contracts"],
  async rewrites() {
    return [
      {
        source: "/api/rpc",
        destination: `${process.env.BACKEND_URL ?? "http://localhost:6020"}/rpc`,
      },
    ];
  },
};

export default nextConfig;
