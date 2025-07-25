#!/usr/bin/env -S node --no-warnings --experimental-vm-modules
import { parseArgs } from 'node:util'
import repl, { REPLServer } from 'node:repl'
import Agregore from './index.js'

const HELP_TEXT = `
agregore run <script> [...opts]
agregore eval "Some code" [...opts]
agregore repl [...opts]

--no-https: Disable loading scripts from HTTPS
--no-http:  Disable loading scripts from HTTP
--no-ipfs: Disable loading scripts from IPFS
--no-hyper: Disable loading scripts from hypercore-protocol
--root: The root folder to persist data to (defaults to current folder)
--autoclose: Used with 'run' to automatically close after the module gets evaluated
--help: Show this text
`

const args = parseArgs({
  options: {
    help: {
      type: 'boolean',
      short: 'h'
    },
    autoclose: {
      type: 'boolean',
      short: 'a'
    },
    'no-http': { type: 'boolean' },
    'no-https': { type: 'boolean' },
    'no-ipfs': { type: 'boolean' },
    'no-hyper': { type: 'boolean' },
    'no-gemini': { type: 'boolean' }
  },
  strict: true,
  allowPositionals: true
})

const firstCommand = args.positionals[0]

if (!firstCommand || args.values.help) {
  console.log(HELP_TEXT)
} else if (firstCommand === 'run') {
  doRun()
} else if (firstCommand === 'eval') {
  doEval()
} else if (firstCommand === 'repl') {
  doRepl()
} else {
  console.log(`Unknown command: ${firstCommand}.\n\n${HELP_TEXT}`)
}

async function init () {
  const opts = {}
  if (args.values['no-http']) opts.httpOptions = false
  if (args.values['no-https']) opts.httpsOptions = false
  if (args.values['no-ipfs']) opts.ipfsOptions = false
  if (args.values['no-hyper']) opts.hyperOptions = false
  if (args.values['no-gemini']) opts.geminiOptions = false
  if (args.values.root) opts.root = args.values.root

  const agregore = await new Agregore(opts)

  await agregore.init()

  return agregore
}

async function doRepl () {
  const agregore = await init()

  REPLServer.prototype.createContext = () => agregore.context

  async function evalInContext (code, context, filename, callback) {
    try {
      const result = await agregore.eval(code)
      callback(null, result)
    } catch (e) {
      if (isRecoverableError(e)) {
        return callback(new repl.Recoverable(e))
      }
      return callback(e)
    }
  }

  repl.start({ eval: evalInContext })
}

function isRecoverableError (error) {
  if (error.name === 'SyntaxError') {
    return /^(Unexpected end of input|Unexpected token)/.test(error.message)
  }
  return false
}

async function doRun () {
  const script = args.positionals[1]

  if (!script) {
    console.error('Must specify script to execute')
    return
  }
  const agregore = await init()

  await agregore.import(script)

  if (args.values.autoclose) {
    await agregore.close()
  }
}

async function doEval () {
  let toEval = args.positionals[1]

  if (!toEval) {
    toEval = await collect(process.stdin)
  }

  if (!toEval) {
    console.error('Must specify code to evaluate')
    return
  }

  // Wrap in async function
  // Add return to last line
  if (toEval.includes('await')) {
    const lines = toEval.trim().split('\n')
    const last = lines.at(-1)
    lines[lines.length - 1] = `return ${last}`

    toEval = `(async function eval(){${lines.join('\n')}})()`
  }

  const agregore = await init()

  const result = await agregore.eval(toEval)

  if (result !== undefined) {
    console.log(result)
  }

  await agregore.close()
}

async function collect (stream) {
  const chunks = []
  for await (const chunk of stream) {
    chunks.push(chunk)
  }

  const combined = Buffer.concat(chunks).toString('utf8')

  return combined
}
