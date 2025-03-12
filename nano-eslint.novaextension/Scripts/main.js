const ESLINT_PATH = "/opt/homebrew/bin/eslint"
const SHELL_PATH = "/opt/homebrew/bin/fish"
const ESLINT_CONFIG_FILENAMES = [
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
	let i = 0

	while (true) {
		const configRoot = nova.path.join(dirname, "../".repeat(i))

		for (const configFileName of ESLINT_CONFIG_FILENAMES) {
			const configPath = nova.path.join(configRoot, configFileName)

			if (nova.fs.stat(configPath)) return nova.path.normalize(configPath)
			else if (configRoot === "/") return // we hit top-level directory
			else if (i > 100) return // too many iterations
		}

		i++
	}
}

/**
 * @param {string} configpath
 * @param {string} filepath
 */
async function lint(configpath, filepath) {
	const executablePath = ESLINT_PATH
	const shell = SHELL_PATH
	const cwd = nova.path.dirname(configpath)
	const args = ["--format", "json", filepath]
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

		const configpath = getClosestEslintConfig(nova.path.dirname(filepath))
		if (!configpath) return []

		const lintingResult = await lint(configpath, filepath)

		return (
			lintingResult[0]?.messages.map(message => {
				const issue = new Issue()

				if (message.severity === 0) issue.severity = IssueSeverity.Info
				else if (message.severity === 1) issue.severity = IssueSeverity.Warning
				else if (message.severity === 2) issue.severity = IssueSeverity.Error

				issue.message = message.message
				issue.line = message.line
				issue.column = message.column
				issue.endLine = message.endLine
				issue.endColumn = message.endColumn

				return issue
			}) ?? []
		)
	} catch (error) {
		console.error(error)
		return []
	}
}

nova.assistants.registerIssueAssistant("*", { provideIssues: maybeLint })
