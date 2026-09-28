# 墨页介绍短片

- 成片：[moye-intro.mp4](moye-intro.mp4)
- 尺寸：1920 × 1080，16:9 横版
- 时长：约 40 秒（容器时长 39.62 秒），30 fps
- 编码：H.264 / AAC
- 内容：真实软件界面截图、中文动效字幕与背景音乐；使用作者提供的最终剪辑版本
- 封面：[promo-cover.jpg](../images/promo-cover.jpg)
- 参考字幕：[moye-intro.zh-CN.srt](moye-intro.zh-CN.srt)（原始 42 秒脚本，与现版剪辑时轴可能不同）
- 原始分镜：[STORYBOARD.md](STORYBOARD.md)

## 素材来源

所有软件画面由 `scripts/media/capture.mjs` 从项目自身的生产版前端捕获，使用 `examples/留一点空间，给文字.md` 和脚本内的公开演示文本。截图环境使用隔离的原生消息桥替身，只用于载入固定演示内容；文件系统与剪贴板的真实功能另由原生集成测试验证。

画面不包含用户桌面、私人文件或真实最近文件记录。它是经过剪辑和动效编排的软件介绍，不是完整、连续的桌面录屏。

当前发布视频由作者提供，使用作者确认的剪辑与配乐，按原始文件字节上传；校验值见 `video-info.json`。它与脚本生成的最初草稿不同。

原始草稿的音乐由 `scripts/media/render.py` 通过正弦波、谐波、音符包络和声像合成。字体调用 Windows 自带的 Microsoft YaHei；字体文件与 FFmpeg 二进制不随源码或素材分发。第三方 UI 依赖和字体保留其各自许可。

## 重新制作原始草稿

先完成项目依赖安装，再执行：

```powershell
npm.cmd run build
npm.cmd run media:capture
python -m pip install -r scripts/media/requirements.txt
python scripts/media/render.py --preview
python scripts/media/render.py
```

需要本机 Microsoft Edge。Python 脚本优先使用 PATH 中的 FFmpeg，也可使用 `imageio-ffmpeg`；可通过 `FFMPEG_BINARY` 指定编码器。字体可以通过 `MOYE_FONT_REGULAR`、`MOYE_FONT_BOLD`、`MOYE_FONT_LIGHT` 指向支持中文的本地字体。

中间画面、分镜预览、音频 WAV、编码日志与 42 秒原始草稿 `moye-intro-original.mp4` 位于 `.build/media/`，不提交仓库。脚本不会覆盖本目录下作者确认的发布成片。截图和封面位于 `docs/images/`。
