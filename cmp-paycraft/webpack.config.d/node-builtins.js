// The js platform stores (DeviceTokenStore, DeviceFingerprint, PlatformInfo's device id) fall back to
// ~/.paycraft files on Node.js via require('fs' | 'os' | 'path'). A browser bundle has no such modules and
// takes the localStorage branch, so tell webpack they resolve to nothing instead of failing the bundle.
config.resolve = config.resolve || {};
config.resolve.fallback = Object.assign({}, config.resolve.fallback, { fs: false, os: false, path: false });
