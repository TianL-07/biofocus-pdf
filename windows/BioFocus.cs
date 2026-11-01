using System;
using System.IO;
using System.Text;
using System.Linq;
using System.Collections.Generic;
using System.Security.Cryptography;
using System.Threading.Tasks;
using System.Net.Http;
using System.Web.Script.Serialization;
using System.Windows.Forms;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

static class Program {
    [STAThread] static void Main(string[] args) {
        Application.EnableVisualStyles(); Application.SetCompatibleTextRenderingDefault(false);
        if (args.Length == 2 && args[0] == "--self-test") { Environment.Exit(SelfTests.Run(args[1])); return; }
        if(args.Length==2&&args[0]=="--connection-status"){
            var data=Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),"BioFocus");
            using(var model=new ModelService(data))File.WriteAllText(args[1],new JavaScriptSerializer().Serialize(new {translator="OpenAI",model=model.Status()}));return;
        }
        Application.Run(new ReaderWindow(args.Contains("--configure")));
    }
}

sealed class ReaderWindow : Form {
    readonly WebView2 view = new WebView2();
    readonly JavaScriptSerializer json = new JavaScriptSerializer { MaxJsonLength = 40 * 1024 * 1024 };
    readonly string data = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "BioFocus");
    readonly string assets = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "app");
    readonly object gate = new object();
    readonly Dictionary<string, string> files = new Dictionary<string, string>();
    readonly Timer refresh = new Timer { Interval = 900 };
    FileSystemWatcher watcher;
    string folder;
    ModelService modelService;
    readonly bool configureOnStart;

    public ReaderWindow(bool configure=false) {
        configureOnStart=configure;
        Text = "BioFocus 0.4 · 专注阅读"; Width = 1460; Height = 970; MinimumSize = new System.Drawing.Size(940, 680);
        StartPosition = FormStartPosition.CenterScreen; BackColor = System.Drawing.Color.FromArgb(244, 243, 239);
        WindowState = FormWindowState.Maximized;
        view.Dock = DockStyle.Fill; Controls.Add(view);
        Shown += async (s,e) => { try { await Initialize(); } catch (Exception error) { MessageBox.Show("无法启动阅读器。请确认已安装 Microsoft Edge WebView2 Runtime。\n\n" + error.Message, "BioFocus"); } };
        FormClosed += (s,e) => { if(watcher != null) watcher.Dispose(); refresh.Dispose(); if(modelService!=null)modelService.Dispose(); };
        refresh.Tick += (s,e) => { refresh.Stop(); try { Push("library", Scan()); } catch {} };
    }

    async Task Initialize() {
        Directory.CreateDirectory(data);
        modelService=new ModelService(data);
        try { folder = json.Deserialize<Dictionary<string,object>>(File.ReadAllText(Path.Combine(data,"library.json")))["folder"].ToString(); } catch { folder = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory),"文献阅读"); }
        if(!Directory.Exists(folder)) folder = null;
        var env = await CoreWebView2Environment.CreateAsync(null, Path.Combine(data,"WebView"));
        await view.EnsureCoreWebView2Async(env);
        var core = view.CoreWebView2;
        core.SetVirtualHostNameToFolderMapping("biofocus.local",assets,CoreWebView2HostResourceAccessKind.DenyCors);
        core.Settings.AreHostObjectsAllowed = false;
        core.Settings.IsStatusBarEnabled = false;
        core.Settings.AreDevToolsEnabled = false;
        core.Settings.IsZoomControlEnabled = false;
        core.PermissionRequested += (s,e) => { e.State = CoreWebView2PermissionState.Deny; };
        core.NavigationStarting += (s,e) => { Uri url; if(!Uri.TryCreate(e.Uri,UriKind.Absolute,out url) || url.Scheme != "https" || url.Host != "biofocus.local") e.Cancel=true; };
        core.NewWindowRequested += (s,e) => { e.Handled=true; Uri url; if(Uri.TryCreate(e.Uri,UriKind.Absolute,out url) && url.Scheme=="https" && url.Host=="platform.openai.com") System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo(url.AbsoluteUri) { UseShellExecute=true }); };
        core.WebMessageReceived += OnMessage;
        core.AddWebResourceRequestedFilter("https://biofocus.local/__library/*",CoreWebView2WebResourceContext.All);
        core.WebResourceRequested += (s,e) => {
            try {
                string key = new Uri(e.Request.Uri).AbsolutePath.Substring("/__library/".Length), file;
                lock(gate) { if(!files.TryGetValue(key,out file)) throw new Exception("文件不在已连接的文献库内"); }
                ValidateLibraryPath(file,folder);
                var info = new FileInfo(file); if(info.Length > 150L*1024*1024) throw new Exception("PDF 大于 150 MB");
                e.Response = core.Environment.CreateWebResourceResponse(File.Open(file,FileMode.Open,FileAccess.Read,FileShare.ReadWrite),200,"OK","Content-Type: application/pdf\r\nCache-Control: no-store");
            } catch { e.Response=core.Environment.CreateWebResourceResponse(new MemoryStream(Encoding.UTF8.GetBytes("文件暂不可用，请刷新文献库。")),404,"Not Found","Content-Type: text/plain;charset=utf-8"); }
        };
        await core.AddScriptToExecuteOnDocumentCreatedAsync(File.ReadAllText(Path.Combine(AppDomain.CurrentDomain.BaseDirectory,"bridge.js")));
        if(folder != null) { Scan(); WatchFolder(); }
        core.Navigate("https://biofocus.local/index.html"+(configureOnStart?"#settings":""));
    }

    static bool IsApp(string source) { Uri url; return Uri.TryCreate(source,UriKind.Absolute,out url) && url.Scheme=="https" && url.Host=="biofocus.local"; }
    void Push(string kind, object result) { if(!IsDisposed && view.CoreWebView2!=null) view.CoreWebView2.PostWebMessageAsJson(json.Serialize(new { kind=kind, result=result })); }
    async void OnMessage(object sender, CoreWebView2WebMessageReceivedEventArgs e) {
        if(!IsApp(e.Source)) return;
        string id = null;
        try {
            var request=json.Deserialize<Dictionary<string,object>>(e.WebMessageAsJson);
            id=request["id"].ToString(); var method=request["method"].ToString(); object input; request.TryGetValue("input",out input);
            object result;
            switch(method) {
                case "model:translate": result=await modelService.Translate(input as Dictionary<string,object>);break;
                case "model:status": result=modelService.Status();break;
                case "model:configure": result=modelService.Configure(input as Dictionary<string,object>);break;
                case "model:clear": modelService.Clear();result=new { configured=false };break;
                case "model:models": result=await modelService.Models(Convert.ToString(input));break;
                case "model:chat": result=await modelService.Chat(input as Dictionary<string,object>);break;
                case "model:test": result=await modelService.Chat(new Dictionary<string,object>{{"messages",new object[]{new Dictionary<string,object>{{"role","user"},{"content","Reply with OK only."}}}}},true);break;
                case "library:get": result=Scan(); break;
                case "library:file-info": { string file=GetLibraryFile(Convert.ToString(input)); var info=new FileInfo(file); if(info.Length>150L*1024*1024)throw new Exception("请选择小于 150 MB 的 PDF。"); result=new { size=info.Length }; break; }
                case "library:read-chunk": {
                    var chunk=input as Dictionary<string,object>; if(chunk==null)throw new Exception("读取参数无效。");
                    string file=GetLibraryFile(Value(chunk,"key")); long offset=Convert.ToInt64(chunk["offset"]); int count=Convert.ToInt32(chunk["length"]);
                    if(offset<0 || count<1 || count>1024*1024)throw new Exception("读取范围无效。");
                    using(var stream=File.Open(file,FileMode.Open,FileAccess.Read,FileShare.Read)) { if(stream.Length>150L*1024*1024 || offset>=stream.Length)throw new Exception("文件大小或读取位置无效。"); stream.Position=offset; var buffer=new byte[Math.Min(count,(int)(stream.Length-offset))]; int total=0;while(total<buffer.Length){int read=stream.Read(buffer,total,buffer.Length-total);if(read==0)break;total+=read;}result=Convert.ToBase64String(buffer,0,total); } break;
                }
                case "library:choose": {
                    using(var picker=new FolderBrowserDialog { Description="选择你的文献文件夹", SelectedPath=folder??Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory), ShowNewFolderButton=false }) {
                        if(picker.ShowDialog(this)==DialogResult.OK) { folder=Path.GetFullPath(picker.SelectedPath); File.WriteAllText(Path.Combine(data,"library.json"),json.Serialize(new { folder=folder })); WatchFolder(); }
                    }
                    result=Scan(); break;
                }
                default: throw new Exception("不支持的操作。");
            }
            Push("reply",new { id=id, ok=true, value=result });
        } catch(Exception error) { Push("reply",new { id=id, ok=false, error=error.Message }); }
    }

    void WatchFolder() {
        if(watcher!=null) watcher.Dispose();
        if(folder==null || !Directory.Exists(folder)) return;
        watcher=new FileSystemWatcher(folder) { IncludeSubdirectories=true, NotifyFilter=NotifyFilters.FileName|NotifyFilters.DirectoryName|NotifyFilters.LastWrite, EnableRaisingEvents=true };
        FileSystemEventHandler changed=(s,e)=>ScheduleScan();
        watcher.Created+=changed; watcher.Deleted+=changed; watcher.Changed+=changed; watcher.Renamed+=(s,e)=>ScheduleScan();
    }
    string GetLibraryFile(string key) { string file; lock(gate) { if(!files.TryGetValue(key,out file))throw new Exception("文件不在已连接文献库内，请刷新。"); } ValidateLibraryPath(file,folder);return file; }
    void ScheduleScan() { if(IsDisposed || !IsHandleCreated) return; BeginInvoke((Action)(()=>{refresh.Stop();refresh.Start();})); }
    object Scan() {
        var entries=new List<object>(); var map=new Dictionary<string,string>();
        if(folder!=null && Directory.Exists(folder)) Visit(folder,0,entries,map);
        lock(gate) { files.Clear(); foreach(var item in map) files.Add(item.Key,item.Value); }
        return new { folder=folder, files=entries.ToArray(), truncated=entries.Count>=5000 };
    }
    void Visit(string dir,int depth,List<object> entries,Dictionary<string,string> map) {
        if(depth>10 || entries.Count>=5000) return;
        try {
            foreach(string entry in Directory.GetFileSystemEntries(dir)) {
                if(entries.Count>=5000) break;
                var attributes=File.GetAttributes(entry); if((attributes&FileAttributes.ReparsePoint)!=0) continue;
                if((attributes&FileAttributes.Directory)!=0) { Visit(entry,depth+1,entries,map); continue; }
                if(!entry.EndsWith(".pdf",StringComparison.OrdinalIgnoreCase)) continue;
                var info=new FileInfo(entry); string key=Hash(entry);
                map[key]=entry; entries.Add(new { key=key, name=info.Name, relativePath=entry.Substring(folder.TrimEnd(Path.DirectorySeparatorChar).Length+1), size=info.Length, modified=(info.LastWriteTimeUtc-new DateTime(1970,1,1,0,0,0,DateTimeKind.Utc)).TotalMilliseconds });
            }
        } catch(UnauthorizedAccessException) {} catch(DirectoryNotFoundException) {}
    }
    internal static void ValidateLibraryPath(string file,string root) {
        if(root==null || !Path.GetFullPath(file).StartsWith(Path.GetFullPath(root).TrimEnd(Path.DirectorySeparatorChar)+Path.DirectorySeparatorChar,StringComparison.OrdinalIgnoreCase)) throw new Exception("文件路径不在文献库内。");
        string current=file;
        while(current.Length>root.TrimEnd(Path.DirectorySeparatorChar).Length) { if((File.GetAttributes(current)&FileAttributes.ReparsePoint)!=0) throw new Exception("不读取符号链接。"); current=Path.GetDirectoryName(current); }
    }
    internal static string Hash(string value) { using(var hash=SHA256.Create()) return BitConverter.ToString(hash.ComputeHash(Encoding.UTF8.GetBytes(value))).Replace("-","").ToLowerInvariant(); }
    static string Value(Dictionary<string,object> values,string key,string fallback="") { object value; return values!=null && values.TryGetValue(key,out value) && value!=null?value.ToString():fallback; }

}

static class SelfTests {
    internal static int Run(string output) {
        try {
            string text="BioFocus credential roundtrip test";
            var cipher=ProtectedData.Protect(Encoding.UTF8.GetBytes(text),null,DataProtectionScope.CurrentUser);
            if(Encoding.UTF8.GetString(ProtectedData.Unprotect(cipher,null,DataProtectionScope.CurrentUser))!=text) throw new Exception("Windows encryption test failed");
            var serializer=new JavaScriptSerializer();
            var chat=serializer.Deserialize<Dictionary<string,object>>("{\"messages\":[{\"role\":\"user\",\"content\":\"Explain this term\"}],\"context\":\"Untrusted page text\",\"page\":2}");
            if(!ModelService.Normalize(chat).Last()["content"].ToString().Contains("document-excerpt"))throw new Exception("Model context normalization failed");
            if(System.Net.ServicePointManager.SecurityProtocol!=System.Net.SecurityProtocolType.Tls12)throw new Exception("Modern TLS setup failed");
            var response=serializer.Deserialize<Dictionary<string,object>>("{\"output\":[{\"type\":\"reasoning\",\"content\":[]},{\"type\":\"message\",\"content\":[{\"type\":\"output_text\",\"text\":\"Real response text\"}]}]}");
            if(ModelService.Extract(response)!="Real response text")throw new Exception("Model response parsing failed");
            var translationRequest=new Dictionary<string,object>{{"q","knockout"},{"context","CRISPR knockout cells"},{"messages","private chat"}};
            string translationPayload=serializer.Serialize(ModelService.TranslationInput(translationRequest));
            if(translationPayload.Contains("private chat")||!translationPayload.Contains("CRISPR"))throw new Exception("Translation history isolation failed");
            response["model"]=ModelService.DefaultModel;
            response["output"]=new object[]{new {type="message",content=new object[]{new {type="output_text",text=serializer.Serialize(new {translation="敲除",explains=new[]{"基因失活"}})}}}};
            response=serializer.Deserialize<Dictionary<string,object>>(serializer.Serialize(response));
            var parsed=serializer.Deserialize<Dictionary<string,object>>(serializer.Serialize(ModelService.ParseTranslation(response)));
            if(parsed["translation"].ToString()!="敲除"||parsed["model"].ToString()!="gpt-6.1-sol")throw new Exception("Translation response parsing failed");
            response["status"]="incomplete";bool incompleteRejected=false;try{ModelService.ParseTranslation(response);}catch{incompleteRejected=true;}if(!incompleteRejected)throw new Exception("Partial translation accepted");
            bool rejected=false;try{ReaderWindow.ValidateLibraryPath(@"C:\outside\paper.pdf",@"C:\papers");}catch{rejected=true;}if(!rejected)throw new Exception("Folder-boundary validation failed");
            File.WriteAllText(output,"PASS: Windows credential encryption, folder boundaries, model context, translation history isolation and response parsing."); return 0;
        } catch(Exception error) {File.WriteAllText(output,"FAIL: "+error.Message);return 1;}
    }
}
