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
 * @param {string[]} eslintConfigFilenames
 * @returns {string | undefined} path of closest eslint config
 */
function getClosestEslintConfig(dirname, eslintConfigFilenames) {
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
 * @param {string} configpath
 * @param {string} filepath
 */
async function lint(configpath, filepath) {
	/** @type {string} */
	const executablePath = nova.config.get("org.nano-eslint.eslint_path", "string")
	/** @type {string} */
	const shell = nova.config.get("org.nano-eslint.shell_path", "string")

	const cwd = nova.path.dirname(configpath)
	const args = ["--config", configpath, "--format", "json", filepath]
	const options = { args, cwd, shell }

	console.info(`Running Lint Command: '${executablePath} ${args.join(" ")}'`)
	const result = await runAsync(executablePath, options)
	console.info("Lint Command Result:", JSON.stringify(result))

	const { stdout } = result

	return JSON.parse(stdout)
}

/**
 * @param {TextEditor} editor
 * @returns {Promise<Issue[]>} issues
 */
async function maybeLint(editor) {
	try {
		const filepath = editor.document.path
		if (!filepath) return []

		const eslintConfigFileNames = (
			nova.config.get("org.nano-eslint.config_names", "array") ?? []
		).concat(DEFAULT_ESLINT_CONFIG_FILENAMES)

		const configpath = getClosestEslintConfig(
			nova.path.dirname(filepath),
			eslintConfigFileNames
		)
		if (!configpath) return []

		const lintingResult = await lint(configpath, filepath)

		return (
			lintingResult[0]?.messages
				.map(message => {
					const issue = new Issue()

					if (message.severity === 0) issue.severity = IssueSeverity.Info
					else if (message.severity === 1) issue.severity = IssueSeverity.Warning
					else if (message.severity === 2) issue.severity = IssueSeverity.Error

					if (
						issue.severity === IssueSeverity.Warning &&
						issue.message.match(/^File ignored\b/)
					)
						return

					issue.message = message.message
					issue.line = message.line
					issue.column = message.column
					issue.endLine = message.endLine
					issue.endColumn = message.endColumn

					return issue
				})
				.filter(Boolean) ?? []
		)
	} catch (error) {
		console.error(error)
		return []
	}
}

/** @param {TextEditor} editor */
async function maybeFix(editor) {
	const filepath = editor.document.path
	if (!filepath) return

	const eslintConfigFileNames = (
		nova.config.get("org.nano-eslint.config_names", "array") ?? []
	).concat(DEFAULT_ESLINT_CONFIG_FILENAMES)

	const configpath = getClosestEslintConfig(nova.path.dirname(filepath), eslintConfigFileNames)
	if (!configpath) return

	const executablePath = nova.config.get("org.nano-eslint.eslint_path", "string")
	const shell = nova.config.get("org.nano-eslint.shell_path", "string")
	const cwd = nova.path.dirname(configpath)

	const args = ["--config", configpath, filepath, "--fix-dry-run", "--format", "json"]
	const options = { args, cwd, shell }

	const result = await runAsync(executablePath, options)
	if (result.stderr) console.error(result.stderr)

	const output = JSON.parse(result.stdout)?.[0]?.output
	if (!output) return

	const fullRange = new Range(0, editor.document.length)
	const currentText = editor.document.getTextInRange(fullRange)

	if (currentText === output) return

	await editor.edit(edit => {
		edit.replace(fullRange, output)
	})
}

nova.assistants.registerIssueAssistant("*", { provideIssues: maybeLint })

nova.workspace.onDidAddTextEditor(editor => {
	const shouldFix = nova.config.get("org.nano-eslint.fix_on_save", "boolean") ?? false
	if (!shouldFix) return

	editor.onWillSave(() => {
		maybeFix(editor).catch(error => console.error(error))
	})
})
