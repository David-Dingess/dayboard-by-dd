import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Next's own gzip middleware patches res.on('drain') to point at the zlib
  // stream, but res.once('drain') then unregisters against res, so every
  // backpressured write in server/pipe-readable.js leaks a listener on the
  // Gzip — "11 drain listeners added to [Gzip]" in the dev overlay. Nothing
  // here compresses anything worth compressing: this serves one display over
  // loopback. Drop the middleware, drop the warning.
  compress: false,
};

export default nextConfig;
