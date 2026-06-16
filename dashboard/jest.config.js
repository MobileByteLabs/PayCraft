/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: "node",
  preset: "ts-jest",
  rootDir: ".",
  testMatch: ["<rootDir>/__tests__/**/*.test.ts"],
  moduleNameMapper: {
    "^@/(.*)$": "<rootDir>/$1",
  },
  transform: {
    "^.+\\.tsx?$": [
      "ts-jest",
      {
        tsconfig: {
          jsx: "react",
          esModuleInterop: true,
          module: "commonjs",
          target: "es2020",
          moduleResolution: "node",
          strict: false,
          skipLibCheck: true,
          resolveJsonModule: true,
        },
        isolatedModules: true,
        diagnostics: false,
      },
    ],
  },
  setupFiles: ["<rootDir>/__tests__/setup.ts"],
}
