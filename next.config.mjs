/** @type {import('next').NextConfig} */
const nextConfig = {
  // Playwright and the Prisma engine are native/large: keep them out of the bundler.
  serverExternalPackages: ["playwright", "@prisma/client", "exceljs", "mammoth"],
  experimental: { serverActions: { bodySizeLimit: "12mb" } },
};
export default nextConfig;
