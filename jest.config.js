/**
 * Monorepo Jest configuration
 * Runs package-level Jest configs for the server and the vscode-client packages.
 */
module.exports = {
  // Delegate to package-level configs so each package can control its own ts-jest settings
  projects: [
    '<rootDir>/server/jest.config.js',
    '<rootDir>/vscode-client/jest.config.js'
  ]
};
