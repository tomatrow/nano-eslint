import js from "@eslint/js"
import { defineConfig } from "eslint/config"
import nova from "eslint-plugin-nova"

export default defineConfig([
	{
		extends: [js.configs.recommended],
		files: ["nano-eslint.novaextension/Scripts/*.js"],
		languageOptions: {
			ecmaVersion: "latest",
			globals: nova.environments.nova.globals
		}
	}
])
