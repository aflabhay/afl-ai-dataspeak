/** @type {import('next').NextConfig} */
const nextConfig = {
  // Standalone output — creates a self-contained build for Docker/Cloud Run.
  // Produces a minimal server.js + only the node_modules it actually needs.
  output: 'standalone',

  // Allow the API URL to be injected at runtime (Cloud Run sets it via env var).
  // NEXT_PUBLIC_ vars are normally baked in at build time; this makes them
  // readable from process.env at the server level too.
  env: {
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000',
  },
};

module.exports = nextConfig;
