use std::fs::File;
use std::io::Read;
use std::path::Path;
use std::time::UNIX_EPOCH;

use quick_xml::events::Event;
use quick_xml::name::ResolveResult;
use quick_xml::reader::NsReader;
use serde::{Deserialize, Serialize};

pub const MAX_DOCX_APP_XML_BYTES: u64 = 1024 * 1024; // 1 MiB
pub const MAX_PDF_BYTES: u64 = 100 * 1024 * 1024; // 100 MiB

const OPENXML_EXTENDED_PROPERTIES_NS: &[u8] =
    b"http://schemas.openxmlformats.org/officeDocument/2006/extended-properties";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ReferencePageCountResult {
    pub path: String,
    pub page_count: Option<u32>,
    pub status: ReferencePageCountStatus,
    pub source: Option<ReferencePageCountSource>,
    pub reason: Option<String>,
    pub file_size: Option<u64>,
    pub modified_at: Option<i64>,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ReferencePageCountStatus {
    Available,
    Unavailable,
    Unsupported,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ReferencePageCountSource {
    DocxMetadata,
    PdfPageTree,
}

/// Reads the reference page count of a document (.docx or .pdf).
/// This never launches Office, never renders pages, and only inspects lightweight structure.
pub fn read_reference_page_count(path: &Path) -> ReferencePageCountResult {
    let path_str = path.to_string_lossy().to_string();

    let meta = match std::fs::metadata(path) {
        Ok(m) => m,
        Err(err) => {
            let reason = match err.kind() {
                std::io::ErrorKind::NotFound => "fileNotFound",
                std::io::ErrorKind::PermissionDenied => "accessDenied",
                _ => "ioError",
            };
            return ReferencePageCountResult {
                path: path_str,
                page_count: None,
                status: ReferencePageCountStatus::Unavailable,
                source: None,
                reason: Some(reason.to_string()),
                file_size: None,
                modified_at: None,
            };
        }
    };

    let file_size = meta.len();
    let modified_at = meta
        .modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as i64);

    let ext = path
        .extension()
        .and_then(|s| s.to_str())
        .map(|s| s.to_ascii_lowercase())
        .unwrap_or_default();

    match ext.as_str() {
        "docx" => {
            let (count, reason) = read_docx_reference_pages(path);
            let status = if count.is_some() {
                ReferencePageCountStatus::Available
            } else {
                ReferencePageCountStatus::Unavailable
            };
            ReferencePageCountResult {
                path: path_str,
                page_count: count,
                status,
                source: Some(ReferencePageCountSource::DocxMetadata),
                reason,
                file_size: Some(file_size),
                modified_at,
            }
        }
        "pdf" => {
            let (count, reason) = read_pdf_reference_pages(path, file_size);
            let status = if count.is_some() {
                ReferencePageCountStatus::Available
            } else {
                ReferencePageCountStatus::Unavailable
            };
            ReferencePageCountResult {
                path: path_str,
                page_count: count,
                status,
                source: Some(ReferencePageCountSource::PdfPageTree),
                reason,
                file_size: Some(file_size),
                modified_at,
            }
        }
        _ => ReferencePageCountResult {
            path: path_str,
            page_count: None,
            status: ReferencePageCountStatus::Unsupported,
            source: None,
            reason: Some("unsupportedFormat".to_string()),
            file_size: Some(file_size),
            modified_at,
        },
    }
}

/// Inspects DOCX ZIP central directory and docProps/app.xml for the <Pages> tag.
fn read_docx_reference_pages(path: &Path) -> (Option<u32>, Option<String>) {
    let file = match File::open(path) {
        Ok(f) => f,
        Err(err) => {
            let reason = match err.kind() {
                std::io::ErrorKind::NotFound => "fileNotFound",
                std::io::ErrorKind::PermissionDenied => "accessDenied",
                _ => "ioError",
            };
            return (None, Some(reason.to_string()));
        }
    };

    let mut archive = match zip::ZipArchive::new(file) {
        Ok(a) => a,
        Err(zip::result::ZipError::FileNotFound) => return (None, Some("fileNotFound".to_string())),
        Err(_) => return (None, Some("corruptZip".to_string())),
    };

    let mut app_xml_file = match archive.by_name("docProps/app.xml") {
        Ok(f) => f,
        Err(zip::result::ZipError::FileNotFound) => {
            return (None, Some("missingAttribute".to_string()))
        }
        Err(_) => return (None, Some("corruptZip".to_string())),
    };

    if app_xml_file.size() > MAX_DOCX_APP_XML_BYTES {
        return (None, Some("fileTooLarge".to_string()));
    }

    let mut buffer = Vec::with_capacity(std::cmp::min(app_xml_file.size() as usize, 64 * 1024));
    let mut limited_reader = (&mut app_xml_file).take(MAX_DOCX_APP_XML_BYTES + 1);
    if let Err(_) = limited_reader.read_to_end(&mut buffer) {
        return (None, Some("corruptZip".to_string()));
    }

    if buffer.len() as u64 > MAX_DOCX_APP_XML_BYTES {
        return (None, Some("fileTooLarge".to_string()));
    }

    parse_docx_app_xml(&buffer)
}

/// Parses docProps/app.xml with XML namespace support to find <Pages>.
fn parse_docx_app_xml(xml_bytes: &[u8]) -> (Option<u32>, Option<String>) {
    let mut reader = NsReader::from_reader(xml_bytes);
    reader.config_mut().trim_text(true);

    let mut buf = Vec::new();
    let mut in_pages = false;
    let mut pages_text = String::new();

    loop {
        match reader.read_event_into(&mut buf) {
            Ok(Event::Start(e)) => {
                let (resolve, local) = reader.resolver().resolve_element(e.name());
                let is_ext_ns = match resolve {
                    ResolveResult::Bound(ns) => ns.as_ref() == OPENXML_EXTENDED_PROPERTIES_NS,
                    ResolveResult::Unbound => true,
                    _ => false,
                };
                if local.as_ref() == b"Pages" && is_ext_ns {
                    in_pages = true;
                    pages_text.clear();
                }
            }
            Ok(Event::Text(t)) if in_pages => {
                if let Ok(text) = std::str::from_utf8(t.as_ref()) {
                    pages_text.push_str(text);
                }
            }
            Ok(Event::End(e)) => {
                let (_, local) = reader.resolver().resolve_element(e.name());
                if local.as_ref() == b"Pages" && in_pages {
                    let trimmed = pages_text.trim();
                    if let Ok(num) = trimmed.parse::<u32>() {
                        if num > 0 {
                            return (Some(num), None);
                        } else {
                            return (None, Some("zeroPages".to_string()));
                        }
                    } else {
                        return (None, Some("invalidNumber".to_string()));
                    }
                }
            }
            Ok(Event::Eof) => break,
            Err(_) => return (None, Some("corruptXml".to_string())),
            _ => {}
        }
        buf.clear();
    }

    (None, Some("missingAttribute".to_string()))
}

/// Reads the page count of a PDF using `lopdf`.
fn read_pdf_reference_pages(path: &Path, file_size: u64) -> (Option<u32>, Option<String>) {
    if file_size > MAX_PDF_BYTES {
        return (None, Some("fileTooLarge".to_string()));
    }

    match lopdf::Document::load(path) {
        Ok(doc) => {
            let is_enc = doc.is_encrypted();
            let pages = doc.get_pages();
            let count = pages.len() as u32;
            if count > 0 {
                (Some(count), None)
            } else if is_enc {
                (None, Some("encryptedPdf".to_string()))
            } else {
                (None, Some("zeroPages".to_string()))
            }
        }
        Err(err) => {
            let msg = err.to_string().to_ascii_lowercase();
            if msg.contains("encrypted") || msg.contains("password") {
                (None, Some("encryptedPdf".to_string()))
            } else {
                (None, Some("corruptPdf".to_string()))
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use zip::write::SimpleFileOptions;

    #[test]
    fn parses_valid_docx_app_xml_with_namespace() {
        let xml = br#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">
    <Template>Normal.dotm</Template>
    <TotalTime>1</TotalTime>
    <Pages>24</Pages>
    <Words>4500</Words>
    <Characters>25000</Characters>
    <Application>Microsoft Office Word</Application>
</Properties>"#;

        let (count, reason) = parse_docx_app_xml(xml);
        assert_eq!(count, Some(24));
        assert_eq!(reason, None);
    }

    #[test]
    fn parses_docx_app_xml_with_prefixed_namespace() {
        let xml = br#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<ep:Properties xmlns:ep="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties">
    <ep:Pages>5</ep:Pages>
</ep:Properties>"#;

        let (count, reason) = parse_docx_app_xml(xml);
        assert_eq!(count, Some(5));
        assert_eq!(reason, None);
    }

    #[test]
    fn rejects_missing_pages_attribute() {
        let xml = br#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties">
    <Words>100</Words>
</Properties>"#;

        let (count, reason) = parse_docx_app_xml(xml);
        assert_eq!(count, None);
        assert_eq!(reason, Some("missingAttribute".to_string()));
    }

    #[test]
    fn rejects_zero_or_invalid_pages() {
        let xml_zero = br#"<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Pages>0</Pages></Properties>"#;
        let (count, reason) = parse_docx_app_xml(xml_zero);
        assert_eq!(count, None);
        assert_eq!(reason, Some("zeroPages".to_string()));

        let xml_invalid = br#"<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Pages>abc</Pages></Properties>"#;
        let (count, reason) = parse_docx_app_xml(xml_invalid);
        assert_eq!(count, None);
        assert_eq!(reason, Some("invalidNumber".to_string()));
    }

    #[test]
    fn handles_corrupt_xml() {
        let xml_corrupt = b"<Properties><Pages>5</";
        let (count, reason) = parse_docx_app_xml(xml_corrupt);
        assert_eq!(count, None);
        assert_eq!(reason, Some("corruptXml".to_string()));
    }

    #[test]
    fn reads_mock_docx_zip_file() {
        let temp_dir = std::env::temp_dir();
        let docx_path = temp_dir.join(format!("test_doc_{}.docx", uuid::Uuid::new_v4()));

        let file = File::create(&docx_path).unwrap();
        let mut zip = zip::ZipWriter::new(file);

        let options = SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);
        zip.start_file("docProps/app.xml", options).unwrap();
        zip.write_all(br#"<?xml version="1.0"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Pages>17</Pages></Properties>"#).unwrap();
        zip.finish().unwrap();

        let result = read_reference_page_count(&docx_path);
        assert_eq!(result.status, ReferencePageCountStatus::Available);
        assert_eq!(result.page_count, Some(17));
        assert_eq!(result.source, Some(ReferencePageCountSource::DocxMetadata));
        assert_eq!(result.reason, None);

        let _ = std::fs::remove_file(&docx_path);
    }

    #[test]
    fn marks_unsupported_formats() {
        let temp_dir = std::env::temp_dir();
        let txt_path = temp_dir.join(format!("test_doc_{}.txt", uuid::Uuid::new_v4()));
        std::fs::write(&txt_path, "hello world").unwrap();

        let result = read_reference_page_count(&txt_path);
        assert_eq!(result.status, ReferencePageCountStatus::Unsupported);
        assert_eq!(result.reason, Some("unsupportedFormat".to_string()));
        assert_eq!(result.page_count, None);

        let _ = std::fs::remove_file(&txt_path);
    }
}
