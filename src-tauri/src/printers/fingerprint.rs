use crate::contracts::{PrinterDriverFingerprint, PrinterProfileCompatibility, SystemPrinter};

pub const FINGERPRINT_SCHEMA_VERSION: u32 = 1;

/// Query the driver fingerprint for a system printer.
#[cfg(windows)]
pub fn query_printer_fingerprint(printer_name: &str) -> Result<PrinterDriverFingerprint, String> {
    use std::ffi::OsStr;
    use std::mem::size_of;
    use std::os::windows::ffi::OsStrExt;
    use windows::core::PCWSTR;
    use windows::Win32::Foundation::HANDLE;
    use windows::Win32::Graphics::Printing::{
        ClosePrinter, GetPrinterDriverW, GetPrinterW, OpenPrinterW, DRIVER_INFO_2W, PRINTER_INFO_2W,
    };

    if printer_name.trim().is_empty() {
        return Err("打印机名称不能为空".to_string());
    }

    let printer_wide: Vec<u16> = OsStr::new(printer_name)
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();

    let mut printer_handle = HANDLE::default();
    unsafe {
        OpenPrinterW(PCWSTR(printer_wide.as_ptr()), &mut printer_handle, None)
            .map_err(|error| format!("打开打印机失败：{error}"))?;
    }
    struct PrinterGuard(HANDLE);
    impl Drop for PrinterGuard {
        fn drop(&mut self) {
            unsafe {
                let _ = ClosePrinter(self.0);
            }
        }
    }
    let _guard = PrinterGuard(printer_handle);

    // 1. Query PRINTER_INFO_2W for driver name and port name
    let mut needed = 0_u32;
    unsafe {
        let _ = GetPrinterW(printer_handle, 2, None, &mut needed);
    }
    if needed == 0 {
        return Err("查询打印机信息大小失败".to_string());
    }

    let mut printer_buf = vec![0_u8; needed as usize];
    let ok = unsafe {
        GetPrinterW(
            printer_handle,
            2,
            Some(printer_buf.as_mut_ptr()),
            &mut needed,
        )
    };
    if ok.is_err() {
        return Err("读取打印机信息失败".to_string());
    }

    let info2 = unsafe { &*(printer_buf.as_ptr() as *const PRINTER_INFO_2W) };
    let driver_name = unsafe {
        if info2.pDriverName.is_null() {
            printer_name.to_string()
        } else {
            info2
                .pDriverName
                .to_string()
                .unwrap_or_else(|_| printer_name.to_string())
        }
    };
    let port_name = unsafe {
        if info2.pPortName.is_null() {
            None
        } else {
            info2.pPortName.to_string().ok().filter(|s| !s.is_empty())
        }
    };

    // 2. Query DRIVER_INFO_2W for driver environment and cVersion
    let mut driver_needed = 0_u32;
    unsafe {
        let _ = GetPrinterDriverW(printer_handle, None, 2, None, &mut driver_needed);
    }

    let (driver_version, environment) = if driver_needed > 0 {
        let mut driver_buf = vec![0_u8; driver_needed as usize];
        let driver_ok = unsafe {
            GetPrinterDriverW(
                printer_handle,
                None,
                2,
                Some(driver_buf.as_mut_ptr()),
                &mut driver_needed,
            )
        };
        if driver_ok.is_ok() && driver_buf.len() >= size_of::<DRIVER_INFO_2W>() {
            let drv2 = unsafe { &*(driver_buf.as_ptr() as *const DRIVER_INFO_2W) };
            let env = unsafe {
                if drv2.pEnvironment.is_null() {
                    "Windows x64".to_string()
                } else {
                    drv2.pEnvironment
                        .to_string()
                        .unwrap_or_else(|_| "Windows x64".to_string())
                }
            };
            (drv2.cVersion as u64, env)
        } else {
            (3_u64, "Windows x64".to_string())
        }
    } else {
        (3_u64, "Windows x64".to_string())
    };

    Ok(PrinterDriverFingerprint {
        fingerprint_version: FINGERPRINT_SCHEMA_VERSION,
        printer_name: printer_name.to_string(),
        driver_name,
        driver_version,
        environment,
        port_name,
    })
}

#[cfg(not(windows))]
pub fn query_printer_fingerprint(printer_name: &str) -> Result<PrinterDriverFingerprint, String> {
    if printer_name.trim().is_empty() {
        return Err("打印机名称不能为空".to_string());
    }
    Ok(PrinterDriverFingerprint {
        fingerprint_version: FINGERPRINT_SCHEMA_VERSION,
        printer_name: printer_name.to_string(),
        driver_name: format!("{printer_name} Driver"),
        driver_version: 3,
        environment: "Mock Environment".to_string(),
        port_name: Some("LPT1:".to_string()),
    })
}

/// Evaluates compatibility of a stored profile against current system printers and active driver.
pub fn evaluate_profile_compatibility(
    stored_fingerprint: &PrinterDriverFingerprint,
    available_printers: &[SystemPrinter],
    current_driver_fingerprint: Option<&PrinterDriverFingerprint>,
) -> PrinterProfileCompatibility {
    let printer_exists = available_printers.iter().any(|p| {
        p.name
            .eq_ignore_ascii_case(&stored_fingerprint.printer_name)
    });

    if !printer_exists {
        return PrinterProfileCompatibility::PrinterUnavailable;
    }

    let Some(current) = current_driver_fingerprint else {
        // If driver fingerprint query failed but printer exists, mark driver changed to be safe
        return PrinterProfileCompatibility::DriverChanged;
    };

    if stored_fingerprint.fingerprint_version != current.fingerprint_version {
        return PrinterProfileCompatibility::UnsupportedSchema;
    }

    if stored_fingerprint
        .driver_name
        .eq_ignore_ascii_case(&current.driver_name)
        && stored_fingerprint.driver_version == current.driver_version
        && stored_fingerprint
            .environment
            .eq_ignore_ascii_case(&current.environment)
    {
        PrinterProfileCompatibility::Compatible
    } else {
        PrinterProfileCompatibility::DriverChanged
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::contracts::{
        CapabilitySource, CapabilitySupport, PrinterCapability, PrinterOperationalState,
    };

    fn make_test_printer(name: &str) -> SystemPrinter {
        SystemPrinter {
            name: name.to_string(),
            port_name: Some("USB001".to_string()),
            is_default: false,
            state: PrinterOperationalState::Ready,
            status_code: 0,
            color: PrinterCapability {
                support: CapabilitySupport::Supported,
                source: CapabilitySource::Driver,
                detail: None,
            },
            duplex: PrinterCapability {
                support: CapabilitySupport::Supported,
                source: CapabilitySource::Driver,
                detail: None,
            },
            error: None,
        }
    }

    #[test]
    fn compatibility_compatible_when_exact_match() {
        let stored = PrinterDriverFingerprint {
            fingerprint_version: 1,
            printer_name: "Canon TS8300".to_string(),
            driver_name: "Canon TS8300 Series".to_string(),
            driver_version: 4,
            environment: "Windows x64".to_string(),
            port_name: Some("USB001".to_string()),
        };

        let current = stored.clone();
        let printers = vec![make_test_printer("Canon TS8300")];

        let status = evaluate_profile_compatibility(&stored, &printers, Some(&current));
        assert_eq!(status, PrinterProfileCompatibility::Compatible);
    }

    #[test]
    fn compatibility_printer_unavailable_when_printer_missing() {
        let stored = PrinterDriverFingerprint {
            fingerprint_version: 1,
            printer_name: "Canon TS8300".to_string(),
            driver_name: "Canon TS8300 Series".to_string(),
            driver_version: 4,
            environment: "Windows x64".to_string(),
            port_name: None,
        };

        let current = stored.clone();
        let printers = vec![make_test_printer("HP LaserJet")];

        let status = evaluate_profile_compatibility(&stored, &printers, Some(&current));
        assert_eq!(status, PrinterProfileCompatibility::PrinterUnavailable);
    }

    #[test]
    fn compatibility_driver_changed_when_version_or_driver_differs() {
        let stored = PrinterDriverFingerprint {
            fingerprint_version: 1,
            printer_name: "Canon TS8300".to_string(),
            driver_name: "Canon TS8300 Series".to_string(),
            driver_version: 3,
            environment: "Windows x64".to_string(),
            port_name: None,
        };

        let current = PrinterDriverFingerprint {
            fingerprint_version: 1,
            printer_name: "Canon TS8300".to_string(),
            driver_name: "Canon TS8300 Series v2".to_string(),
            driver_version: 4,
            environment: "Windows x64".to_string(),
            port_name: None,
        };
        let printers = vec![make_test_printer("Canon TS8300")];

        let status = evaluate_profile_compatibility(&stored, &printers, Some(&current));
        assert_eq!(status, PrinterProfileCompatibility::DriverChanged);
    }
}
