# Command line

`mirrai` runs the same work the app's routes do, without a browser. Every
subcommand calls the function behind the route — the tRPC caller, the
importer, the persona bundle export — not a second implementation, so a
result from the command line is the result the app would have given.

The command line has no session, so **every subcommand needs `--user <id>`**,
the same way `pnpm eval` does.

```bash
corepack pnpm mirrai -- <command> …
# or, without pnpm:
node node_modules/tsx/dist/cli.mjs scripts/mirrai.ts <command> …
```

## Commands

### `import`

```bash
mirrai import <file> --persona <id> --user <id> [--format <id>] [--me <name>] [--them <name>]
```

Uploads a chat export from the local disk and runs the importer. `--format`
forces an importer instead of detecting one; `--me` and `--them` name the two
sides of the conversation (what the upload wizard asks for). The file is
copied into the app's uploads directory first, exactly like the HTTP upload.

### `distill`

```bash
mirrai distill --persona <id> --user <id> [--mode fast|standard|deep] [--yes]
```

Prints what the run will read and roughly how many model calls it will make,
then asks. `--yes` starts without asking (for scripts). The command waits
until the persona is rebuilt, printing the progress the app shows.

### `measure`

```bash
mirrai measure --persona <id> --user <id>
```

Measures the style profile from the records (the same call the records page
and an import use). No model is called.

### `export`

```bash
mirrai export --persona <id> --user <id> --out <path> [--with-records] [--passphrase-file <path>]
```

Writes a `.mirrai-persona` file (`docs/api.md` is the endpoint; the bundle is
the same file). `--with-records` adds the chat records. The bundle never
contains the measured style profile — it is measured again on import.

A passphrase is **never** an argument. `--passphrase-file` reads it from a
file; without the flag a terminal user is asked. Without a passphrase the file
is a plain zip of the records, which is worth knowing before copying it
anywhere.

### `eval`

```bash
mirrai eval --persona <id> --user <id> [the eval script's own flags]
```

Forwarded to `scripts/eval-run.ts` unchanged — see its header or
`docs/exec-v6.md` for the flags.

### `backup`

```bash
mirrai backup create --out <path> [--passphrase-file <path>]
mirrai backup restore --in <path> [--passphrase-file <path>]
mirrai backup verify --in <path>
```

Forwarded to `scripts/backup.ts` unchanged.

### `doctor`

```bash
mirrai doctor --user <id>
```

Runs the one-click diagnosis (C8.12) and prints its items. Exit code is
non-zero when any check failed.

## Output and exit codes

- `--json` prints **one JSON line** and nothing else, so it can be piped.
- Failures write their reason to standard error and exit non-zero. An empty
  successful run exits 0.
- Nothing needs the app to be running: the command line connects to the same
  database from the environment (`.env`), exactly like `pnpm eval` and
  `scripts/backup.ts`.

## Caveats

- An account with encrypted storage: the data key lives only in the app's own
  memory and never reaches this separate process, so the guarded routes answer
  with the "encrypted content is locked" error. There is no unlock step for the
  command line; use the app itself for an encrypted account.
- `--user` is the account id (`users.id`), not a username.
- `distill` waits for the run; that can be an hour for a very large history.
