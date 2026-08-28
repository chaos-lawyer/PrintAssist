use std::collections::HashMap;
#[cfg(windows)]
use std::mem::size_of;

#[cfg(windows)]
use std::ffi::OsStr;
#[cfg(windows)]
use std::os::windows::ffi::OsStrExt;

#[cfg(windows)]
use windows::core::PCWSTR;
#[cfg(windows)]
use windows::Win32::Foundation::{HANDLE, HWND};
#[cfg(windows)]
use windows::Win32::Graphics::Gdi::{
    DEVMODEW, DMCOLOR_COLOR, DMCOLOR_MONOCHROME, DMDUP_HORIZONTAL, DMDUP_SIMPLEX, DMDUP_VERTICAL,
    DMORIENT_LANDSCAPE, DMORIENT_PORTRAIT, DM_COLOR, DM_DEFAULTSOURCE, DM_DUPLEX, DM_IN_BUFFER,
    DM_ORIENTATION, DM_OUT_BUFFER, DM_PAPERLENGTH, DM_PAPERSIZE, DM_PAPERWIDTH, DM_PRINTQUALITY,
};
#[cfg(windows)]
use windows::Win32::Graphics::Printing::{ClosePrinter, DocumentPropertiesW, OpenPrinterW};

use crate::contracts::PrinterDriverSettings;

/// Validates that a byte buffer contains a structurally sound Win32 DEVMODEW.
pub fn validate_devmode_buffer(devmode_bytes: &[u8]) -> Result<(), String> {
    #[cfg(windows)]
    {
        if devmode_bytes.len() < size_of::<DEVMODEW>() {
            return Err(format!(
                "DEVMODE 缓冲区过短：got {} bytes, expected at least {} bytes",
                devmode_bytes.len(),
                size_of::<DEVMODEW>()
            ));
        }

        let devmode = unsafe { &*(devmode_bytes.as_ptr() as *const DEVMODEW) };
        let dm_size = devmode.dmSize as usize;
        let dm_driver_extra = devmode.dmDriverExtra as usize;

        // dmSize must be at least the size of the standard DEVMODEW header
        if dm_size < size_of::<DEVMODEW>() {
            return Err(format!(
                "DEVMODE dmSize 非法：{dm_size} (小于最小头部 {})",
                size_of::<DEVMODEW>()
            ));
        }

        let total_declared = dm_size
            .checked_add(dm_driver_extra)
            .ok_or_else(|| "DEVMODE 总大小计算溢出".to_string())?;

        if total_declared > devmode_bytes.len() {
            return Err(format!(
                "DEVMODE 越界：dmSize({dm_size}) + dmDriverExtra({dm_driver_extra}) = {total_declared} > buffer.len()({})",
                devmode_bytes.len()
            ));
        }

        Ok(())
    }

    #[cfg(not(windows))]
    {
        let _ = devmode_bytes;
        Err("非 Windows 平台不支持 DEVMODE 校验".to_string())
    }
}

/// Parses standard fields from a raw DEVMODEW buffer, mapping paper/bin codes to names when available.
pub fn parse_devmode_standard_fields(
    printer_name: &str,
    devmode_bytes: &[u8],
    paper_name_lookup: Option<&HashMap<i16, String>>,
    source_name_lookup: Option<&HashMap<i16, String>>,
) -> Result<PrinterDriverSettings, String> {
    validate_devmode_buffer(devmode_bytes)?;

    #[cfg(windows)]
    {
        let devmode = unsafe { &*(devmode_bytes.as_ptr() as *const DEVMODEW) };
        let fields = devmode.dmFields;

        let (
            paper_code,
            paper_width_tenth_mm,
            paper_length_tenth_mm,
            orientation,
            source_code,
            print_quality,
            color_mode,
            sides_mode,
            flip_mode,
        ) = unsafe {
            let p_code = if (fields & DM_PAPERSIZE).0 != 0 {
                Some(devmode.Anonymous1.Anonymous1.dmPaperSize)
            } else {
                None
            };

            let p_width = if (fields & DM_PAPERWIDTH).0 != 0 {
                Some(devmode.Anonymous1.Anonymous1.dmPaperWidth)
            } else {
                None
            };

            let p_length = if (fields & DM_PAPERLENGTH).0 != 0 {
                Some(devmode.Anonymous1.Anonymous1.dmPaperLength)
            } else {
                None
            };

            let orient = if (fields & DM_ORIENTATION).0 != 0 {
                let code = devmode.Anonymous1.Anonymous1.dmOrientation;
                if code == DMORIENT_LANDSCAPE as i16 {
                    Some("landscape".to_string())
                } else if code == DMORIENT_PORTRAIT as i16 {
                    Some("portrait".to_string())
                } else {
                    None
                }
            } else {
                None
            };

            let src_code = if (fields & DM_DEFAULTSOURCE).0 != 0 {
                Some(devmode.Anonymous1.Anonymous1.dmDefaultSource)
            } else {
                None
            };

            let quality = if (fields & DM_PRINTQUALITY).0 != 0 {
                Some(devmode.Anonymous1.Anonymous1.dmPrintQuality)
            } else {
                None
            };

            let color = if (fields & DM_COLOR).0 != 0 {
                let code = devmode.dmColor;
                if code == DMCOLOR_COLOR {
                    Some("color".to_string())
                } else if code == DMCOLOR_MONOCHROME {
                    Some("monochrome".to_string())
                } else {
                    None
                }
            } else {
                None
            };

            let (sides, flip) = if (fields & DM_DUPLEX).0 != 0 {
                let code = devmode.dmDuplex;
                if code == DMDUP_SIMPLEX {
                    (Some("simplex".to_string()), None)
                } else if code == DMDUP_VERTICAL {
                    (Some("duplex".to_string()), Some("longEdge".to_string()))
                } else if code == DMDUP_HORIZONTAL {
                    (Some("duplex".to_string()), Some("shortEdge".to_string()))
                } else {
                    (None, None)
                }
            } else {
                (None, None)
            };

            (
                p_code, p_width, p_length, orient, src_code, quality, color, sides, flip,
            )
        };

        let paper_name = paper_code
            .and_then(|code| paper_name_lookup.and_then(|lookup| lookup.get(&code).cloned()));

        let source_name = source_code
            .and_then(|code| source_name_lookup.and_then(|lookup| lookup.get(&code).cloned()));

        let driver_extra_bytes = devmode.dmDriverExtra as usize;

        Ok(PrinterDriverSettings {
            printer_name: printer_name.to_string(),
            paper_code,
            paper_name,
            paper_width_tenth_mm,
            paper_length_tenth_mm,
            source_code,
            source_name,
            color_mode,
            sides_mode,
            flip_mode,
            orientation,
            print_quality,
            driver_extra_bytes,
        })
    }

    #[cfg(not(windows))]
    {
        let _ = (
            printer_name,
            devmode_bytes,
            paper_name_lookup,
            source_name_lookup,
        );
        Err("非 Windows 平台不支持 DEVMODE 解析".to_string())
    }
}

/// Overwrites color, duplex, and flip settings onto an existing DEVMODE buffer without corrupting private data.
pub fn apply_settings_to_devmode(
    devmode_bytes: &mut [u8],
    color_mode: Option<&str>,
    sides_mode: Option<&str>,
    flip_mode: Option<&str>,
) -> Result<(), String> {
    validate_devmode_buffer(devmode_bytes)?;

    #[cfg(windows)]
    {
        let devmode = unsafe { &mut *(devmode_bytes.as_mut_ptr() as *mut DEVMODEW) };

        if let Some(color) = color_mode {
            devmode.dmFields |= DM_COLOR;
            if color.eq_ignore_ascii_case("color") {
                devmode.dmColor = DMCOLOR_COLOR;
            } else {
                devmode.dmColor = DMCOLOR_MONOCHROME;
            }
        }

        if let Some(sides) = sides_mode {
            devmode.dmFields |= DM_DUPLEX;
            if sides.eq_ignore_ascii_case("duplex") {
                if let Some(flip) = flip_mode {
                    if flip.eq_ignore_ascii_case("shortEdge") {
                        devmode.dmDuplex = DMDUP_HORIZONTAL;
                    } else {
                        devmode.dmDuplex = DMDUP_VERTICAL;
                    }
                } else {
                    devmode.dmDuplex = DMDUP_VERTICAL;
                }
            } else {
                devmode.dmDuplex = DMDUP_SIMPLEX;
            }
        }

        Ok(())
    }

    #[cfg(not(windows))]
    {
        let _ = (color_mode, sides_mode, flip_mode);
        Err("非 Windows 平台不支持 DEVMODE 修改".to_string())
    }
}

/// Applies page orientation to DEVMODE based on rendered image aspect ratio.
pub fn set_orientation_from_content(
    devmode_bytes: &mut [u8],
    content_width: u32,
    content_height: u32,
) {
    #[cfg(windows)]
    {
        if devmode_bytes.len() < size_of::<DEVMODEW>() {
            return;
        }

        let devmode = unsafe { &mut *(devmode_bytes.as_mut_ptr() as *mut DEVMODEW) };
        let requested_orientation = if content_width > content_height {
            DMORIENT_LANDSCAPE
        } else {
            DMORIENT_PORTRAIT
        };

        devmode.dmFields |= DM_ORIENTATION;
        devmode.Anonymous1.Anonymous1.dmOrientation = requested_orientation as i16;
    }

    #[cfg(not(windows))]
    {
        let _ = (devmode_bytes, content_width, content_height);
    }
}

/// Queries the full system default DEVMODE for a printer.
#[cfg(windows)]
pub fn query_default_devmode(
    printer_handle: HANDLE,
    printer_name: &str,
) -> Result<Vec<u8>, String> {
    let printer_wide = null_terminated_wide(printer_name);
    let needed = unsafe {
        DocumentPropertiesW(
            HWND::default(),
            printer_handle,
            PCWSTR(printer_wide.as_ptr()),
            None,
            None,
            0,
        )
    };
    if needed <= 0 {
        return Err(format!("查询打印机 “{printer_name}” DEVMODE 大小失败"));
    }

    let mut buffer = vec![0_u8; needed as usize];
    let filled = unsafe {
        DocumentPropertiesW(
            HWND::default(),
            printer_handle,
            PCWSTR(printer_wide.as_ptr()),
            Some(buffer.as_mut_ptr() as *mut DEVMODEW),
            None,
            DM_OUT_BUFFER.0,
        )
    };
    if filled < 0 {
        return Err(format!("读取打印机 “{printer_name}” DEVMODE 失败"));
    }

    validate_devmode_buffer(&buffer)?;
    Ok(buffer)
}

/// Rebuilds a DEVMODE from the printer driver's current defaults while preserving
/// the standard settings that can be safely migrated from a saved profile.
#[cfg(windows)]
pub fn rebuild_devmode_from_settings(
    printer_name: &str,
    color_mode: Option<&str>,
    sides_mode: Option<&str>,
    flip_mode: Option<&str>,
) -> Result<Vec<u8>, String> {
    let printer_wide = null_terminated_wide(printer_name);
    let mut printer_handle = HANDLE::default();
    unsafe {
        OpenPrinterW(PCWSTR(printer_wide.as_ptr()), &mut printer_handle, None)
            .map_err(|error| format!("打开打印机 “{printer_name}” 失败：{error}"))?;
    }

    struct PrinterGuard(HANDLE);
    impl Drop for PrinterGuard {
        fn drop(&mut self) {
            unsafe {
                let _ = ClosePrinter(self.0);
            }
        }
    }
    let _printer_guard = PrinterGuard(printer_handle);

    let mut devmode = query_default_devmode(printer_handle, printer_name)?;
    apply_settings_to_devmode(&mut devmode, color_mode, sides_mode, flip_mode)?;
    validate_devmode_with_driver(printer_handle, printer_name, &devmode)
}

/// Submits an in-memory DEVMODE buffer to DocumentPropertiesW(DM_IN_BUFFER | DM_OUT_BUFFER)
/// so the driver validates and merges fields against its internal capability model.
#[cfg(windows)]
pub fn validate_devmode_with_driver(
    printer_handle: HANDLE,
    printer_name: &str,
    devmode_bytes: &[u8],
) -> Result<Vec<u8>, String> {
    let printer_wide = null_terminated_wide(printer_name);
    let needed = unsafe {
        DocumentPropertiesW(
            HWND::default(),
            printer_handle,
            PCWSTR(printer_wide.as_ptr()),
            None,
            None,
            0,
        )
    };
    let buffer_size = if needed > 0 {
        (needed as usize).max(devmode_bytes.len())
    } else {
        devmode_bytes.len()
    };

    let mut validated = vec![0_u8; buffer_size];
    let result = unsafe {
        DocumentPropertiesW(
            HWND::default(),
            printer_handle,
            PCWSTR(printer_wide.as_ptr()),
            Some(validated.as_mut_ptr() as *mut DEVMODEW),
            Some(devmode_bytes.as_ptr() as *const DEVMODEW),
            DM_IN_BUFFER.0 | DM_OUT_BUFFER.0,
        )
    };

    if result < 0 {
        // Driver validation rejected changes; fall back to the input buffer
        return Ok(devmode_bytes.to_vec());
    }

    if validate_devmode_buffer(&validated).is_ok() {
        Ok(validated)
    } else {
        Ok(devmode_bytes.to_vec())
    }
}

#[cfg(windows)]
fn null_terminated_wide(value: &str) -> Vec<u16> {
    OsStr::new(value)
        .encode_wide()
        .chain(std::iter::once(0))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_too_short_devmode_buffer() {
        let short_buffer = vec![0_u8; 10];
        assert!(validate_devmode_buffer(&short_buffer).is_err());
    }

    #[cfg(windows)]
    #[test]
    fn parses_and_overrides_devmode_fields_preserving_extra() {
        use std::mem::zeroed;

        let extra_bytes = vec![0xAA_u8; 128];
        let devmode_size = size_of::<DEVMODEW>();
        let mut full_buffer = vec![0_u8; devmode_size + extra_bytes.len()];

        let devmode_ptr = full_buffer.as_mut_ptr() as *mut DEVMODEW;
        unsafe {
            let mut init: DEVMODEW = zeroed();
            init.dmSize = devmode_size as u16;
            init.dmDriverExtra = extra_bytes.len() as u16;
            init.dmFields = DM_COLOR | DM_DUPLEX | DM_PAPERSIZE;
            init.dmColor = DMCOLOR_COLOR;
            init.dmDuplex = DMDUP_VERTICAL;
            init.Anonymous1.Anonymous1.dmPaperSize = 9; // A4
            *devmode_ptr = init;
        }

        // Copy extra bytes into the trailing section
        full_buffer[devmode_size..].copy_from_slice(&extra_bytes);

        assert!(validate_devmode_buffer(&full_buffer).is_ok());

        // Parse initial fields
        let mut paper_lookup = HashMap::new();
        paper_lookup.insert(9, "A4".to_string());
        let settings =
            parse_devmode_standard_fields("Test Printer", &full_buffer, Some(&paper_lookup), None)
                .expect("parse initial devmode");

        assert_eq!(settings.color_mode, Some("color".to_string()));
        assert_eq!(settings.sides_mode, Some("duplex".to_string()));
        assert_eq!(settings.flip_mode, Some("longEdge".to_string()));
        assert_eq!(settings.paper_code, Some(9));
        assert_eq!(settings.paper_name, Some("A4".to_string()));
        assert_eq!(settings.driver_extra_bytes, 128);

        // Apply override: change to monochrome + simplex
        apply_settings_to_devmode(&mut full_buffer, Some("monochrome"), Some("simplex"), None)
            .expect("apply overrides");

        let updated =
            parse_devmode_standard_fields("Test Printer", &full_buffer, Some(&paper_lookup), None)
                .expect("parse updated devmode");

        assert_eq!(updated.color_mode, Some("monochrome".to_string()));
        assert_eq!(updated.sides_mode, Some("simplex".to_string()));
        assert_eq!(updated.flip_mode, None);
        assert_eq!(updated.paper_name, Some("A4".to_string()));

        // Check that driver extra bytes remained intact
        assert_eq!(&full_buffer[devmode_size..], extra_bytes.as_slice());
    }
}
