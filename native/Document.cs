using System;
using System.IO;
using System.Text;
using System.Linq;
using System.Security.Cryptography;

namespace Moye {
    public sealed class Document {
        public string Path;
        public string SuggestedName = "未命名.md";
        public string Text = "";
        public string SavedText = "";
        public string Newline = "\r\n";
        public Encoding Encoding = new UTF8Encoding(false, true);
        public bool Bom;
        public byte[] OriginalBytes;
        public string DiskHash;
        public bool Dirty { get { return Text != SavedText; } }
        public string Name { get { return Path == null ? SuggestedName : System.IO.Path.GetFileName(Path); } }
        public string EncodingLabel {
            get { return Encoding.CodePage == 65001 ? (Bom ? "UTF-8 BOM" : "UTF-8") :
                Encoding.CodePage == 1200 ? "UTF-16 LE" : Encoding.CodePage == 1201 ? "UTF-16 BE" :
                Encoding.CodePage == 54936 ? "GB18030" : Encoding.WebName.ToUpperInvariant(); }
        }
        public static string Normalize(string value) { return value.Replace("\r\n", "\n").Replace("\r", "\n"); }
        public static string Hash(byte[] bytes) {
            using (var sha = SHA256.Create()) return Convert.ToBase64String(sha.ComputeHash(bytes));
        }
        static bool Starts(byte[] bytes, params byte[] prefix) {
            return bytes.Length >= prefix.Length && prefix.Where((b, i) => bytes[i] != b).Count() == 0;
        }
        public static Document Read(string path, int codePage) {
            path = System.IO.Path.GetFullPath(path);
            var info = new FileInfo(path);
            if (info.Length > 64 * 1024 * 1024) throw new IOException("文件超过 64 MB，暂不支持打开这么大的文档。");
            var bytes = File.ReadAllBytes(path);
            var doc = new Document { Path = path, OriginalBytes = bytes, DiskHash = Hash(bytes) };
            int skip = 0;
            if (Starts(bytes, 0xff, 0xfe, 0x00, 0x00)) { doc.Encoding = new UTF32Encoding(false, true, true); skip = 4; }
            else if (Starts(bytes, 0x00, 0x00, 0xfe, 0xff)) { doc.Encoding = new UTF32Encoding(true, true, true); skip = 4; }
            else if (Starts(bytes, 0xef, 0xbb, 0xbf)) { doc.Encoding = new UTF8Encoding(true, true); skip = 3; }
            else if (Starts(bytes, 0xff, 0xfe)) { doc.Encoding = new UnicodeEncoding(false, true, true); skip = 2; }
            else if (Starts(bytes, 0xfe, 0xff)) { doc.Encoding = new UnicodeEncoding(true, true, true); skip = 2; }
            doc.Bom = skip > 0;
            if (codePage > 0 && skip == 0)
                doc.Encoding = Encoding.GetEncoding(codePage, EncoderFallback.ExceptionFallback, DecoderFallback.ExceptionFallback);
            string text;
            try { text = doc.Encoding.GetString(bytes, skip, bytes.Length - skip); }
            catch (DecoderFallbackException) {
                if (skip > 0 || codePage > 0) throw new IOException("此文件无法按所选编码读取。原文件没有被修改。");
                doc.Encoding = Encoding.GetEncoding(54936, EncoderFallback.ExceptionFallback, DecoderFallback.ExceptionFallback);
                text = doc.Encoding.GetString(bytes);
            }
            if (text.Contains("\0")) throw new IOException("文件包含空字符，可能是二进制文件或无 BOM 的 UTF-16 文件。请使用带 BOM 的 Unicode 文本。");
            int crlf = 0, lf = 0, cr = 0;
            for (int i = 0; i < text.Length; i++) {
                if (text[i] == '\r') { if (i + 1 < text.Length && text[i + 1] == '\n') { crlf++; i++; } else cr++; }
                else if (text[i] == '\n') lf++;
            }
            doc.Newline = crlf >= lf && crlf >= cr ? "\r\n" : lf >= cr ? "\n" : "\r";
            doc.Text = doc.SavedText = Normalize(text);
            return doc;
        }
        public bool DiskChanged() {
            return Path != null && (!File.Exists(Path) || Hash(File.ReadAllBytes(Path)) != DiskHash);
        }
        public byte[] GetBytes() {
            if (OriginalBytes != null && Text == SavedText) return OriginalBytes;
            byte[] body = Encoding.GetBytes(Text.Replace("\n", Newline));
            byte[] preamble = Bom ? Encoding.GetPreamble() : new byte[0];
            return preamble.Concat(body).ToArray();
        }
        public void Save(string destination) {
            destination = System.IO.Path.GetFullPath(destination);
            byte[] bytes = GetBytes();
            AtomicWrite(destination, bytes);
            Path = destination;
            OriginalBytes = bytes;
            DiskHash = Hash(bytes);
            SavedText = Text;
        }
        public void Rename(string name) {
            if (String.IsNullOrWhiteSpace(name) || name != name.Trim() || name.EndsWith(".") || name.Length > 255 ||
                name.IndexOfAny(System.IO.Path.GetInvalidFileNameChars()) >= 0)
                throw new IOException("请输入有效的文件名，不能包含路径、特殊字符或末尾的空格、句点。");
            string stem = name.Split('.')[0].TrimEnd(' ');
            if (System.Text.RegularExpressions.Regex.IsMatch(stem, @"^(CON|PRN|AUX|NUL|COM[1-9¹²³]|LPT[1-9¹²³])$", System.Text.RegularExpressions.RegexOptions.IgnoreCase))
                throw new IOException("这个名称是 Windows 保留名称，请换一个文件名。");
            if (String.IsNullOrEmpty(System.IO.Path.GetExtension(name))) {
                string extension = System.IO.Path.GetExtension(Name);
                name += String.IsNullOrEmpty(extension) ? ".md" : extension;
            }
            if (name.Length > 255) throw new IOException("文件名太长，请缩短后重试。");
            if (Path == null) { SuggestedName = name; return; }
            string destination = System.IO.Path.Combine(System.IO.Path.GetDirectoryName(Path), name);
            if (String.Equals(Path, destination, StringComparison.Ordinal)) return;
            if (!String.Equals(Path, destination, StringComparison.OrdinalIgnoreCase) && (File.Exists(destination) || Directory.Exists(destination)))
                throw new IOException("同一文件夹里已经有这个名称。原文件没有被修改，请换一个名字。");
            // Move the on-disk file only. Unsaved text, encoding, disk hash and undo history stay intact.
            File.Move(Path, destination);
            Path = destination;
        }
        public static void AtomicWrite(string destination, byte[] bytes) {
            string temp = System.IO.Path.Combine(System.IO.Path.GetDirectoryName(destination), ".moye-" + Guid.NewGuid().ToString("N") + ".tmp");
            try {
                using (var stream = new FileStream(temp, FileMode.CreateNew, FileAccess.Write, FileShare.None)) {
                    stream.Write(bytes, 0, bytes.Length);
                    stream.Flush(true);
                }
                if (File.Exists(destination)) File.Replace(temp, destination, null);
                else File.Move(temp, destination);
            } finally { if (File.Exists(temp)) File.Delete(temp); }
        }
    }
}
