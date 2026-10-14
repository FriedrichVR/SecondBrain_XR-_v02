/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // R3F / three / XR must only run in the browser — keep them out of SSR
  // bundles by code-splitting at the page level (dynamic ssr:false).
  transpilePackages: ["three", "@react-three/fiber", "@react-three/drei", "@react-three/xr"],
};

module.exports = nextConfig;
