//! 以「完全脱离调用方」的方式启动后台进程。
//!
//! Rust 标准库在 Windows 上用 `CreateProcessW` 时会把父进程所有**可继承句柄**
//! 复制给子进程。守护进程长期存活，被复制过去的调用方管道（例如 PowerShell 为
//! 子进程输出创建的那根管道）就永远不会关闭，调用方于是等不到 EOF 而挂死。
//!
//! 这里用 `PROC_THREAD_ATTRIBUTE_HANDLE_LIST` 把继承范围收缩到我们显式给出的三个
//! 标准句柄，并直接以 `DETACHED_PROCESS` 拉起目标进程（不再需要 `cmd.exe` 中转，
//! 也就不再需要启动脚本与 cmd 引号规则）。

use anyhow::Result;
use std::{ffi::OsString, path::Path};

/// 启动守护进程：标准输出/错误指向给定的日志文件，标准输入指向 NUL。
///
/// 返回子进程 PID。
#[cfg(windows)]
pub fn spawn_detached(
    exe: &Path,
    args: &[OsString],
    working_dir: &Path,
    stdout: &std::fs::File,
    stderr: &std::fs::File,
) -> Result<u32> {
    imp::spawn_detached(exe, args, working_dir, stdout, stderr)
}

#[cfg(not(windows))]
pub fn spawn_detached(
    _exe: &Path,
    _args: &[OsString],
    _working_dir: &Path,
    _stdout: &std::fs::File,
    _stderr: &std::fs::File,
) -> Result<u32> {
    anyhow::bail!("分离式进程启动仅支持 Windows")
}

#[cfg(windows)]
mod imp {
    use anyhow::{Context, Result};
    use std::{
        ffi::{c_void, OsStr, OsString},
        fs::{File, OpenOptions},
        io,
        mem::{size_of, zeroed},
        os::windows::{
            ffi::OsStrExt,
            io::{AsRawHandle, RawHandle},
        },
        path::Path,
        ptr::{null_mut},
    };

    const CREATE_NEW_PROCESS_GROUP: u32 = 0x0000_0200;
    const DETACHED_PROCESS: u32 = 0x0000_0008;
    const EXTENDED_STARTUPINFO_PRESENT: u32 = 0x0008_0000;
    const STARTF_USESTDHANDLES: u32 = 0x0000_0100;
    const HANDLE_FLAG_INHERIT: u32 = 0x0000_0001;
    const PROC_THREAD_ATTRIBUTE_HANDLE_LIST: usize = 0x0002_0002;

    #[repr(C)]
    struct StartupInfoW {
        cb: u32,
        lp_reserved: *mut u16,
        lp_desktop: *mut u16,
        lp_title: *mut u16,
        dw_x: u32,
        dw_y: u32,
        dw_x_size: u32,
        dw_y_size: u32,
        dw_x_count_chars: u32,
        dw_y_count_chars: u32,
        dw_fill_attribute: u32,
        dw_flags: u32,
        w_show_window: u16,
        cb_reserved2: u16,
        lp_reserved2: *mut u8,
        h_std_input: RawHandle,
        h_std_output: RawHandle,
        h_std_error: RawHandle,
    }

    #[repr(C)]
    struct StartupInfoExW {
        startup_info: StartupInfoW,
        lp_attribute_list: *mut c_void,
    }

    #[repr(C)]
    struct ProcessInformation {
        h_process: RawHandle,
        h_thread: RawHandle,
        dw_process_id: u32,
        dw_thread_id: u32,
    }

    #[link(name = "kernel32")]
    extern "system" {
        fn CreateProcessW(
            application_name: *const u16,
            command_line: *mut u16,
            process_attributes: *mut c_void,
            thread_attributes: *mut c_void,
            inherit_handles: i32,
            creation_flags: u32,
            environment: *mut c_void,
            current_directory: *const u16,
            startup_info: *mut StartupInfoW,
            process_information: *mut ProcessInformation,
        ) -> i32;

        fn InitializeProcThreadAttributeList(
            attribute_list: *mut c_void,
            attribute_count: u32,
            flags: u32,
            size: *mut usize,
        ) -> i32;

        fn UpdateProcThreadAttribute(
            attribute_list: *mut c_void,
            flags: u32,
            attribute: usize,
            value: *mut c_void,
            size: usize,
            previous_value: *mut c_void,
            return_size: *mut usize,
        ) -> i32;

        fn DeleteProcThreadAttributeList(attribute_list: *mut c_void);
        fn SetHandleInformation(handle: RawHandle, mask: u32, flags: u32) -> i32;
        fn CloseHandle(handle: RawHandle) -> i32;
        fn GetLastError() -> u32;
    }

    fn last_error(context: &str) -> anyhow::Error {
        let code = unsafe { GetLastError() };
        anyhow::anyhow!(
            "{context} 失败（Win32 错误码 {code}: {}）",
            io::Error::from_raw_os_error(code as i32)
        )
    }

    fn wide(text: &OsStr) -> Vec<u16> {
        text.encode_wide().chain(std::iter::once(0)).collect()
    }

    struct InheritableHandle(RawHandle);

    impl InheritableHandle {
        /// 复制一份可继承的句柄；退出时恢复原句柄的继承标记。
        fn new(handle: RawHandle) -> Result<Self> {
            if unsafe { SetHandleInformation(handle, HANDLE_FLAG_INHERIT, HANDLE_FLAG_INHERIT) } == 0
            {
                return Err(last_error("设置句柄可继承"));
            }
            Ok(Self(handle))
        }
    }

    impl Drop for InheritableHandle {
        fn drop(&mut self) {
            unsafe {
                SetHandleInformation(self.0, HANDLE_FLAG_INHERIT, 0);
            }
        }
    }

    fn open_null() -> Result<File> {
        OpenOptions::new()
            .read(true)
            .write(true)
            .open("NUL")
            .context("打开 NUL 设备失败")
    }

    pub fn spawn_detached(
        exe: &Path,
        args: &[OsString],
        working_dir: &Path,
        stdout: &File,
        stderr: &File,
    ) -> Result<u32> {
        let null = open_null()?;

        // 只把这四个句柄交给子进程，其余（调用方管道等）一概不继承。
        let stdin_handle = InheritableHandle::new(null.as_raw_handle())?;
        let stdout_handle = InheritableHandle::new(stdout.as_raw_handle())?;
        let stderr_handle = InheritableHandle::new(stderr.as_raw_handle())?;

        let handles = [
            stdin_handle.0,
            stdout_handle.0,
            stderr_handle.0,
        ];

        // 属性列表需要 16 字节对齐，用 u128 数组承载。
        let mut list_size = 0usize;
        unsafe {
            InitializeProcThreadAttributeList(null_mut(), 1, 0, &mut list_size);
        }
        if list_size == 0 {
            return Err(last_error("初始化属性列表"));
        }
        let mut list_buffer = vec![0u128; list_size.div_ceil(size_of::<u128>()) + 1];
        let list = list_buffer.as_mut_ptr() as *mut c_void;
        if unsafe { InitializeProcThreadAttributeList(list, 1, 0, &mut list_size) } == 0 {
            return Err(last_error("初始化属性列表"));
        }
        let _list_guard = AttributeListGuard(list);

        let value = handles.as_ptr() as *mut c_void;
        if unsafe {
            UpdateProcThreadAttribute(
                list,
                0,
                PROC_THREAD_ATTRIBUTE_HANDLE_LIST,
                value,
                size_of::<[RawHandle; 3]>(),
                null_mut(),
                null_mut(),
            )
        } == 0
        {
            return Err(last_error("设置继承句柄白名单"));
        }

        let mut startup: StartupInfoExW = unsafe { zeroed() };
        startup.startup_info.cb = size_of::<StartupInfoExW>() as u32;
        startup.startup_info.dw_flags = STARTF_USESTDHANDLES;
        startup.startup_info.h_std_input = stdin_handle.0;
        startup.startup_info.h_std_output = stdout_handle.0;
        startup.startup_info.h_std_error = stderr_handle.0;
        startup.lp_attribute_list = list;

        let mut command_line: Vec<u16> = quote_arg(&exe.as_os_str().to_string_lossy()).encode_utf16().collect();
        for arg in args {
            command_line.push(' ' as u16);
            command_line.extend(quote_arg(&arg.to_string_lossy()).encode_utf16());
        }
        command_line.push(0);

        let application_name = wide(exe.as_os_str());
        let current_directory = wide(working_dir.as_os_str());
        let mut info: ProcessInformation = unsafe { zeroed() };

        let created = unsafe {
            CreateProcessW(
                application_name.as_ptr(),
                command_line.as_mut_ptr(),
                null_mut(),
                null_mut(),
                1,
                DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP | EXTENDED_STARTUPINFO_PRESENT,
                null_mut(),
                current_directory.as_ptr(),
                &mut startup.startup_info,
                &mut info,
            )
        };
        if created == 0 {
            return Err(last_error(&format!("启动进程 {}", exe.display())));
        }

        unsafe {
            CloseHandle(info.h_thread);
            CloseHandle(info.h_process);
        }
        Ok(info.dw_process_id)
    }

    struct AttributeListGuard(*mut c_void);

    impl Drop for AttributeListGuard {
        fn drop(&mut self) {
            unsafe { DeleteProcThreadAttributeList(self.0) };
        }
    }

    /// 按 Windows 命令行规则给参数加引号。
    fn quote_arg(arg: &str) -> String {
        if !arg.is_empty() && !arg.contains([' ', '\t', '"']) {
            return arg.to_string();
        }

        let mut result = String::with_capacity(arg.len() + 2);
        result.push('"');
        let mut backslashes = 0usize;
        for ch in arg.chars() {
            match ch {
                '\\' => {
                    backslashes += 1;
                    result.push('\\');
                }
                '"' => {
                    for _ in 0..=backslashes {
                        result.push('\\');
                    }
                    result.push('"');
                    backslashes = 0;
                }
                _ => {
                    backslashes = 0;
                    result.push(ch);
                }
            }
        }
        for _ in 0..backslashes {
            result.push('\\');
        }
        result.push('"');
        result
    }

    #[cfg(test)]
    mod tests {
        use super::*;

        #[test]
        fn quote_arg_leaves_simple_arguments_alone() {
            assert_eq!(quote_arg("bridge"), "bridge");
            assert_eq!(quote_arg("services"), "services");
        }

        #[test]
        fn quote_arg_wraps_paths_with_spaces() {
            assert_eq!(quote_arg("C:\\Program Files\\a.exe"), "\"C:\\Program Files\\a.exe\"");
            assert_eq!(quote_arg(""), "\"\"");
        }

        #[test]
        fn quote_arg_escapes_quotes_and_trailing_backslashes() {
            assert_eq!(quote_arg("say \"hi\""), "\"say \\\"hi\\\"\"");
            assert_eq!(quote_arg("C:\\dir \\"), "\"C:\\dir \\\\\"");
        }

        #[test]
        fn open_null_provides_usable_handle() {
            let file = open_null().expect("打开 NUL");
            assert!(!file.as_raw_handle().is_null());
        }

        #[test]
        fn spawn_detached_wires_child_output_to_log_file() {
            let dir = std::env::temp_dir().join(format!("codex-detach-{}", std::process::id()));
            std::fs::create_dir_all(&dir).expect("创建临时目录");
            let stdout_path = dir.join("child.out.log");
            let stderr_path = dir.join("child.err.log");
            let stdout = OpenOptions::new()
                .create(true)
                .append(true)
                .open(&stdout_path)
                .expect("打开输出日志");
            let stderr = OpenOptions::new()
                .create(true)
                .append(true)
                .open(&stderr_path)
                .expect("打开错误日志");

            let shell = std::env::var_os("COMSPEC")
                .map(std::path::PathBuf::from)
                .unwrap_or_else(|| std::path::PathBuf::from(r"C:\Windows\System32\cmd.exe"));
            let pid = spawn_detached(
                &shell,
                &[
                    OsString::from("/d"),
                    OsString::from("/c"),
                    OsString::from("echo detach-ok"),
                ],
                &dir,
                &stdout,
                &stderr,
            )
            .expect("启动子进程");
            assert!(pid > 0, "应返回子进程 PID");

            let mut text = String::new();
            for _ in 0..100 {
                text = std::fs::read_to_string(&stdout_path).unwrap_or_default();
                if text.contains("detach-ok") {
                    break;
                }
                std::thread::sleep(std::time::Duration::from_millis(50));
            }

            drop(stdout);
            drop(stderr);
            std::fs::remove_dir_all(&dir).ok();
            assert!(text.contains("detach-ok"), "子进程输出未写入日志: {text:?}");
        }
    }
}
