> 该文件由 AI：Claude/莫奈生成

# 单词镜头 · 网页版

拍一页书，把上面的英文单词按阅读顺序列出来，点一下就念给你听。
支持英音/美音，带音标、中文释义、考试范围和词形变化。

**纯前端，不需要服务器**：识别用的是浏览器里的 Tesseract.js，词典打在包里，
第一次打开之后完全离线可用。

## 怎么用

1. 打开网页
2. 点「拍照」或「相册」，选一页英语书
3. 等几秒，单词会按书上的顺序列出来
4. 点单词听发音，点「英音/美音」换口音
5. **长按单词**看完整释义（英文释义、考试范围、词形变化、柯林斯词频）

### 装到手机桌面

- **iPhone（Safari）**：分享按钮 → 添加到主屏幕
- **安卓（Chrome）**：右上角菜单 → 添加到主屏幕

装完之后就像个 App，有自己的图标，打开是全屏的。

## 和原生版的差别

| | 原生 App | 网页版 |
|---|---|---|
| 识别引擎 | Apple Vision / Google ML Kit | Tesseract.js |
| 速度 | 1 秒内 | 5~15 秒 |
| 准确率 | 高 | 中等（书页有插图时更差） |
| 分发 | App Store / APK | 一个链接 |

**识别慢和不准是这个方案绕不过去的代价**：苹果和谷歌的识别引擎只给原生 App 用，
网页碰不到。

## 技术说明

| 文件 | 作用 |
|---|---|
| `index.html` | 页面骨架 |
| `styles.css` | 样式（深色主题） |
| `app.js` | 界面、状态、拍照、发音、生词本、历史 |
| `reading-order.js` | 把带坐标的文本块还原成阅读顺序（分栏 + 分行） |
| `dictionary.js` | 解析本地词典 TSV |
| `dictionary.tsv` | 53513 词条，来自 ECDICT |
| `vendor/` | Tesseract.js 引擎和英文模型 |
| `sw.js` | Service Worker，负责离线缓存 |

- 发音用浏览器自带的 `speechSynthesis`，`lang` 分别是 `en-GB` / `en-US`
- 生词本和历史存在 `localStorage`，不上传
- 历史最多保留 50 条

## 数据来源

离线英汉词典基于开源项目 [ECDICT](https://github.com/skywind3000/ECDICT) 整理，
按 MIT 许可证使用。

```
MIT License

Copyright (c) 2025 Linwei  (ECDICT 词库)
Copyright (c) 2022 Yan     (npm 打包 ecdict)
```

识别引擎是 [Tesseract.js](https://github.com/naptha/tesseract.js)（Apache-2.0）。

---

> 该文件由 AI：Claude/莫奈生成
