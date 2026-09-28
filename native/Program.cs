using System;
using System.IO;
using System.Text;
using System.Linq;
using System.Drawing;
using System.Windows.Forms;
using System.Collections.Generic;
using System.Web.Script.Serialization;
using System.Threading.Tasks;
using System.Runtime.InteropServices;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace Moye {
    static class Program {
        [DllImport("user32.dll")] static extern bool SetProcessDPIAware();
        [STAThread] static void Main(string[] args) {
            SetProcessDPIAware();
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            Application.ThreadException += (s, e) => MessageBox.Show(e.Exception.Message, "墨页", MessageBoxButtons.OK, MessageBoxIcon.Error);
            Application.Run(new EditorWindow(args.FirstOrDefault(a => !a.StartsWith("--"))));
        }
    }
    sealed class EditorWindow : Form {
        readonly WebView2 view = new WebView2();
        readonly JavaScriptSerializer json = new JavaScriptSerializer { MaxJsonLength = Int32.MaxValue };
        readonly string dataDir;
        readonly string initialPath;
        readonly List<string> recent = new List<string>();
        Document doc = new Document();
        bool ready, busy, closingAllowed, closePending, hasDocument;
        string imageRoot;
        string imageToken = Guid.NewGuid().ToString("N");
        const string AppOrigin = "https://app.moye.local/";
        public EditorWindow(string path) {
            initialPath = path;
            dataDir = Environment.GetEnvironmentVariable("MOYE_DATA_DIR") ?? System.IO.Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Moye");
            Text = "墨页 · Markdown 编辑器";
            AutoScaleMode = AutoScaleMode.None;
            float scale;
            using (var graphics = Graphics.FromHwnd(IntPtr.Zero)) scale = graphics.DpiX / 96f;
            var available = Screen.PrimaryScreen.WorkingArea;
            ClientSize = new Size(Math.Min((int)(1240 * scale), available.Width - (int)(60 * scale)), Math.Min((int)(820 * scale), available.Height - (int)(80 * scale)));
            MinimumSize = new Size(Math.Min((int)(820 * scale), available.Width), Math.Min((int)(580 * scale), available.Height));
            StartPosition = FormStartPosition.CenterScreen;
            BackColor = Color.FromArgb(250, 249, 246);
            var iconPath = System.IO.Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "moye.ico");
            if (File.Exists(iconPath)) Icon = new Icon(iconPath);
            view.Dock = DockStyle.Fill;
            view.DefaultBackgroundColor = BackColor;
            Controls.Add(view);
            Shown += async (s, e) => await Initialize();
            FormClosing += OnClosing;
            Activated += (s, e) => { if (ready && hasDocument && !busy) CheckExternal(); };
        }
        async Task Initialize() {
            try {
                Directory.CreateDirectory(dataDir);
                LoadRecent();
                var options = new CoreWebView2EnvironmentOptions("--disable-background-networking --disable-component-update --disable-sync --no-first-run --no-default-browser-check --disable-features=msEdgeShoppingAssistant,msEdgeSidebarV2");
                var environment = await CoreWebView2Environment.CreateAsync(null, System.IO.Path.Combine(dataDir, "WebView2"), options);
                await view.EnsureCoreWebView2Async(environment);
                var core = view.CoreWebView2;
                core.Settings.AreDevToolsEnabled = Environment.GetEnvironmentVariable("MOYE_DEVTOOLS") == "1";
                core.Settings.AreDefaultContextMenusEnabled = false;
                core.Settings.AreBrowserAcceleratorKeysEnabled = false;
                core.Settings.IsStatusBarEnabled = false;
                core.Settings.IsZoomControlEnabled = false;
                core.Settings.IsGeneralAutofillEnabled = false;
                core.Settings.IsPasswordAutosaveEnabled = false;
                core.Settings.IsBuiltInErrorPageEnabled = false;
                core.Settings.IsPinchZoomEnabled = false;
                core.Profile.PreferredColorScheme = CoreWebView2PreferredColorScheme.Light;
                core.SetVirtualHostNameToFolderMapping("app.moye.local", System.IO.Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "ui"), CoreWebView2HostResourceAccessKind.DenyCors);
                core.AddWebResourceRequestedFilter("*", CoreWebView2WebResourceContext.All);
                core.WebResourceRequested += ResourceRequested;
                core.NavigationStarting += (s, e) => { if (!e.Uri.StartsWith(AppOrigin, StringComparison.OrdinalIgnoreCase)) e.Cancel = true; };
                core.NewWindowRequested += (s, e) => { e.Handled = true; Notify("外部链接不会在墨页中联网打开。"); };
                core.PermissionRequested += (s, e) => e.State = CoreWebView2PermissionState.Deny;
                core.DownloadStarting += (s, e) => e.Cancel = true;
                core.WebMessageReceived += MessageReceived;
                core.ProcessFailed += (s, e) => MessageBox.Show(this, "显示进程遇到问题。请关闭并重新打开墨页；关闭时仍可保存最近收到的修改。", "墨页", MessageBoxButtons.OK, MessageBoxIcon.Warning);
                core.Navigate(AppOrigin + "index.html");
            } catch (Exception ex) {
                MessageBox.Show(this, "无法启动编辑器。需要 Windows .NET Framework 4.8 和 Microsoft Edge WebView2 Runtime。\n\n" + ex.Message, "墨页", MessageBoxButtons.OK, MessageBoxIcon.Error);
                closingAllowed = true;
                Close();
            }
        }
        void ResourceRequested(object sender, CoreWebView2WebResourceRequestedEventArgs e) {
            Uri uri;
            if (!Uri.TryCreate(e.Request.Uri, UriKind.Absolute, out uri)) return;
            if (uri.Scheme == "https" && uri.Host == "app.moye.local") return;
            if (uri.Scheme == "data" || uri.Scheme == "blob") return;
            if (uri.Scheme == "https" && uri.Host == "document.moye.local" && imageRoot != null) {
                try {
                    string prefix = "/" + imageToken + "/";
                    if (!uri.AbsolutePath.StartsWith(prefix, StringComparison.Ordinal)) throw new IOException();
                    string relative = Uri.UnescapeDataString(uri.AbsolutePath.Substring(prefix.Length)).Replace('/', System.IO.Path.DirectorySeparatorChar);
                    string file = System.IO.Path.GetFullPath(System.IO.Path.Combine(imageRoot, relative));
                    // Only images underneath the opened document's folder can be rendered.
                    string root = imageRoot.TrimEnd('\\') + "\\";
                    if (!file.StartsWith(root, StringComparison.OrdinalIgnoreCase)) throw new IOException();
                    var types = new Dictionary<string, string> { { ".png", "image/png" }, { ".jpg", "image/jpeg" }, { ".jpeg", "image/jpeg" }, { ".gif", "image/gif" }, { ".webp", "image/webp" }, { ".bmp", "image/bmp" }, { ".avif", "image/avif" }, { ".svg", "image/svg+xml" } };
                    string mime;
                    if (!types.TryGetValue(System.IO.Path.GetExtension(file).ToLowerInvariant(), out mime)) throw new IOException();
                    if (new FileInfo(file).Length > 32 * 1024 * 1024) throw new IOException();
                    // Do not follow junctions/symlinks outside the allowed image directory.
                    string check = file;
                    while (check != null && check.Length >= imageRoot.Length) {
                        if ((File.GetAttributes(check) & FileAttributes.ReparsePoint) != 0) throw new IOException();
                        check = System.IO.Path.GetDirectoryName(check);
                    }
                    e.Response = view.CoreWebView2.Environment.CreateWebResourceResponse(new MemoryStream(File.ReadAllBytes(file)), 200, "OK", "Content-Type: " + mime + "\r\nAccess-Control-Allow-Origin: https://app.moye.local\r\nCache-Control: no-store\r\nContent-Security-Policy: default-src 'none'; style-src 'unsafe-inline'; sandbox\r\nX-Content-Type-Options: nosniff");
                    return;
                } catch { }
            }
            e.Response = view.CoreWebView2.Environment.CreateWebResourceResponse(new MemoryStream(), 403, "Offline", "Content-Type: text/plain");
        }
        string Get(Dictionary<string, object> message, string key) { object value; return message.TryGetValue(key, out value) && value != null ? value.ToString() : ""; }
        async void MessageReceived(object sender, CoreWebView2WebMessageReceivedEventArgs e) {
            if (!e.Source.StartsWith(AppOrigin, StringComparison.OrdinalIgnoreCase)) return;
            try {
                var m = json.Deserialize<Dictionary<string, object>>(e.WebMessageAsJson);
                string type = Get(m, "type");
                if (type == "ready") {
                    ready = true;
                    Post(new { type = "recent", paths = recent.ToArray() });
                    if (initialPath != null) OpenFile(initialPath, 0);
                    return;
                }
                if (type == "change") { doc.Text = Get(m, "content"); UpdateTitle(); return; }
                if (type == "clipboardRead" || type == "clipboardWrite") { HandleClipboard(type, m); return; }
                if (busy) return;
                busy = true;
                try {
                    if (m.ContainsKey("content")) doc.Text = Get(m, "content");
                    switch (type) {
                        case "new": if (ConfirmUnsaved()) { doc = new Document(); hasDocument = true; SendDocument(); } break;
                        case "open":
                            using (var picker = new OpenFileDialog { Filter = "Markdown 文件|*.md;*.markdown;*.mdown;*.mkd;*.mkdn;*.mdwn;*.mdtext;*.rmd;*.qmd;*.mdx|文本文件|*.txt|所有文件|*.*", Title = "打开 Markdown 文件", CheckFileExists = true }) {
                                if (picker.ShowDialog(this) == DialogResult.OK && ConfirmUnsaved()) OpenFile(picker.FileName, 0);
                            } break;
                        case "openRecent": { string path = Get(m, "path"); if (recent.Contains(path) && ConfirmUnsaved()) OpenFile(path, 0); } break;
                        case "drop":
                            var dropped = e.AdditionalObjects.FirstOrDefault() as CoreWebView2File;
                            if (dropped != null && ConfirmUnsaved()) OpenFile(dropped.Path, 0);
                            break;
                        case "save": Save(false); break;
                        case "saveAs": Save(true); break;
                        case "rename":
                            try {
                                string oldPath = doc.Path;
                                doc.Rename(Get(m, "name"));
                                if (doc.Path != null) {
                                    recent.RemoveAll(p => String.Equals(p, oldPath, StringComparison.OrdinalIgnoreCase));
                                    AddRecent(doc.Path);
                                }
                                UpdateTitle();
                                Post(new { type = "renamed", name = doc.Name, path = doc.Path });
                            } catch (Exception ex) { Post(new { type = "renameError", message = ex.Message }); }
                            break;
                        case "reopen":
                            int cp; if (doc.Path != null && Int32.TryParse(Get(m, "codePage"), out cp) && new[] { 65001, 54936, 1252 }.Contains(cp) && ConfirmUnsaved()) OpenFile(doc.Path, cp);
                            break;
                        case "reload": if (doc.Path != null && ConfirmUnsaved()) OpenFile(doc.Path, 0); break;
                        case "reveal": if (doc.Path != null) System.Diagnostics.Process.Start("explorer.exe", "/select,\"" + doc.Path + "\""); break;
                        case "close": Close(); break;
                    }
                } finally { busy = false; }
            } catch (Exception ex) { ShowError(ex); }
            await Task.CompletedTask;
        }
        void HandleClipboard(string type, Dictionary<string, object> message) {
            string id = Get(message, "id");
            try {
                if (type == "clipboardWrite") {
                    string text = Get(message, "text");
                    if (text.Length > 0) {
                        var data = new DataObject();
                        data.SetData(DataFormats.UnicodeText, text);
                        Clipboard.SetDataObject(data, true, 5, 40);
                    }
                    Post(new { type = "clipboardResult", id = id, ok = true });
                } else {
                    var data = Clipboard.GetDataObject();
                    string text = data != null && data.GetDataPresent(DataFormats.UnicodeText) ? data.GetData(DataFormats.UnicodeText) as string : "";
                    string html = data != null && data.GetDataPresent(DataFormats.Html) ? data.GetData(DataFormats.Html) as string : "";
                    Post(new { type = "clipboardResult", id = id, ok = true, text = text ?? "", html = html ?? "" });
                }
            } catch { Post(new { type = "clipboardResult", id = id, ok = false, message = "剪贴板暂时不可用，请稍后重试。" }); }
        }
        void OpenFile(string path, int cp) {
            var opened = Document.Read(path, cp);
            doc = opened;
            hasDocument = true;
            AddRecent(doc.Path);
            SendDocument();
        }
        void SendDocument() {
            imageRoot = doc.Path == null ? null : System.IO.Path.GetDirectoryName(doc.Path);
            imageToken = Guid.NewGuid().ToString("N");
            Post(new { type = "document", content = doc.Text, name = doc.Name, path = doc.Path, encoding = doc.EncodingLabel, newline = NewlineLabel(), imageBase = imageRoot == null ? null : "https://document.moye.local/" + imageToken + "/" });
            UpdateTitle();
        }
        string NewlineLabel() { return doc.Newline == "\r\n" ? "CRLF" : doc.Newline == "\n" ? "LF" : "CR"; }
        bool ConfirmUnsaved() {
            if (!doc.Dirty) return true;
            var choice = MessageBox.Show(this, "是否保存对「" + doc.Name + "」的修改？\n\n是：保存后继续\n否：放弃修改\n取消：返回编辑", "还有未保存的文字", MessageBoxButtons.YesNoCancel, MessageBoxIcon.Question);
            return choice == DialogResult.No || (choice == DialogResult.Yes && Save(false));
        }
        bool Save(bool saveAs) {
            string destination = doc.Path;
            if (!saveAs && destination != null && doc.DiskChanged()) {
                var answer = MessageBox.Show(this, "原文件已被其他程序修改或移走。\n\n是：用当前文字覆盖原文件\n否：另存一份，保留外部修改\n取消：返回编辑", "文件发生了变化", MessageBoxButtons.YesNoCancel, MessageBoxIcon.Warning);
                if (answer == DialogResult.Cancel) return false;
                if (answer == DialogResult.No) saveAs = true;
            }
            if (saveAs || destination == null) {
                using (var picker = new SaveFileDialog { Filter = "Markdown 文件 (*.md)|*.md|Markdown 文件 (*.markdown)|*.markdown|所有文件|*.*", FileName = doc.Name, DefaultExt = "md", AddExtension = true, OverwritePrompt = true, Title = "另存 Markdown 文件" }) {
                    if (destination != null) picker.InitialDirectory = System.IO.Path.GetDirectoryName(destination);
                    if (picker.ShowDialog(this) != DialogResult.OK) return false;
                    destination = picker.FileName;
                }
            }
            try {
                try { doc.Save(destination); }
                catch (EncoderFallbackException) {
                    if (MessageBox.Show(this, "新输入的字符无法用原编码保存。是否改用 UTF-8 保存？", "保存编码", MessageBoxButtons.OKCancel, MessageBoxIcon.Question) != DialogResult.OK) return false;
                    var previousEncoding = doc.Encoding;
                    bool previousBom = doc.Bom;
                    try { doc.Encoding = new UTF8Encoding(false, true); doc.Bom = false; doc.Save(destination); }
                    catch { doc.Encoding = previousEncoding; doc.Bom = previousBom; throw; }
                }
                hasDocument = true;
                imageRoot = System.IO.Path.GetDirectoryName(doc.Path);
                AddRecent(doc.Path);
                Post(new { type = "saved", content = doc.SavedText, name = doc.Name, path = doc.Path, encoding = doc.EncodingLabel, newline = NewlineLabel(), imageBase = "https://document.moye.local/" + imageToken + "/" });
                UpdateTitle();
                return true;
            } catch (Exception ex) { ShowError(ex); return false; }
        }
        async void OnClosing(object sender, FormClosingEventArgs e) {
            if (closingAllowed) return;
            e.Cancel = true;
            if (closePending) return;
            closePending = true;
            try {
                if (ready) {
                    try {
                        string result = await view.CoreWebView2.ExecuteScriptAsync("window.moye ? window.moye.content() : null");
                        var text = json.Deserialize<string>(result);
                        if (text != null) doc.Text = text;
                    } catch { /* Native copy still contains the most recently received edit. */ }
                }
                if (ConfirmUnsaved()) { closingAllowed = true; BeginInvoke(new Action(Close)); }
            } catch (Exception ex) { ShowError(ex); }
            finally { closePending = false; }
        }
        void CheckExternal() { try { Post(new { type = "external", changed = doc.DiskChanged() }); } catch { Post(new { type = "external", changed = true }); } }
        void Post(object value) { if (view.CoreWebView2 != null) view.CoreWebView2.PostWebMessageAsJson(json.Serialize(value)); }
        void Notify(string message) { Post(new { type = "notice", message = message }); }
        void ShowError(Exception ex) { MessageBox.Show(this, ex.Message + "\n\n当前文字仍保留在编辑器中。", "操作未完成", MessageBoxButtons.OK, MessageBoxIcon.Warning); }
        void UpdateTitle() { Text = (doc.Dirty ? "● " : "") + (hasDocument ? doc.Name + " — " : "") + "墨页"; }
        void LoadRecent() {
            try { var list = json.Deserialize<string[]>(File.ReadAllText(System.IO.Path.Combine(dataDir, "recent.json"))); if (list != null) recent.AddRange(list.Where(File.Exists).Take(8)); } catch { }
        }
        void AddRecent(string path) {
            recent.RemoveAll(p => String.Equals(p, path, StringComparison.OrdinalIgnoreCase)); recent.Insert(0, path);
            if (recent.Count > 8) recent.RemoveRange(8, recent.Count - 8);
            try { Document.AtomicWrite(System.IO.Path.Combine(dataDir, "recent.json"), Encoding.UTF8.GetBytes(json.Serialize(recent))); } catch { }
            Post(new { type = "recent", paths = recent.ToArray() });
        }
    }
}
