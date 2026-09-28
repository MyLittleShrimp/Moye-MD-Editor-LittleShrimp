# GitHub 发布准备

仓库：[MyLittleShrimp/Moye-MD-Editor-LittleShrimp](https://github.com/MyLittleShrimp/Moye-MD-Editor-LittleShrimp)。

仓库 About 简介可直接复制 [GITHUB_DESCRIPTION.txt](GITHUB_DESCRIPTION.txt)。

建议 Topics：`markdown`、`markdown-editor`、`windows`、`offline`、`local-first`、`webview2`、`codemirror`、`desktop-app`。

## 上传源码

优先使用项目目录的 Git 提交，或解压发布准备包里的 `moye-source.zip` 后上传其内容。源码包已包含 README 截图和宣传片。

```powershell
# 在源码目录执行；如果已有 Git 仓库，跳过 init
git init -b main
git add .
git status
git commit -m "Prepare Moye 1.1.0 for release"
# 首次连接远程仓库时执行；已经配置 origin 则跳过
git remote add origin https://github.com/MyLittleShrimp/Moye-MD-Editor-LittleShrimp.git
git push -u origin main
```

源码中不应提交：`node_modules/`、`.build/`、`dist/`、`release/`、`test-results/`、本机配置或私人文档。`.gitignore` 已排除这些目录。不要上传整个开发目录的无筛选压缩包。

## 发布下载包

1. 将仓库推送到 GitHub，检查 Actions 是否构建通过。
2. 在 Releases 创建 `v1.1.0`，附上 Windows x64 便携 ZIP 及 SHA-256 校验文件。
3. 从 [CHANGELOG](../CHANGELOG.md) 提取更新说明，标明 Windows / .NET Framework / WebView2 运行需求。
4. README 内的图片与短片使用相对路径，上传后无需替换用户名。视频若未直接播放，可在 Release 再附一份 MP4，便于下载。

自动构建只产出 Actions artifact，不会自动创建 Release 或发布任何仓库内容。

## 重新生成素材与发布准备包

```powershell
npm.cmd run build
node scripts/media/capture.mjs
# 视频环境、字体和编码器说明见 docs/media/README.md
python scripts/media/render.py
node scripts/export-source.mjs
# 已构建 release/Moye-1.1.0 后，生成源码 ZIP、便携 ZIP、视频副本和校验文件
python scripts/package-ready.py
```

`scripts/export-source.mjs` 通过固定白名单导出源码到 `release/github-ready/moye-source/`，并生成文件清单。它不会上传 GitHub，也不会更改任何远程仓库。

`scripts/package-ready.py` 支持 `--app-dir` 指向另一份已构建的便携目录。打包时会检查许可证和必需文件，并核对 ZIP 中包含 `.gitignore`、工作流、截图和视频。
