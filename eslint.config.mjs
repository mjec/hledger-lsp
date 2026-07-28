import typescriptEslintPlugin from "@typescript-eslint/eslint-plugin";
import typescriptEslintParser from "@typescript-eslint/parser";

export default [{
	files: ["**/*.ts"],

	plugins: {
		"@typescript-eslint": typescriptEslintPlugin,
	},

	languageOptions: {
		parser: typescriptEslintParser,
		ecmaVersion: 2020,
		sourceType: "module",
	},

	rules: {
		"@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
		"@typescript-eslint/explicit-function-return-type": "off",
		"@typescript-eslint/no-explicit-any": "warn",
	},
}];
