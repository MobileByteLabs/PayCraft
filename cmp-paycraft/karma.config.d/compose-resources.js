// Browser tests (js / wasmJs): serve the module's Compose resources at /composeResources/, where
// Res.* loads them from. Kotlin copies them next to the test bundle (kotlin/composeResources) but Karma
// serves nothing it isn't told about, so every stringResource / Res.readBytes in a test came back empty.
// This file is appended to the generated karma.conf.js, so __dirname is the test package directory.
const path = require("path");
const composeResources = path.resolve(__dirname, "kotlin", "composeResources");

config.files.push({
    pattern: composeResources + "/**",
    included: false,
    served: true,
    watched: false,
});
config.proxies = Object.assign({}, config.proxies, {
    "/composeResources/": "/absolute" + composeResources + "/",
});

// Kotlin/JS loads Skia from skiko.wasm next to the page; serve it from the test package (wasmJs bundles its own).
const skikoWasm = path.resolve(__dirname, "kotlin", "skiko.wasm");
if (require("fs").existsSync(skikoWasm)) {
    config.files.push({ pattern: skikoWasm, included: false, served: true, watched: false });
    config.proxies["/skiko.wasm"] = "/absolute" + skikoWasm;
}

// Compose UI tests render through Skiko; the first one in a run can exceed Mocha's 2 s default.
config.client = config.client || {};
config.client.mocha = Object.assign({}, config.client.mocha, { timeout: 30000 });
