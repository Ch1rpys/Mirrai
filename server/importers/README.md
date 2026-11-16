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

## qq-txt

Checked 2026-11-16 against Tencent's own export
([QQ 消息管理器](https://kf.qq.com/faq/161230MfMfqy161230q2ENVr.html))
and the sample in [lomirus/qq-history-to-json](https://github.com/lomirus/qq-history-to-json).
The file starts with `消息记录` / `消息对象:`; each message is
`YYYY-MM-DD H:mm:ss nickname` then the body, separated by a blank line.
Hours may be one digit.

- Sample (synthetic): `server/test-fixtures/exports/qq-txt/sample.txt`.

## qq-mht

Checked 2026-11-16 against converters of the official QQ message-manager
MHT export
([NnWinter/QQ_Mht_Message_To_Html](https://github.com/NnWinter/QQ_Mht_Message_To_Html),
[Ylsssq926 qq_parser](https://github.com/Ylsssq926/relic.skill/blob/main/scripts/qq_parser.py)).
Tencent does not publish the HTML schema. The file is MIME (`MIME-Version`,
`text/html` part); after tags are stripped, each message is
`昵称(QQ号) YYYY-MM-DD H:mm:ss` then the body. Hours may be one digit;
`上午` / `下午` are allowed.

- Sample (synthetic): `server/test-fixtures/exports/qq-mht/sample.mht`.

## telegram-json

Checked 2026-11-16 against the official
[Telegram Data Export Schema](https://core.telegram.org/import-export).
A single-chat file is `{ name, type, id, messages }`. A full takeout wraps
chats in `chats.list`. Each message has `date` (ISO, no zone) and
`date_unixtime` (unix seconds as a string); `from` / `from_id`; `text` as
a string or an ordered array of strings and `{ type, text }` entities;
`media_type` one of `sticker`, `voice_message`, `video_message`,
`video_file`, `animation`, `audio_file`; optional `photo`, `file`,
`sticker_emoji`, `duration_seconds`. Service rows use `type: "service"`
and `action` (`phone_call` becomes a call).

- Sample (synthetic): `server/test-fixtures/exports/telegram-json/sample.json`.

## whatsapp-txt

Checked 2026-11-16 against WhatsApp iOS/Android export chat
([Preserve Chat](https://preserve.chat/whatsapp-guides/whatsapp-chat-export-format/),
[starkdmi/whats_json](https://github.com/starkdmi/whats_json)).
iOS: `[D/M/Y, HH:mm:ss] Name: text`. Android: `D/M/Y, HH:mm - Name: text`.
Date order follows the file (day > 12 vs month > 12 vs a 4-digit year).
A header without `Name:` is a system message. Attachments are
`<attached: file>` or `file (file attached)`. Continuation lines have no
timestamp.

- Sample (synthetic): `server/test-fixtures/exports/whatsapp-txt/sample.txt`.

## line-txt

Checked 2026-11-16 against LINE Help Center
([Backing up chats as text files](https://help.line.me/line/smartphone/?contentId=20007388))
and recorded exports
([LINE_record2datatable](https://github.com/littlefish0331/LINE_record2datatable)).
A date heading (`YYYY/M/D（weekday）` or `Fri, M/D/YYYY`) is followed by
`HH:mm<TAB>name<TAB>content`. Japanese files put `上午` / `下午` in the
time field. Bodies with line breaks are wrapped in double quotes.

- Sample (synthetic): `server/test-fixtures/exports/line-txt/sample.txt`.
- Known limit: the file has no seconds; roundtrip compares times to the minute.

## kakao-txt

Checked 2026-11-16 against recorded KakaoTalk exports
([talkinsight](https://talkinsight.kr/guide/export-file-format.html),
[TalkCut](https://talkcut.kr/en/use-cases/export-text)).
Mobile: `YYYY. M. D. 오전 H:mm, Name : text`. PC: a `YYYY년 M월 D일`
rule then `[Name] [오전 H:mm] text`. Mac: CSV `Date,User,Message`.
Continuation lines have no clock.

- Sample (synthetic): `server/test-fixtures/exports/kakao-txt/sample.txt`.
- Known limit: the clock has no seconds; roundtrip compares times to the minute.

## meta-json

Checked 2026-11-16 against Instagram / Messenger data downloads
([latin1 mojibake](https://stackoverflow.com/questions/50008296/facebook-json-badly-encoded)).
A thread is `{ participants, messages }`. Each message has `sender_name`,
`timestamp_ms`, optional `content`, `photos`, `audio_files`, `videos`,
`share`. UTF-8 bytes were stored as latin1; the importer restores them
with `Buffer.from(s, "latin1").toString("utf8")`. The array is newest
first; records are sorted oldest first.

- Sample (synthetic): `server/test-fixtures/exports/meta-json/sample.json`.
