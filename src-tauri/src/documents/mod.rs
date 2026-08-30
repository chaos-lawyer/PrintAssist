pub mod nup_layout;
pub mod office;
pub mod office_provider;
pub mod page_range;
pub mod pdf_annotations;
pub mod pdf_pages;

#[cfg(windows)]
pub mod image_print;
#[cfg(windows)]
pub mod office_com;
#[cfg(windows)]
pub mod office_print;
#[cfg(windows)]
pub mod pdf_print;
#[cfg(windows)]
pub mod pdf_raster_d2d;
#[cfg(windows)]
pub mod print_shell;

use std::path::Path;

pub const SUPPORTED_EXTENSIONS: &[&str] = &[
    "pdf", // Images
    "png", "jpg", "jpeg", "jpe", "jfif", "bmp", "dib", "tif", "tiff", "gif", "webp", "ico", "heic",
    "heif", "avif", "emf", "wmf", // Text
    "txt", "log", "md", // Word / WPS 文字
    "doc", "docx", "dot", "dotx", "dotm", "docm", "wps", "wpt", // Excel / WPS 表格
    "xls", "xlsx", "xlt", "xltx", "xltm", "xlsm", "et", "ett",
    // PowerPoint / WPS 演示
    "ppt", "pptx", "pot", "potx", "potm", "pps", "ppsx", "ppsm", "pptm", "dps", "dpt",
];

pub fn is_wps_native_extension(ext: &str) -> bool {
    matches!(
        ext.to_ascii_lowercase().as_str(),
        "wps" | "wpt" | "et" | "ett" | "dps" | "dpt"
    )
}

pub fn is_supported_file(path: &Path) -> bool {
    path.extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| {
            SUPPORTED_EXTENSIONS
                .iter()
                .any(|supported| supported.eq_ignore_ascii_case(ext))
        })
        .unwrap_or(false)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DocumentKind {
    Pdf,
    Image,
    Text,
    Word,
    Excel,
    PowerPoint,
    Unknown,
}

pub fn detect_document_kind(path: &Path) -> DocumentKind {
    match path
        .extension()
        .and_then(|extension| extension.to_str())
        .unwrap_or("")
        .to_ascii_lowercase()
        .as_str()
    {
        "pdf" => DocumentKind::Pdf,
        "png" | "jpg" | "jpeg" | "jpe" | "jfif" | "bmp" | "dib" | "tif" | "tiff" | "gif"
        | "webp" | "ico" | "heic" | "heif" | "avif" | "emf" | "wmf" => DocumentKind::Image,
        "txt" | "log" | "md" => DocumentKind::Text,
        "doc" | "docx" | "dot" | "dotx" | "dotm" | "docm" | "wps" | "wpt" => DocumentKind::Word,
        "xls" | "xlsx" | "xlt" | "xltx" | "xltm" | "xlsm" | "et" | "ett" => DocumentKind::Excel,
        "ppt" | "pptx" | "pot" | "potx" | "potm" | "pps" | "ppsx" | "ppsm" | "pptm" | "dps"
        | "dpt" => DocumentKind::PowerPoint,
        _ => DocumentKind::Unknown,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;

    #[test]
    fn detects_common_image_formats() {
        for extension in [
            "webp", "jfif", "jpe", "dib", "ico", "heic", "heif", "avif", "emf", "wmf", "png", "jpg",
        ] {
            let path_string = format!("C:\\tmp\\sample.{extension}");
            let path = Path::new(&path_string);
            assert_eq!(detect_document_kind(path), DocumentKind::Image);
        }
    }

    #[test]
    fn detects_wps_and_extended_office_formats() {
        for ext in ["wps", "wpt", "doc", "docx", "dot", "dotx", "dotm", "docm"] {
            let path = Path::new("test").with_extension(ext);
            assert_eq!(detect_document_kind(&path), DocumentKind::Word);
            assert!(is_supported_file(&path));
        }

        for ext in ["et", "ett", "xls", "xlsx", "xlt", "xltx", "xltm", "xlsm"] {
            let path = Path::new("test").with_extension(ext);
            assert_eq!(detect_document_kind(&path), DocumentKind::Excel);
            assert!(is_supported_file(&path));
        }

        for ext in [
            "dps", "dpt", "ppt", "pptx", "pot", "potx", "potm", "pps", "ppsx", "ppsm", "pptm",
        ] {
            let path = Path::new("test").with_extension(ext);
            assert_eq!(detect_document_kind(&path), DocumentKind::PowerPoint);
            assert!(is_supported_file(&path));
        }

        assert!(is_wps_native_extension("wps"));
        assert!(is_wps_native_extension("et"));
        assert!(is_wps_native_extension("dps"));
        assert!(!is_wps_native_extension("docx"));
        assert!(!is_wps_native_extension("pdf"));
    }
}
