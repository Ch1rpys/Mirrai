# 完整备份与还原

一份备份是一个文件：所有分身、对话、记忆、信、记录和上传的文件，加上一份清单（每个部分的条数与 SHA-256）。设了口令时整个文件是加密的。

备份分成两种范围：

- **整个实例**：命令行默认的范围，包含数据库里的全部账号。适合换机器、整个搬走。
- **一个用户**：界面上「下载完整备份」的范围，只包含这个账号自己的数据。多账号实例上，一个人不能拿走另一个人的对话。

## 从界面备份

设置 → 数据 → 完整备份：

- 「下载完整备份」要填一个口令（至少 8 个字符），下载下来是加密的 `.mirrai-backup` 文件。
- 「定时备份」默认关。打开后选一个目标：本机的一个文件夹、自己的 WebDAV、或 S3 兼容存储。每天或每周一次，保留最近 7 份。

口令忘了就打不开备份，**没有找回的办法**。请把口令和备份文件分开放。

## 从命令行备份

```bash
# 整个实例，加密
node node_modules/tsx/dist/cli.mjs scripts/backup.ts create --out ~/mirrai-backup.mirrai-backup \
  --passphrase-file ~/.mirrai-backup-passphrase

# 只备份一个用户（--user 后面是 users.id）
node node_modules/tsx/dist/cli.mjs scripts/backup.ts create --out ~/one-user.mirrai-backup --user 1 \
  --passphrase-file ~/.mirrai-backup-passphrase

# 检查一份备份是否完整（分层校验每个部分的哈希，不写任何东西）
node node_modules/tsx/dist/cli.mjs scripts/backup.ts verify --in ~/mirrai-backup.mirrai-backup \
  --passphrase-file ~/.mirrai-backup-passphrase
```

不带 `--passphrase-file` 时写出的是不加密的普通 `.zip`。远端目标必须加密，界面会拒绝把定时备份打开到这个状态。

口令不接收命令行参数：那会进 shell 历史。用 `--passphrase-file` 指一个只有自己能读的文件。

## 还原

**只支持还原到一个空实例**：数据库里还没有任何账号。把一个实例的数据并进另一个已有实例（重新编号、修所有引用）这一阶段不做。

```bash
DATABASE_URL=postgresql://<用户>@localhost:5432/<库> \
  node node_modules/tsx/dist/cli.mjs scripts/backup.ts restore --in ~/mirrai-backup.mirrai-backup \
  --passphrase-file ~/.mirrai-backup-passphrase
```

还原会：

1. 把备份解到临时目录，校验清单里每个部分的 SHA-256；
2. 拒绝来自更新版本的备份（备份的迁移版本比这份代码新时，列可能读不全）；
3. 拒绝非空实例；
4. 在一个事务里按表写入（保留原来的 id），把每张表的 id 序列推到最大 id 之后，把上传文件写回上传目录，最后补上迁移记录；
5. 任何一步失败：事务回滚，已经写出的文件删掉，临时目录删掉。

界面上的「从备份还原」用同一套逻辑，只在实例还没有账号时出现。默认安装第一次启动会自动建一个 `admin` 账号，所以多数情况下界面里看不到这条入口；要在这台机器上用界面还原，先以 `MIRRAI_BOOTSTRAP_ADMIN=manual` 启动，或者用上面的命令行。

## 加密

- 口令 → scrypt（N = 2^15, r = 8, p = 1）派生密钥，盐和参数写在文件头。
- AES-256-GCM，按 64 KiB 分帧，每帧自己的 nonce 和 tag；帧号是附加认证数据，换顺序或丢帧都会打不开。
- 口令错、文件被改一个字节，都会得到同一个错误：打不开。这是故意的——分不清是口令错还是文件坏，就不会泄露哪种猜测更接近。
- 定时备份用的口令由应用用 `JWT_SECRET` 派生的密钥包起来存在 `users.backupSettings` 里，所以无人值守时也能加密。换了 `JWT_SECRET` 之后这份包着的口令打不开：定时备份会停下并在设置里说明，需要重新填一次。

## 还原之后

- 用备份里的账号和密码登录。账号密码是加盐哈希，原样还原。
- **加密账号的实例**：备份里的内容是密文，`users.encryption` 的包装也在备份里。还原之后用原来的账号密码登录就能解开，什么都不用重设。详见 `docs/encryption.md`。
- 备份里的其他凭证（通道 token、模型 API key、SMTP 密码等）也是加密存的，加密密钥来自**原实例的 `JWT_SECRET`**。换机器还原时，如果 `JWT_SECRET` 变了，这些凭证要重新填一次。`.env` 里的 `JWT_SECRET` 请和备份一起保管好。
- 上传目录里的文件（照片、录音、导出包）在备份里，但它们**不在静态加密范围内**（C8.5）：备份文件本身加密了，还原到磁盘之后是普通文件。建议把数据目录放在系统级加密的磁盘上。

## 定时备份的目标

- **本机的一个文件夹**：iCloud 云盘、坚果云、Syncthing 的同步目录都只是一个文件夹，应用自己不联网。
- **WebDAV**：一次 `PUT`，基本认证。备份文件必须加密。
- **S3 兼容存储**：一次 `PUT`，SigV4 签名在应用里实现（不引入 AWS SDK），路径式地址（`<endpoint>/<bucket>/<key>`）。单个对象上限 5 GiB，超过会报错并建议改用文件夹。备份文件必须加密。

出站清单（`docs/egress.md`）里登记了这两项，默认关，只有用户自己打开定时备份并且到了那一天才会发请求。

## 备份里没有什么

- `schema_migrations`：安装记录，不是用户数据；还原会补上它。
- 已被彻底删除的回收站内容（30 天前的、删账号时清掉的行）：它们已经不在了。

## 数据在哪儿

备份文件里是 NDJSON（一行一个 JSON 对象）和原始上传文件。清单在 `manifest.json`，是压缩包里最后写入的一项——它带着前面每个部分的哈希，只能最后写。
