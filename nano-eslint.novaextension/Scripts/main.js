/** @typedef {import('@types/eslint').ESLint.LintResult} LintResult */

const DEFAULT_ESLINT_CONFIG_FILENAMES = [
	"eslint.config.js",
	"eslint.config.mjs",
	"eslint.config.cjs",
	"eslint.config.ts",
	"eslint.config.mts",
	"eslint.config.cts"
]

/**
 * @param {string} executablePath
 * @param {ConstructorParameters<typeof Process>[1]} options
 * @returns {Promise<{ code: number; stdout: string; stderr: string }>}
 */
async function runAsync(executablePath, options) {
	return new Promise(resolve => {
		const process = new Process(executablePath, options)

		let stdout = ""
		let stderr = ""

		process.onStdout(line => (stdout += line))
		process.onStderr(line => (stderr += line))
		process.onDidExit(code => resolve({ code, stdout, stderr }))

		process.start()
	})
}

/**
 * @param {string} dirname
 * @returns {string | undefined} path of closest eslint config
 */
function getClosestEslintConfig(dirname) {
	const eslintConfigFilenames = (
		nova.config.get("org.nano-eslint.config_names", "array") ?? []
	).concat(DEFAULT_ESLINT_CONFIG_FILENAMES)

	let i = 0

	while (true) {
		const configRoot = nova.path.join(dirname, "../".repeat(i))

		for (const configFileName of eslintConfigFilenames) {
			const configPath = nova.path.join(configRoot, configFileName)

			if (nova.fs.stat(configPath)) return nova.path.normalize(configPath)
		}

		if (configRoot === "/")
			return // we hit top-level directory
		else if (i > 100) return // too many iterations

		i++
	}
}

/**
 * @param {string} filepath
 * @param {{ configPath: string; otherArgs?: string[]; onError?(error: unknown):void }} [config]
 * @returns {Promise<LintResult[] | undefined>}
 */
async function eslint(filepath, { configPath, otherArgs = [], onError } = {}) {
	/** @type {string} */
	const executablePath = nova.config.get("org.nano-eslint.eslint_path", "string")
	/** @type {string} */
	const shell = nova.config.get("org.nano-eslint.shell_path", "string")

	const cwd = nova.path.dirname(configPath)
	const args = ["--config", configPath, "--format", "json", ...otherArgs, filepath]
	const options = { args, cwd, shell }

	const command = [executablePath, ...args].join(" ")
	console.log(command)

	const { stdout, code, stderr } = await runAsync(executablePath, options)

	if (stderr) {
		onError?.(new Error(`'${command}' failed with code '${code}' and stderr '${stderr}'`))
		return
	}

	try {
		return JSON.parse(stdout)
	} catch (error) {
		onError?.(error)
	}
}

/**
 * @param {TextEditor} editor
 * @returns {Promise<Issue[]>} issues
 */
async function maybeLint(editor) {
	try {
		const filePath = editor.document.path
		if (!filePath) return []

		const configPath = getClosestEslintConfig(nova.path.dirname(filePath))
		if (!configPath) return []

		const lintingResult = await eslint(filePath, {
			configPath,
			onError: console.error,
		})

		if (!Array.isArray(lintingResult)) return []

		const [firstResult] = lintingResult
		if (!firstResult || !Array.isArray(firstResult.messages)) return []

		return firstResult.messages
			.map(message => {
				if (
					typeof message.message !== "string" ||
					typeof message.line !== "number" ||
					typeof message.column !== "number"
				) {
					console.warn("[nano-eslint] Skipping malformed ESLint message:", message)
					return
				}

				const issue = new Issue()
				issue.message = message.message
				issue.line = message.line
				issue.column = message.column

				if (typeof message.endLine === "number") issue.endLine = message.endLine
				if (typeof message.endColumn === "number") issue.endColumn = message.endColumn

				issue.severity =
					message.severity === 1
						? IssueSeverity.Warning
						: message.severity === 2
						? IssueSeverity.Error
						: IssueSeverity.Info

				if (
					issue.severity === IssueSeverity.Warning &&
					issue.message.match(/^File ignored\b/)
				)
					return

				return issue
			})
			.filter(Boolean)
	} catch (error) {
		console.error("[nano-eslint] maybeLint failed:", error)
		return []
	}
}

/** @param {TextEditor} editor */
async function maybeFix(editor) {
	const filePath = editor.document.path
	if (!filePath) return false

	const configPath = getClosestEslintConfig(nova.path.dirname(filePath))
	if (!configPath) return false

	const results = await eslint(filePath, {
		configPath,
		otherArgs: ["--fix-dry-run"],
		onError: console.error
	})
	const output = results?.[0]?.output
	if (!output) return false

	const fullRange = new Range(0, editor.document.length)
	const currentText = editor.document.getTextInRange(fullRange)

	if (currentText === output) return false

	await editor.edit(edit => {
		edit.replace(fullRange, output)
	})

	return true
}

nova.assistants.registerIssueAssistant("*", { provideIssues: maybeLint })

nova.workspace.onDidAddTextEditor(editor => {
	const shouldFix = nova.config.get("org.nano-eslint.fix_on_save", "boolean") ?? false
	if (!shouldFix) return

	editor.onWillSave(() => {
		maybeFix(editor)
			.then(didChange => {
				if (didChange) {
					// Wait a tick so Nova finishes current save before re-saving
					setTimeout(() => editor.save(), 10)
				}
			})
			.catch(error => console.error(error))
	})
})
