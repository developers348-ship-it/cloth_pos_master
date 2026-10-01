import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactCompiler: true,
  serverExternalPackages: ["bcryptjs", "@prisma/client", "prisma"],
};

export default nextConfig;
