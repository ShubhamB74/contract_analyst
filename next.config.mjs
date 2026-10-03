/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  serverExternalPackages: ["better-sqlite3", "mammoth", "unpdf"],
  webpack: (config) => {
    config.resolve.alias.canvas = false; // pdfjs-dist optionally requires node-canvas
    return config;
  },
};
export default nextConfig;
