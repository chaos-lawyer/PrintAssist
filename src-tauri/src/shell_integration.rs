use serde::{Deserialize, Serialize};
use std::path::PathBuf;

use crate::printers::PersistentPrinterProfileStore;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShellIntegrationStatus {
    pub supported: bool,
    pub file_registered: bool,
    pub directory_registered: bool,
    pub current_exe_path: String,
    pub registered_file_exe_path: Option<String>,
    pub registered_directory_exe_path: Option<String>,
    pub is_path_matched: bool,
    pub is_portable: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShellIntegrationOptions {
    pub enable_files: bool,
    pub enable_directories: bool,
}

pub fn get_current_exe_path() -> Result<PathBuf, String> {
    std::env::current_exe().map_err(|e| format!("获取当前程序路径失败: {}", e))
}

pub fn is_portable() -> bool {
    if let Ok(exe_path) = get_current_exe_path() {
        let exe_dir = exe_path.parent();
        PersistentPrinterProfileStore::is_portable_mode(exe_dir)
    } else {
        PersistentPrinterProfileStore::is_portable_mode(None)
    }
}

#[cfg(windows)]
mod win_impl {
    use super::*;
    use windows::core::{PCWSTR, HSTRING};
    use windows::Win32::Foundation::{ERROR_FILE_NOT_FOUND, ERROR_SUCCESS, WIN32_ERROR};
    use windows::Win32::System::Registry::{
        RegCloseKey, RegCreateKeyExW, RegDeleteTreeW, RegOpenKeyExW, RegQueryValueExW,
        RegSetValueExW, HKEY, HKEY_CURRENT_USER, KEY_READ, KEY_WRITE, REG_OPTION_NON_VOLATILE,
        REG_SZ,
    };

    const FILE_SHELL_KEY: &str = r"Software\Classes\*\shell\PrintAssist";
    const FILE_CMD_KEY: &str = r"Software\Classes\*\shell\PrintAssist\command";
    const DIR_SHELL_KEY: &str = r"Software\Classes\Directory\shell\PrintAssist";
    const DIR_CMD_KEY: &str = r"Software\Classes\Directory\shell\PrintAssist\command";

    fn read_reg_string(sub_key: &str, value_name: &str) -> Option<String> {
        unsafe {
            let mut hkey = HKEY::default();
            let sub_key_w = HSTRING::from(sub_key);
            let status = RegOpenKeyExW(
                HKEY_CURRENT_USER,
                PCWSTR(sub_key_w.as_ptr()),
                0,
                KEY_READ,
                &mut hkey,
            );
            if status != ERROR_SUCCESS {
                return None;
            }

            let val_name_w = if value_name.is_empty() {
                HSTRING::default()
            } else {
                HSTRING::from(value_name)
            };
            let val_ptr = if value_name.is_empty() {
                PCWSTR::null()
            } else {
                PCWSTR(val_name_w.as_ptr())
            };

            let mut data_type = REG_SZ;
            let mut data_len = 0u32;
            let query_len = RegQueryValueExW(
                hkey,
                val_ptr,
                None,
                Some(&mut data_type),
                None,
                Some(&mut data_len),
            );

            if query_len != ERROR_SUCCESS || data_len == 0 {
                let _ = RegCloseKey(hkey);
                return None;
            }

            let mut buffer = vec![0u16; (data_len as usize / 2) + 1];
            let query_val = RegQueryValueExW(
                hkey,
                val_ptr,
                None,
                Some(&mut data_type),
                Some(buffer.as_mut_ptr() as *mut u8),
                Some(&mut data_len),
            );
            let _ = RegCloseKey(hkey);

            if query_val == ERROR_SUCCESS {
                let s = String::from_utf16_lossy(&buffer);
                Some(s.trim_matches('\0').to_string())
            } else {
                None
            }
        }
    }

    fn write_reg_string(sub_key: &str, value_name: &str, value: &str) -> Result<(), String> {
        unsafe {
            let mut hkey = HKEY::default();
            let sub_key_w = HSTRING::from(sub_key);
            let status = RegCreateKeyExW(
                HKEY_CURRENT_USER,
                PCWSTR(sub_key_w.as_ptr()),
                0,
                None,
                REG_OPTION_NON_VOLATILE,
                KEY_WRITE,
                None,
                &mut hkey,
                None,
            );
            if status != ERROR_SUCCESS {
                return Err(format!("创建注册表项失败 ({}): 错误码 {:?}", sub_key, status));
            }

            let val_name_w = if value_name.is_empty() {
                HSTRING::default()
            } else {
                HSTRING::from(value_name)
            };
            let val_ptr = if value_name.is_empty() {
                PCWSTR::null()
            } else {
                PCWSTR(val_name_w.as_ptr())
            };

            let mut value_u16: Vec<u16> = value.encode_utf16().collect();
            value_u16.push(0);

            let set_res = RegSetValueExW(
                hkey,
                val_ptr,
                0,
                REG_SZ,
                Some(std::slice::from_raw_parts(
                    value_u16.as_ptr() as *const u8,
                    value_u16.len() * 2,
                )),
            );
            let _ = RegCloseKey(hkey);

            if set_res != ERROR_SUCCESS {
                return Err(format!("写入注册表值失败: 错误码 {:?}", set_res));
            }
            Ok(())
        }
    }

    fn delete_reg_tree(sub_key: &str) -> Result<(), String> {
        unsafe {
            let sub_key_w = HSTRING::from(sub_key);
            let status = RegDeleteTreeW(HKEY_CURRENT_USER, PCWSTR(sub_key_w.as_ptr()));
            if status == ERROR_SUCCESS || status == ERROR_FILE_NOT_FOUND {
                Ok(())
            } else {
                Err(format!("删除注册表项失败 ({}): 错误码 {:?}", sub_key, status))
            }
        }
    }

    fn extract_exe_from_command(command: &str) -> Option<String> {
        let trimmed = command.trim();
        if trimmed.starts_with('"') {
            if let Some(end_idx) = trimmed[1..].find('"') {
                return Some(trimmed[1..=end_idx].to_string());
            }
        }
        trimmed.split_whitespace().next().map(|s| s.to_string())
    }

    pub fn get_status() -> Result<ShellIntegrationStatus, String> {
        let current_exe = get_current_exe_path()?.to_string_lossy().to_string();
        let file_cmd = read_reg_string(FILE_CMD_KEY, "");
        let dir_cmd = read_reg_string(DIR_CMD_KEY, "");

        let registered_file_exe = file_cmd.as_deref().and_then(extract_exe_from_command);
        let registered_dir_exe = dir_cmd.as_deref().and_then(extract_exe_from_command);

        let file_registered = registered_file_exe.is_some();
        let directory_registered = registered_dir_exe.is_some();

        let is_path_matched = match (&registered_file_exe, &registered_dir_exe) {
            (Some(f), Some(d)) => {
                f.eq_ignore_ascii_case(&current_exe) && d.eq_ignore_ascii_case(&current_exe)
            }
            (Some(f), None) => f.eq_ignore_ascii_case(&current_exe),
            (None, Some(d)) => d.eq_ignore_ascii_case(&current_exe),
            (None, None) => true,
        };

        Ok(ShellIntegrationStatus {
            supported: true,
            file_registered,
            directory_registered,
            current_exe_path: current_exe,
            registered_file_exe_path: registered_file_exe,
            registered_directory_exe_path: registered_dir_exe,
            is_path_matched,
            is_portable: is_portable(),
        })
    }

    pub fn register(options: &ShellIntegrationOptions) -> Result<ShellIntegrationStatus, String> {
        let current_exe = get_current_exe_path()?.to_string_lossy().to_string();
        let command_str = format!("\"{}\" --action add -- \"%1\"", current_exe);

        if options.enable_files {
            write_reg_string(FILE_SHELL_KEY, "", "使用打印助手打印")?;
            write_reg_string(FILE_SHELL_KEY, "Icon", &current_exe)?;
            write_reg_string(FILE_CMD_KEY, "", &command_str)?;
        } else {
            let _ = delete_reg_tree(FILE_SHELL_KEY);
        }

        if options.enable_directories {
            write_reg_string(DIR_SHELL_KEY, "", "使用打印助手打印文件夹")?;
            write_reg_string(DIR_SHELL_KEY, "Icon", &current_exe)?;
            write_reg_string(DIR_CMD_KEY, "", &command_str)?;
        } else {
            let _ = delete_reg_tree(DIR_SHELL_KEY);
        }

        get_status()
    }

    pub fn unregister() -> Result<ShellIntegrationStatus, String> {
        let _ = delete_reg_tree(FILE_SHELL_KEY);
        let _ = delete_reg_tree(DIR_SHELL_KEY);
        get_status()
    }

    pub fn repair() -> Result<ShellIntegrationStatus, String> {
        let current_status = get_status()?;
        register(&ShellIntegrationOptions {
            enable_files: current_status.file_registered || !current_status.directory_registered,
            enable_directories: current_status.directory_registered || !current_status.file_registered,
        })
    }
}

#[cfg(not(windows))]
mod fallback_impl {
    use super::*;

    pub fn get_status() -> Result<ShellIntegrationStatus, String> {
        let current_exe = get_current_exe_path()
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_else(|_| "PrintAssist".to_string());

        Ok(ShellIntegrationStatus {
            supported: false,
            file_registered: false,
            directory_registered: false,
            current_exe_path: current_exe,
            registered_file_exe_path: None,
            registered_directory_exe_path: None,
            is_path_matched: true,
            is_portable: is_portable(),
        })
    }

    pub fn register(_options: &ShellIntegrationOptions) -> Result<ShellIntegrationStatus, String> {
        get_status()
    }

    pub fn unregister() -> Result<ShellIntegrationStatus, String> {
        get_status()
    }

    pub fn repair() -> Result<ShellIntegrationStatus, String> {
        get_status()
    }
}

#[cfg(windows)]
pub use win_impl::*;

#[cfg(not(windows))]
pub use fallback_impl::*;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn gets_current_exe_and_status() {
        let status = get_status().unwrap();
        assert!(!status.current_exe_path.is_empty());
    }
}
