# Git Remote Push Guide

本文档记录本项目 `app/` 的本地提交与远程推送流程。

## 当前仓库信息

- 本地仓库目录：`app/`
- 远程仓库：`https://github.com/loaye1203/NexDock.git`
- 远程名：`origin`
- 当前分支：`master`
- 当前有效代理端口：`127.0.0.1:7890`

注意：本项目的 Git 仓库在 `app/` 内，不在外层初始化包根目录。

## 日常提交流程

进入项目目录：

```bash
cd "E:/vscode train/desk-app/electron-app-pack-1/app"
```

查看状态：

```bash
git -c safe.directory='E:/vscode train/desk-app/electron-app-pack-1/app' status --short --branch
```

暂存需要提交的文件：

```bash
git -c safe.directory='E:/vscode train/desk-app/electron-app-pack-1/app' add <file-or-folder>
```

示例：

```bash
git -c safe.directory='E:/vscode train/desk-app/electron-app-pack-1/app' add index.html main.js preload.js src package.json package-lock.json
```

提交到本地：

```bash
git -c safe.directory='E:/vscode train/desk-app/electron-app-pack-1/app' commit -m "feat: update electron app"
```

普通推送远程：

```bash
git -c safe.directory='E:/vscode train/desk-app/electron-app-pack-1/app' push
```

## 本项目成功推送远程的命令

如果普通 `push` 报网络错误，而浏览器可以打开 GitHub，说明 Git 可能没有走代理。使用一次性代理参数推送：

```bash
git -c safe.directory='E:/vscode train/desk-app/electron-app-pack-1/app' -c http.proxy=http://127.0.0.1:7890 -c https.proxy=http://127.0.0.1:7890 push
```

这个命令只对本次 push 生效，不会修改全局 Git 配置。

本次实际成功输出：

```text
To https://github.com/loaye1203/NexDock.git
   c0599da..997b5d4  master -> master
```

## 常见问题

### Failed to connect to github.com port 443

现象：

```text
Failed to connect to github.com port 443
Couldn't connect to server
```

处理：

1. 确认代理已经开启。
2. 确认 Git 是否配置了代理：

```bash
git config --global --get http.proxy
git config --global --get https.proxy
```

3. 如果没有配置代理，优先使用一次性代理 push：

```bash
git -c safe.directory='E:/vscode train/desk-app/electron-app-pack-1/app' -c http.proxy=http://127.0.0.1:7890 -c https.proxy=http://127.0.0.1:7890 push
```

### Connection was reset

现象：

```text
Recv failure: Connection was reset
```

处理：

- 等代理或网络稳定后重试。
- 如果普通 push 反复失败，使用一次性代理 push。

### Invalid username or token

现象：

```text
remote: Invalid username or token.
Password authentication is not supported for Git operations.
fatal: Authentication failed
```

处理：

1. 打开 Windows 凭据管理器。
2. 进入 Windows 凭据。
3. 删除和 `github.com` 或 `git:https://github.com` 相关的旧凭据。
4. 再次执行 push。
5. 如果弹出 GitHub 登录窗口，使用有远程仓库写入权限的账号授权。

### dubious ownership

现象：

```text
fatal: detected dubious ownership in repository
```

本项目使用临时参数规避：

```bash
git -c safe.directory='E:/vscode train/desk-app/electron-app-pack-1/app' status
```

如需永久处理，可由用户自行决定是否添加 Git 全局 safe.directory 配置。

## 不要提交的内容

这些内容应保持忽略状态：

```text
node_modules/
dist/
out/
build/
release/
*.log
.electron-direct.*.log
.local-test.*.log
.env
.env.*
```

提交前可以检查忽略状态：

```bash
git -c safe.directory='E:/vscode train/desk-app/electron-app-pack-1/app' status --ignored --short
```

## 安全规则

- 不使用 `git add .`，优先明确列出要提交的文件。
- 不提交 `node_modules/`、日志、构建产物或密钥文件。
- 不使用 `git push --force`，除非明确知道远程历史会被覆盖并已单独确认。
- 不把外层初始化包根目录当成 Electron 应用仓库。
