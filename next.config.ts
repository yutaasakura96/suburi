import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // next dev would otherwise write AGENTS.md and a block into CLAUDE.md (06, "No AGENTS.md").
  agentRules: false,
};

export default nextConfig;
