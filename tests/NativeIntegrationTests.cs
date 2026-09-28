using System;
using System.IO;
using System.Text;
using System.Reflection;
using System.Threading.Tasks;
using System.Windows.Forms;
using Microsoft.Web.WebView2.WinForms;
using Moye;

class NativeIntegrationTests {
    static string root;
    static int checks;
    static bool running;
    static void Check(bool condition, string name) { if (!condition) throw new Exception(name); checks++; Console.WriteLine("PASS: " + name); }
    [STAThread] static void Main(string[] args) {
        root = System.IO.Path.GetFullPath(args[0]); Directory.CreateDirectory(root);
        Environment.SetEnvironmentVariable("MOYE_DATA_DIR", System.IO.Path.Combine(root, "profile"));
        string source = System.IO.Path.Combine(root, "original.md");
        File.WriteAllText(source, "# Native fixture\n\nKeep original", new UTF8Encoding(false));
        Application.EnableVisualStyles(); Application.SetCompatibleTextRenderingDefault(false);
        var form = new EditorWindow(source) { ShowInTaskbar = false, Opacity = 0 };
        var view = (WebView2)typeof(EditorWindow).GetField("view", BindingFlags.Instance | BindingFlags.NonPublic).GetValue(form);
        var timer = new System.Windows.Forms.Timer { Interval = 100 };
        var timeout = new System.Windows.Forms.Timer { Interval = 30000 };
        timeout.Tick += (s, e) => { Console.Error.WriteLine("Native integration timeout"); Environment.Exit(1); };
        timer.Tick += async (s, e) => {
            if (running || view.CoreWebView2 == null) return;
            running = true;
            try {
                if (await view.CoreWebView2.ExecuteScriptAsync("!!window.moye && document.querySelector('#file-name').textContent === 'original.md'") != "true") { running = false; return; }
                timer.Stop();
                Check(true, "real WebView2 bridge opens the fixture from disk");
                await view.CoreWebView2.ExecuteScriptAsync("window.chrome.webview.postMessage({type:'rename',name:'renamed.md',content:'# Native fixture\\n\\nUnsaved edit'});");
                await WaitFor(async () => File.Exists(System.IO.Path.Combine(root, "renamed.md")) && await view.CoreWebView2.ExecuteScriptAsync("document.querySelector('#file-name').textContent === 'renamed.md'") == "true");
                Check(!File.Exists(source), "rename moves the actual original file");
                Check(File.ReadAllText(System.IO.Path.Combine(root, "renamed.md")) == "# Native fixture\n\nKeep original", "rename preserves the original disk bytes before save");
                var document = (Document)typeof(EditorWindow).GetField("doc", BindingFlags.Instance | BindingFlags.NonPublic).GetValue(form);
                Check(document.Dirty && document.Text.EndsWith("Unsaved edit"), "native rename preserves unsaved edits");
                // Exercise clipboard operations through the same message bridge as the context menu.
                await view.CoreWebView2.ExecuteScriptAsync("window.testReplies=[];chrome.webview.addEventListener('message',e=>{if(e.data.type==='clipboardResult')window.testReplies.push(e.data)});chrome.webview.postMessage({type:'clipboardWrite',id:'write-test',text:'# Clipboard fixture'});");
                await WaitFor(async () => await view.CoreWebView2.ExecuteScriptAsync("window.testReplies.some(m=>m.id==='write-test' && m.ok)") == "true");
                await view.CoreWebView2.ExecuteScriptAsync("chrome.webview.postMessage({type:'clipboardRead',id:'read-test'});");
                await WaitFor(async () => await view.CoreWebView2.ExecuteScriptAsync("window.testReplies.some(m=>m.id==='read-test' && m.ok && m.text==='# Clipboard fixture')") == "true");
                Check(true, "native context-menu clipboard copy/paste round trip");
                // Native CF_HTML + real context-menu paste must preserve headings and emphasis.
                var clipboard = new DataObject();
                clipboard.SetData(DataFormats.UnicodeText, "Rich heading\nBold text");
                clipboard.SetData(DataFormats.Html, "Version:1.0\r\n<html><body><!--StartFragment--><h2>Rich heading</h2><p><strong>Bold text</strong></p><!--EndFragment--></body></html>");
                Clipboard.SetDataObject(clipboard, true, 5, 40);
                await view.CoreWebView2.ExecuteScriptAsync("document.querySelector('.cm-content').dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:350,clientY:220}));Array.from(document.querySelectorAll('#context-menu button')).find(b=>b.firstElementChild.textContent==='粘贴').click();");
                await WaitFor(async () => await view.CoreWebView2.ExecuteScriptAsync("window.moye.content().includes('## Rich heading') && window.moye.content().includes('**Bold text**')") == "true");
                Check(true, "native rich clipboard paste converts headings and bold to Markdown");
                await view.CoreWebView2.ExecuteScriptAsync("chrome.webview.postMessage({type:'save',content:window.moye.content()});");
                await WaitFor(() => Task.FromResult(!document.Dirty && File.ReadAllText(document.Path).Contains("## Rich heading")));
                Check(true, "converted paste saves to the renamed file");
                Console.WriteLine("Native integration checks passed: " + checks);
                timeout.Stop(); form.Close();
            } catch (Exception ex) { Console.Error.WriteLine(ex); Environment.Exit(1); }
        };
        timer.Start(); timeout.Start(); Application.Run(form);
    }
    static async Task WaitFor(Func<Task<bool>> condition) {
        for (int i = 0; i < 100; i++) { if (await condition()) return; await Task.Delay(50); }
        throw new Exception("Timed out waiting for native bridge result");
    }
}
