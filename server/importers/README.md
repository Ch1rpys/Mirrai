# Chat export importers

Each format the app can turn into records lives in `formats/`. Detection
asks every importer whether the file looks like theirs; a parser takes
bytes and returns messages. Parsers do not read the database and do not
send requests.

A format is listed here only after its shape has been checked against a
document or a real sample. Formats the handbook named but that could not
be verified stay off the registry, so the wizard does not offer them.

## generic-line

The app's own one-line transcript, the same shape `parseTranscriptMessages`
already reads.

- Source: this repository (`server/chat/micro-rules.ts`).
- Shape: `[YYYY-MM-DD HH:mm:ss] speaker：content`, or the same without
  brackets, or `speaker：content` with no time. A line that does not name
  a speaker continues the message above it.
- Sample (synthetic): `server/test-fixtures/exports/generic-line/sample.txt`.
  Covers a continuation line, a colon inside the content, and a line of
  content that looks like a message header.
- Known variants: ASCII `:` or fullwidth `：`. Date particles `年/月/日`.

## wechat-txt-2line

WeChatMsg / MemoTrace TXT export. Checked 2026-11-16 against
[`xxxxshuai/WeChatMsg` `exporter/exporter_txt.py`](https://raw.githubusercontent.com/xxxxshuai/WeChatMsg/master/exporter/exporter_txt.py):
`{str_time} {display_name}\\n{message.to_text()}` joined by a blank line.
A system message's header is the timestamp alone.

- Sample (synthetic): `server/test-fixtures/exports/wechat-txt-2line/sample.txt`.
- Known variants: body may be several lines; a colon inside the body is
  not a new header.

## wechat-txt-paren

Checked 2026-11-16 against
[WeChatDumpText](https://github.com/astarforbae/WeChatDumpText)
(`发送者名称  (时间戳)` then the body) and the handbook's colon variant
`昵称 (YYYY-MM-DD HH:mm:ss):`. Content may sit on the header line or
the next lines.

- Sample (synthetic): `server/test-fixtures/exports/wechat-txt-paren/sample.txt`.

## wechat-csv

Checked 2026-11-16 against WeChatMsg / PyWxDump MSG columns:
[wx-core MSG.md](https://docs.rs/crate/wx-core/latest/source/src/orm_types/MSG.md)
and [PyWxDump message types](https://deepwiki.com/chenrgSix/PyWxDump/6.3-message-type-handling).

Headers include `IsSender`, `StrContent`, `StrTime`, `Type`, `SubType`,
`NickName`. `IsSender = 1` is the user. Type 1 text, 3 image, 34 voice,
43 video, 47 sticker, 48 location, 49 app (subtype 5 link, 6 file, 2000
transfer), 50 call, 10000 system (pat / recall from the wording).

- Sample (synthetic): `server/test-fixtures/exports/wechat-csv/sample.csv`.

## wechat-json

Checked 2026-11-16 against the field names `server/collectors/runner.ts`
already accepts (`sender` / `sender_name` / `from` / `content` / `text`
/ `timestamp` / `create_time` / `StrTime`). A top-level array, or an
object with `messages` / `data`, is read the same way.

- Sample (synthetic): `server/test-fixtures/exports/wechat-json/sample.json`.
