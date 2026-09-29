using System;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Security.AccessControl;
using System.Security.Cryptography;
using System.Security.Principal;
using System.Text;
using System.Threading;

static class Warden
{

    [DllImport("user32.dll", SetLastError = true)]
    static extern IntPtr GetProcessWindowStation();
    [DllImport("user32.dll", SetLastError = true)]
    static extern IntPtr GetThreadDesktop(uint threadId);
    [DllImport("kernel32.dll")]
    static extern uint GetCurrentThreadId();
    [DllImport("user32.dll", EntryPoint = "GetUserObjectInformationW", CharSet = CharSet.Unicode, SetLastError = true)]
    static extern bool GetUserObjectInformation(IntPtr hObj, int index, byte[] pvInfo, uint nLength, out uint lenNeeded);
    [DllImport("user32.dll", SetLastError = true)]
    static extern bool GetUserObjectSecurity(IntPtr hObj, ref int pSIRequested, byte[] pSD, uint nLength, out uint lenNeeded);
    [DllImport("user32.dll", SetLastError = true)]
    static extern bool SetUserObjectSecurity(IntPtr hObj, ref int pSIRequested, byte[] pSD);

    const int UOI_NAME = 2;
    const int DACL_SECURITY_INFORMATION = 4;
    const int WINSTA_ALL_ACCESS = 0x37F;
    const int DESKTOP_ALL_ACCESS = 0x1FF;
    const int GENERIC_ACCESS = unchecked((int)0xF0000000);

    static string WindowStationName(IntPtr hWinsta)
    {
        uint needed;
        var buf = new byte[256];
        if (!GetUserObjectInformation(hWinsta, UOI_NAME, buf, (uint)buf.Length, out needed)) return "";
        return Encoding.Unicode.GetString(buf, 0, (int)Math.Max(0, (int)needed - 2));
    }

    static bool GrantOn(IntPtr handle, SecurityIdentifier sid, int accessMask, bool container)
    {
        int si = DACL_SECURITY_INFORMATION;
        uint needed;
        GetUserObjectSecurity(handle, ref si, new byte[0], 0, out needed);
        if (needed == 0) return false;
        var sd = new byte[needed];
        if (!GetUserObjectSecurity(handle, ref si, sd, needed, out needed)) return false;

        var raw = new RawSecurityDescriptor(sd, 0);
        var dacl = raw.DiscretionaryAcl ?? new RawAcl(RawAcl.AclRevision, 1);

        if (container)
        {
            dacl.InsertAce(0, new CommonAce(
                AceFlags.ObjectInherit | AceFlags.ContainerInherit | AceFlags.InheritOnly,
                AceQualifier.AccessAllowed, GENERIC_ACCESS, sid, false, null));
        }
        dacl.InsertAce(0, new CommonAce(
            AceFlags.None, AceQualifier.AccessAllowed, accessMask, sid, false, null));

        raw.DiscretionaryAcl = dacl;
        var outSd = new byte[raw.BinaryLength];
        raw.GetBinaryForm(outSd, 0);
        return SetUserObjectSecurity(handle, ref si, outSd);
    }

    static string GrantSessionZeroAccess(string account)
    {
        try
        {
            IntPtr hWinsta = GetProcessWindowStation();
            if (hWinsta == IntPtr.Zero) return "no window station handle";
            string name = WindowStationName(hWinsta);

            if (string.IsNullOrEmpty(name))
                return "window station name unreadable — nothing granted (failing closed)";

            if (!name.StartsWith("Service-", StringComparison.OrdinalIgnoreCase))
                return "station '" + name + "' is not a service station — nothing granted, by design";

            var sid = (SecurityIdentifier)new NTAccount(account).Translate(typeof(SecurityIdentifier));
            IntPtr hDesk = GetThreadDesktop(GetCurrentThreadId());

            bool okWinsta = GrantOn(hWinsta, sid, WINSTA_ALL_ACCESS, true);
            bool okDesk = hDesk != IntPtr.Zero && GrantOn(hDesk, sid, DESKTOP_ALL_ACCESS, false);
            return "station " + name + ": winsta=" + okWinsta + " desktop=" + okDesk;
        }
        catch (Exception e)
        {
            return "grant failed: " + e.Message;
        }
    }

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode)]
    static extern IntPtr CreateJobObject(IntPtr attrs, string name);
    [DllImport("kernel32.dll")]
    static extern bool SetInformationJobObject(IntPtr job, int infoClass, IntPtr info, uint len);
    [DllImport("kernel32.dll")]
    static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);

    const int JobObjectExtendedLimitInformation = 9;
    const uint JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE = 0x2000;

    [StructLayout(LayoutKind.Sequential)]
    struct JOBOBJECT_BASIC_LIMIT_INFORMATION
    {
        public long PerProcessUserTimeLimit, PerJobUserTimeLimit;
        public uint LimitFlags;
        public UIntPtr MinimumWorkingSetSize, MaximumWorkingSetSize;
        public uint ActiveProcessLimit;
        public UIntPtr Affinity;
        public uint PriorityClass, SchedulingClass;
    }
    [StructLayout(LayoutKind.Sequential)]
    struct IO_COUNTERS
    {
        public ulong ReadOperationCount, WriteOperationCount, OtherOperationCount,
                     ReadTransferCount, WriteTransferCount, OtherTransferCount;
    }
    [StructLayout(LayoutKind.Sequential)]
    struct JOBOBJECT_EXTENDED_LIMIT_INFORMATION
    {
        public JOBOBJECT_BASIC_LIMIT_INFORMATION BasicLimitInformation;
        public IO_COUNTERS IoInfo;
        public UIntPtr ProcessMemoryLimit, JobMemoryLimit, PeakProcessMemoryUsed, PeakJobMemoryUsed;
    }

    static IntPtr job;

    static int Main(string[] rawArgs)
    {
        string credPath = null;
        int i = 0;
        for (; i < rawArgs.Length; i++)
        {
            if (rawArgs[i] == "--cred") { credPath = rawArgs[++i]; }
            else if (rawArgs[i] == "--") { i++; break; }
            else break;
        }
        if (i >= rawArgs.Length)
        {
            Console.Error.WriteLine("warden: no command after --");
            return 64;
        }

        var psi = new ProcessStartInfo
        {
            FileName = rawArgs[i],
            Arguments = QuoteArgs(rawArgs, i + 1),
            UseShellExecute = false,
            RedirectStandardInput = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            WorkingDirectory = Environment.CurrentDirectory,
            CreateNoWindow = true,
        };

        if (credPath != null)
        {
            string[] lines;
            byte[] pw;
            try
            {
                lines = File.ReadAllLines(credPath);
                byte[] blob = Convert.FromBase64String(lines[1].Trim());
                try
                {
                    pw = ProtectedData.Unprotect(blob, null, DataProtectionScope.CurrentUser);
                }
                catch
                {
                    pw = ProtectedData.Unprotect(blob, null, DataProtectionScope.LocalMachine);
                }
            }
            catch (Exception e)
            {
                Console.Error.WriteLine("warden: cannot read credential: " + e.Message);
                return 65;
            }
            psi.UserName = lines[0].Trim();
            psi.Domain = ".";
            Console.Error.WriteLine("warden: " + GrantSessionZeroAccess(psi.UserName));
            var sec = new System.Security.SecureString();
            foreach (char c in Encoding.UTF8.GetString(pw)) sec.AppendChar(c);
            Array.Clear(pw, 0, pw.Length);
            psi.Password = sec;
            psi.LoadUserProfile = true;
        }

        Process p;
        try { p = Process.Start(psi); }
        catch (System.ComponentModel.Win32Exception e)
        {
            Console.Error.WriteLine("warden: start failed: " + e.Message + " (win32=" + e.NativeErrorCode + ")");
            return 66;
        }
        catch (Exception e)
        {
            Console.Error.WriteLine("warden: start failed: " + e.GetType().Name + ": " + e.Message);
            return 66;
        }

        job = CreateJobObject(IntPtr.Zero, null);
        if (job != IntPtr.Zero)
        {
            var info = new JOBOBJECT_EXTENDED_LIMIT_INFORMATION();
            info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
            int len = Marshal.SizeOf(info);
            IntPtr mem = Marshal.AllocHGlobal(len);
            Marshal.StructureToPtr(info, mem, false);
            if (!SetInformationJobObject(job, JobObjectExtendedLimitInformation, mem, (uint)len)
                || !AssignProcessToJobObject(job, p.Handle))
            {
                Console.Error.WriteLine("warden: could not tether child to job object — refusing to run untethered");
                try { p.Kill(); } catch { }
                return 67;
            }
            Marshal.FreeHGlobal(mem);
        }
        else
        {
            Console.Error.WriteLine("warden: CreateJobObject failed — refusing to run untethered");
            try { p.Kill(); } catch { }
            return 67;
        }

        var tIn = new Thread(() =>
        {
            Pump(Console.OpenStandardInput(), p.StandardInput.BaseStream);
            try { p.StandardInput.Close(); } catch { }
            if (!p.WaitForExit(5000)) { try { p.Kill(); } catch { } }
        }) { IsBackground = true };
        var tOut = new Thread(() => Pump(p.StandardOutput.BaseStream, Console.OpenStandardOutput()));
        var tErr = new Thread(() => Pump(p.StandardError.BaseStream, Console.OpenStandardError()));
        tIn.Start(); tOut.Start(); tErr.Start();

        p.WaitForExit();
        tOut.Join(3000); tErr.Join(3000);
        return p.ExitCode;
    }

    static void Pump(Stream src, Stream dst)
    {
        var buf = new byte[8192];
        try
        {
            int n;
            while ((n = src.Read(buf, 0, buf.Length)) > 0)
            {
                dst.Write(buf, 0, n);
                dst.Flush();
            }
        }
        catch { }
    }

    static string QuoteArgs(string[] args, int from)
    {
        var sb = new StringBuilder();
        for (int j = from; j < args.Length; j++)
        {
            if (j > from) sb.Append(' ');
            string a = args[j];
            if (a.Length > 0 && a.IndexOfAny(new[] { ' ', '\t', '"' }) < 0) { sb.Append(a); continue; }
            sb.Append('"');
            int backslashes = 0;
            foreach (char c in a)
            {
                if (c == '\\') { backslashes++; continue; }
                if (c == '"') { sb.Append('\\', backslashes * 2 + 1).Append('"'); backslashes = 0; continue; }
                sb.Append('\\', backslashes).Append(c);
                backslashes = 0;
            }
            sb.Append('\\', backslashes * 2).Append('"');
        }
        return sb.ToString();
    }
}
