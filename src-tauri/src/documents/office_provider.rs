use super::DocumentKind;
use std::path::Path;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum OfficeSuite {
    Microsoft,
    Wps,
}

impl OfficeSuite {
    pub fn display_name(&self) -> &'static str {
        match self {
            Self::Microsoft => "Microsoft Office",
            Self::Wps => "WPS Office",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum OfficeComponent {
    Writer,
    Spreadsheet,
    Presentation,
}

impl OfficeComponent {
    pub fn display_name(&self, suite: OfficeSuite) -> &'static str {
        match (suite, self) {
            (OfficeSuite::Microsoft, Self::Writer) => "Microsoft Word",
            (OfficeSuite::Microsoft, Self::Spreadsheet) => "Microsoft Excel",
            (OfficeSuite::Microsoft, Self::Presentation) => "Microsoft PowerPoint",
            (OfficeSuite::Wps, Self::Writer) => "WPS 文字",
            (OfficeSuite::Wps, Self::Spreadsheet) => "WPS 表格",
            (OfficeSuite::Wps, Self::Presentation) => "WPS 演示",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OfficeProvider {
    pub suite: OfficeSuite,
    pub component: OfficeComponent,
    pub prog_id: &'static str,
}

impl OfficeProvider {
    pub fn new(suite: OfficeSuite, component: OfficeComponent, prog_id: &'static str) -> Self {
        Self {
            suite,
            component,
            prog_id,
        }
    }

    pub fn display_name(&self) -> &'static str {
        self.component.display_name(self.suite)
    }
}

/// Checks whether a COM ProgID is registered in Windows without creating an application instance.
#[cfg(windows)]
pub fn prog_id_available(prog_id: &str) -> bool {
    let wide = windows::core::HSTRING::from(prog_id);
    unsafe { windows::Win32::System::Com::CLSIDFromProgID(&wide).is_ok() }
}

#[cfg(not(windows))]
pub fn prog_id_available(_prog_id: &str) -> bool {
    false
}

/// Resolves candidate Office providers in priority order.
///
/// Rules:
/// - Native WPS formats (.wps, .wpt, .et, .ett, .dps, .dpt) return WPS provider first,
///   followed by Microsoft Office provider as best-effort compatibility when only MS Office is installed.
/// - Microsoft formats return [Microsoft, WPS] in order.
pub fn resolve_provider_candidates(path: &Path, kind: DocumentKind) -> Vec<OfficeProvider> {
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();

    match ext.as_str() {
        "wps" | "wpt" => vec![
            OfficeProvider::new(
                OfficeSuite::Wps,
                OfficeComponent::Writer,
                "kwps.application",
            ),
            OfficeProvider::new(
                OfficeSuite::Microsoft,
                OfficeComponent::Writer,
                "Word.Application",
            ),
        ],
        "et" | "ett" => vec![
            OfficeProvider::new(
                OfficeSuite::Wps,
                OfficeComponent::Spreadsheet,
                "ket.application",
            ),
            OfficeProvider::new(
                OfficeSuite::Microsoft,
                OfficeComponent::Spreadsheet,
                "Excel.Application",
            ),
        ],
        "dps" | "dpt" => vec![
            OfficeProvider::new(
                OfficeSuite::Wps,
                OfficeComponent::Presentation,
                "kwpp.application",
            ),
            OfficeProvider::new(
                OfficeSuite::Microsoft,
                OfficeComponent::Presentation,
                "PowerPoint.Application",
            ),
        ],
        _ => match kind {
            DocumentKind::Word => vec![
                OfficeProvider::new(
                    OfficeSuite::Microsoft,
                    OfficeComponent::Writer,
                    "Word.Application",
                ),
                OfficeProvider::new(
                    OfficeSuite::Wps,
                    OfficeComponent::Writer,
                    "kwps.application",
                ),
            ],
            DocumentKind::Excel => vec![
                OfficeProvider::new(
                    OfficeSuite::Microsoft,
                    OfficeComponent::Spreadsheet,
                    "Excel.Application",
                ),
                OfficeProvider::new(
                    OfficeSuite::Wps,
                    OfficeComponent::Spreadsheet,
                    "ket.application",
                ),
            ],
            DocumentKind::PowerPoint => vec![
                OfficeProvider::new(
                    OfficeSuite::Microsoft,
                    OfficeComponent::Presentation,
                    "PowerPoint.Application",
                ),
                OfficeProvider::new(
                    OfficeSuite::Wps,
                    OfficeComponent::Presentation,
                    "kwpp.application",
                ),
            ],
            _ => Vec::new(),
        },
    }
}

/// Formats actionable user-facing error message when office conversion fails.
pub fn format_office_error(
    path: &Path,
    kind: DocumentKind,
    failures: &[(OfficeProvider, String)],
) -> String {
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();

    if super::is_wps_native_extension(&ext) {
        let (comp_name, ms_comp) = match kind {
            DocumentKind::Word => ("WPS 文字", "Microsoft Word"),
            DocumentKind::Excel => ("WPS 表格", "Microsoft Excel"),
            DocumentKind::PowerPoint => ("WPS 演示", "Microsoft PowerPoint"),
            _ => ("WPS Office", "Microsoft Office"),
        };
        if failures.is_empty() {
            return format!("无法处理 .{ext} 文件：未检测到可用的 {comp_name} 或 {ms_comp}。建议安装 WPS Office，或将文件另存为 Office / PDF 格式后重试。");
        }
        let details = failures
            .iter()
            .map(|(p, err)| format!("{}: {err}", p.display_name()))
            .collect::<Vec<_>>()
            .join("；");
        return format!("无法处理 .{ext} 文件（{details}）：建议安装 {comp_name}，或将文件另存为 Office 或 PDF 格式后重试。");
    }

    let kind_name = match kind {
        DocumentKind::Word => "Word",
        DocumentKind::Excel => "Excel",
        DocumentKind::PowerPoint => "PowerPoint",
        _ => "Office",
    };

    if failures.is_empty() {
        return format!(
            "无法处理此 {kind_name} 文档：未检测到可用的 Microsoft Office 或 WPS Office。"
        );
    }

    let details = failures
        .iter()
        .map(|(p, err)| format!("{}: {err}", p.display_name()))
        .collect::<Vec<_>>()
        .join("；");

    format!("{kind_name} 文档转换失败（{details}）：请确认已安装 Microsoft Office 或 WPS Office，或另存为 PDF 后重试。")
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;

    #[test]
    fn resolves_wps_native_candidates_with_ms_compatibility() {
        let wps_doc = Path::new("test.wps");
        let candidates = resolve_provider_candidates(wps_doc, DocumentKind::Word);
        assert_eq!(candidates.len(), 2);
        assert_eq!(candidates[0].suite, OfficeSuite::Wps);
        assert_eq!(candidates[0].prog_id, "kwps.application");
        assert_eq!(candidates[1].suite, OfficeSuite::Microsoft);
        assert_eq!(candidates[1].prog_id, "Word.Application");

        let et_sheet = Path::new("data.et");
        let candidates = resolve_provider_candidates(et_sheet, DocumentKind::Excel);
        assert_eq!(candidates.len(), 2);
        assert_eq!(candidates[0].suite, OfficeSuite::Wps);
        assert_eq!(candidates[0].prog_id, "ket.application");
        assert_eq!(candidates[1].suite, OfficeSuite::Microsoft);
        assert_eq!(candidates[1].prog_id, "Excel.Application");

        let dps_pres = Path::new("slides.dps");
        let candidates = resolve_provider_candidates(dps_pres, DocumentKind::PowerPoint);
        assert_eq!(candidates.len(), 2);
        assert_eq!(candidates[0].suite, OfficeSuite::Wps);
        assert_eq!(candidates[0].prog_id, "kwpp.application");
        assert_eq!(candidates[1].suite, OfficeSuite::Microsoft);
        assert_eq!(candidates[1].prog_id, "PowerPoint.Application");
    }

    #[test]
    fn resolves_microsoft_candidates_with_fallback() {
        let docx = Path::new("doc.docx");
        let candidates = resolve_provider_candidates(docx, DocumentKind::Word);
        assert_eq!(candidates.len(), 2);
        assert_eq!(candidates[0].suite, OfficeSuite::Microsoft);
        assert_eq!(candidates[0].prog_id, "Word.Application");
        assert_eq!(candidates[1].suite, OfficeSuite::Wps);
        assert_eq!(candidates[1].prog_id, "kwps.application");

        let xlsx = Path::new("sheet.xlsx");
        let candidates = resolve_provider_candidates(xlsx, DocumentKind::Excel);
        assert_eq!(candidates.len(), 2);
        assert_eq!(candidates[0].suite, OfficeSuite::Microsoft);
        assert_eq!(candidates[0].prog_id, "Excel.Application");
        assert_eq!(candidates[1].suite, OfficeSuite::Wps);
        assert_eq!(candidates[1].prog_id, "ket.application");

        let pptx = Path::new("pres.pptx");
        let candidates = resolve_provider_candidates(pptx, DocumentKind::PowerPoint);
        assert_eq!(candidates.len(), 2);
        assert_eq!(candidates[0].suite, OfficeSuite::Microsoft);
        assert_eq!(candidates[0].prog_id, "PowerPoint.Application");
        assert_eq!(candidates[1].suite, OfficeSuite::Wps);
        assert_eq!(candidates[1].prog_id, "kwpp.application");
    }

    #[test]
    fn formats_actionable_error_messages() {
        let wps_file = Path::new("demo.wps");
        let wps_provider = OfficeProvider::new(
            OfficeSuite::Wps,
            OfficeComponent::Writer,
            "kwps.application",
        );
        let ms_provider = OfficeProvider::new(
            OfficeSuite::Microsoft,
            OfficeComponent::Writer,
            "Word.Application",
        );
        let err = format_office_error(
            wps_file,
            DocumentKind::Word,
            &[
                (wps_provider, "未安装".to_string()),
                (ms_provider, "无法识别该文件格式".to_string()),
            ],
        );
        assert!(err.contains("无法处理 .wps 文件"));
        assert!(err.contains("建议安装 WPS 文字，或将文件另存为 Office 或 PDF 格式后重试"));

        let docx_file = Path::new("demo.docx");
        let ms_provider = OfficeProvider::new(
            OfficeSuite::Microsoft,
            OfficeComponent::Writer,
            "Word.Application",
        );
        let wps_provider = OfficeProvider::new(
            OfficeSuite::Wps,
            OfficeComponent::Writer,
            "kwps.application",
        );
        let err = format_office_error(
            docx_file,
            DocumentKind::Word,
            &[
                (ms_provider, "未安装 Word".to_string()),
                (wps_provider, "未安装 WPS".to_string()),
            ],
        );
        assert!(err.contains("Word 文档转换失败"));
        assert!(err.contains("Microsoft Word"));
        assert!(err.contains("WPS 文字"));
    }
}
