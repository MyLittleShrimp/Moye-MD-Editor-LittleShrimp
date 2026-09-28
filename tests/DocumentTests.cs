using System;
using System.IO;
using System.Linq;
using System.Text;
using Moye;
class DocumentTests {
    static int count;
    static string root;
    static void Check(bool ok, string name) { if (!ok) throw new Exception("FAIL: " + name); count++; Console.WriteLine("PASS: " + name); }
    static byte[] Encode(string text, Encoding enc) { return enc.GetPreamble().Concat(enc.GetBytes(text)).ToArray(); }
    static void RoundTrip(string name, Encoding encoding, bool bom, string newline) {
        string path = System.IO.Path.Combine(root, name + ".md");
        var original = (bom ? encoding.GetPreamble() : new byte[0]).Concat(encoding.GetBytes("# 中文文档" + newline + "第一行" + newline + "last")).ToArray();
        File.WriteAllBytes(path, original);
        var doc = Document.Read(path, 0);
        Check(doc.Text == "# 中文文档\n第一行\nlast", name + " decode/normalize");
        Check(!doc.Dirty && !doc.DiskChanged(), name + " clean state");
        string copy = System.IO.Path.Combine(root, name + " copy.md");
        doc.Save(copy);
        Check(File.ReadAllBytes(copy).SequenceEqual(original), name + " byte-exact Save As");
        Check(File.ReadAllBytes(path).SequenceEqual(original), name + " source untouched by Save As");
        doc.Text += "\n追加";
        Check(doc.Dirty, name + " dirty");
        doc.Save(copy);
        var expected = (bom ? encoding.GetPreamble() : new byte[0]).Concat(encoding.GetBytes("# 中文文档" + newline + "第一行" + newline + "last" + newline + "追加")).ToArray();
        Check(File.ReadAllBytes(copy).SequenceEqual(expected), name + " edit preserves encoding/BOM/newline");
        Check(!doc.Dirty && !doc.DiskChanged(), name + " saved state");
    }
    static int Main(string[] args) {
        try {
            root = System.IO.Path.GetFullPath(args[0]); Directory.CreateDirectory(root);
            RoundTrip("utf8-lf", new UTF8Encoding(false, true), false, "\n");
            RoundTrip("utf8-bom-crlf", new UTF8Encoding(true, true), true, "\r\n");
            RoundTrip("utf16-le", new UnicodeEncoding(false, true, true), true, "\r\n");
            RoundTrip("utf16-be", new UnicodeEncoding(true, true, true), true, "\n");
            RoundTrip("utf32-le", new UTF32Encoding(false, true, true), true, "\n");
            RoundTrip("utf32-be", new UTF32Encoding(true, true, true), true, "\n");
            RoundTrip("gb18030-cr", Encoding.GetEncoding(54936), false, "\r");
            string mixed = System.IO.Path.Combine(root, "mixed.md");
            File.WriteAllText(mixed, "first\r\nsecond\nthird\r", new UTF8Encoding(false));
            var mixedDoc = Document.Read(mixed, 0); var bytes = File.ReadAllBytes(mixed);
            mixedDoc.Save(mixed);
            Check(bytes.SequenceEqual(File.ReadAllBytes(mixed)), "unchanged mixed line endings preserved");
            mixedDoc.Text += "changed"; mixedDoc.Text = mixedDoc.SavedText;
            Check(!mixedDoc.Dirty, "undo back to saved content clears dirty");
            File.AppendAllText(mixed, "external"); Check(mixedDoc.DiskChanged(), "external write detected");
            string backupPath = System.IO.Path.Combine(root, "conflict copy.md"); mixedDoc.Save(backupPath);
            Check(File.ReadAllText(mixed).EndsWith("external"), "Save As preserves external changes");
            File.Delete(backupPath); Check(mixedDoc.DiskChanged(), "external deletion detected");
            string locked = System.IO.Path.Combine(root, "readonly.md"); File.WriteAllText(locked, "keep original");
            var lockedDoc = Document.Read(locked, 0); lockedDoc.Text = "changed"; File.SetAttributes(locked, FileAttributes.ReadOnly);
            bool failed = false; try { lockedDoc.Save(locked); } catch (UnauthorizedAccessException) { failed = true; }
            finally { File.SetAttributes(locked, FileAttributes.Normal); }
            Check(failed && File.ReadAllText(locked) == "keep original" && lockedDoc.Dirty, "failed save preserves original and unsaved edits");
            Check(!Directory.GetFiles(root, ".moye-*.tmp").Any(), "temporary files cleaned after failure");
            var newDoc = new Document(); newDoc.Text = "# emoji 😀\n\n正文\n";
            string emoji = System.IO.Path.Combine(root, "新建 emoji.md"); newDoc.Save(emoji);
            Check(Document.Read(emoji, 0).Text == newDoc.Text, "new Unicode file save/reopen");
            string cp1252 = System.IO.Path.Combine(root, "legacy.md"); File.WriteAllBytes(cp1252, Encoding.GetEncoding(1252).GetBytes("café €"));
            var legacy = Document.Read(cp1252, 1252); Check(legacy.Text == "café €", "explicit legacy encoding");
            legacy.Text += " 中文"; failed = false; try { legacy.Save(cp1252); } catch (EncoderFallbackException) { failed = true; }
            Check(failed && legacy.Dirty && Encoding.GetEncoding(1252).GetString(File.ReadAllBytes(cp1252)) == "café €", "unrepresentable characters cannot silently corrupt file");
            string binary = System.IO.Path.Combine(root, "binary.md"); File.WriteAllBytes(binary, new byte[] { 0, 0, 1, 2 });
            failed = false; try { Document.Read(binary, 0); } catch (IOException) { failed = true; }
            Check(failed, "binary content rejected");
            string empty = System.IO.Path.Combine(root, "empty.md"); File.WriteAllBytes(empty, new byte[0]);
            var emptyDoc = Document.Read(empty, 0); emptyDoc.Save(empty); Check(new FileInfo(empty).Length == 0, "empty file remains empty");
            string large = System.IO.Path.Combine(root, "large.md"); var largeDoc = new Document { Text = new string('中', 1000000) + "\nend" }; largeDoc.Save(large);
            Check(Document.Read(large, 0).Text == largeDoc.Text, "million-character document round trip");
            var unnamed = new Document(); unnamed.Rename("新的想法");
            Check(unnamed.Path == null && unnamed.Name == "新的想法.md", "name unsaved document without creating a file");
            string renameSource = System.IO.Path.Combine(root, "rename-source.markdown");
            File.WriteAllBytes(renameSource, Encode("# 原稿\r\n正文", new UTF8Encoding(true)));
            var renameDoc = Document.Read(renameSource, 0); byte[] renameBytes = File.ReadAllBytes(renameSource);
            renameDoc.Text += "\n未保存编辑"; renameDoc.Rename("新名称");
            Check(renameDoc.Name == "新名称.markdown" && !File.Exists(renameSource) && File.Exists(renameDoc.Path), "rename moves original file and retains extension");
            Check(File.ReadAllBytes(renameDoc.Path).SequenceEqual(renameBytes) && renameDoc.Dirty && renameDoc.Text.EndsWith("未保存编辑"), "rename preserves on-disk bytes and unsaved text separately");
            Check(!renameDoc.DiskChanged(), "rename keeps valid disk-change detection");
            string renamedPath = renameDoc.Path;
            File.WriteAllText(System.IO.Path.Combine(root, "exists.md"), "other document");
            failed = false; try { renameDoc.Rename("exists.md"); } catch (IOException) { failed = true; }
            Check(failed && renameDoc.Path == renamedPath && File.Exists(renamedPath) && File.ReadAllText(System.IO.Path.Combine(root, "exists.md")) == "other document", "collision never overwrites an existing file");
            foreach (string bad in new[] { "", "..", "../escape.md", "a\\b.md", "CON.md", "LPT1.txt", "name.", "name ", "bad:name.md" }) {
                failed = false; try { renameDoc.Rename(bad); } catch (IOException) { failed = true; }
                Check(failed && renameDoc.Path == renamedPath, "reject invalid rename: " + bad);
            }
            renameDoc.Rename("Case.md"); renameDoc.Rename("case.md");
            Check(renameDoc.Name == "case.md" && File.Exists(renameDoc.Path), "case-only rename works");
            File.AppendAllText(renameDoc.Path, "external"); renameDoc.Rename("external-renamed.md");
            Check(renameDoc.DiskChanged(), "rename never hides an external edit");
            Check(renameDoc.Dirty, "rename never marks unsaved content saved");
            Console.WriteLine("Native checks passed: " + count); return 0;
        } catch (Exception ex) { Console.Error.WriteLine(ex); return 1; }
    }
}
