#!/usr/bin/env -S node --no-warnings --experimental-vm-modules
import { parseArgs } from 'node:util'
import Agregore from './index.js'

const HELP_TEXT = `
agregore run <script> [...opts]
agregore eval "Some code" [...opts]

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
    'no-hyper': { type: 'boolean' }
  },
  strict: true,
  allowPositionals: true
})

// console.log(args)

const firstCommand = args.positionals[0]

if (!firstCommand || args.values.help) {
  console.log(HELP_TEXT)
} else if (firstCommand === 'run') {
  doRun()
} else if (firstCommand === 'eval') {
  doEval()
} else {
  console.log(`Unknown command: ${firstCommand}.\n\n${HELP_TEXT}`)
}

async function init () {
  const opts = {}
  if (args.values['no-http']) opts.http = false
  if (args.values['no-https']) opts.https = false
  if (args.values['no-ipfs']) opts.ipfs = false
  if (args.values['no-hyper']) opts.hyper = false
  if (args.values.root) opts.root = args.values.root
  const agregore = await new Agregore(opts)

  await agregore.init()

  return agregore
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
  const toEval = args.positionals[1]

  if (!toEval) {
    console.error('Must specify code to evaluate')
    return
  }

  const agregore = await init()

  const result = await agregore.eval(toEval)

  if (result !== undefined) {
    console.log(result)
  }

  await agregore.close()
}
