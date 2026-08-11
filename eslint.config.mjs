import js from '@eslint/js'
import globals from 'globals'

export default [
	{
		languageOptions: {
			globals: {
				...globals.node, // Enables Node.js globals (require, module, process, __dirname)
				...globals.browser, // Enables Browser globals (window, document, fetch)
				...globals.es2021, // Enables modern ES features (setTimeout, etc.)
			},
		},
		rules: {
			camelcase: ['error', { properties: 'always' }],
			'no-unused-vars': 'warn', // Optional: change unused var errors to warnings
		},
	},
]
