pub mod devmode;
pub mod profile_store;

pub use profile_store::{PrinterProfileStore, StoredPrinterProfile};

#[cfg(windows)]
mod win32;

#[cfg(windows)]
pub use win32::{
    list_system_printers_sync, open_printer_properties_sync, query_bin_names_map,
    query_paper_names_map, PrinterPropertiesOutcome,
};

#[cfg(not(windows))]
use crate::contracts::SystemPrinter;

#[cfg(not(windows))]
pub enum PrinterPropertiesOutcome {
    Accepted(Vec<u8>),
    Cancelled,
}

#[cfg(not(windows))]
pub fn list_system_printers_sync() -> Result<Vec<SystemPrinter>, String> {
    Err("system printer discovery is unsupported on this operating system".to_string())
}

#[cfg(not(windows))]
pub fn open_printer_properties_sync(
    _printer_name: &str,
    _input_devmode: Option<&[u8]>,
) -> Result<PrinterPropertiesOutcome, String> {
    Err("打印机属性配置仅支持 Windows 系统".to_string())
}

#[cfg(not(windows))]
pub fn query_paper_names_map(
    _printer_name: &str,
    _port_name: Option<&str>,
) -> std::collections::HashMap<i16, String> {
    std::collections::HashMap::new()
}

#[cfg(not(windows))]
pub fn query_bin_names_map(
    _printer_name: &str,
    _port_name: Option<&str>,
) -> std::collections::HashMap<i16, String> {
    std::collections::HashMap::new()
}
