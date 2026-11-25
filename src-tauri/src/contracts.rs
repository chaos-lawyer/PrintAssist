use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileMetadata {
    pub path: String,
    pub file_size: u64,
    pub created_at: Option<i64>,
    pub modified_at: Option<i64>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum CapabilitySupport {
    Supported,
    Unsupported,
    Unknown,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum CapabilitySource {
    Driver,
    System,
    Unavailable,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum PrinterOperationalState {
    Ready,
    Offline,
    Error,
    Unknown,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PrinterCapability {
    pub support: CapabilitySupport,
    pub source: CapabilitySource,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemPrinter {
    pub name: String,
    pub port_name: Option<String>,
    pub is_default: bool,
    pub state: PrinterOperationalState,
    pub status_code: u32,
    pub color: PrinterCapability,
    pub duplex: PrinterCapability,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum PrinterPropertiesStatus {
    Accepted,
    Cancelled,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PrinterDriverSettings {
    pub printer_name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub paper_code: Option<i16>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub paper_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub paper_width_tenth_mm: Option<i16>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub paper_length_tenth_mm: Option<i16>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_code: Option<i16>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub color_mode: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sides_mode: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub flip_mode: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub orientation: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub print_quality: Option<i16>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub collate: Option<bool>,
    pub driver_extra_bytes: usize,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PrinterPropertiesResult {
    pub status: PrinterPropertiesStatus,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub profile_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub settings: Option<PrinterDriverSettings>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PaperSourceOption {
    pub code: i16,
    pub name: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum PaperSourceStatus {
    Available,
    Unsupported,
    Unavailable,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PaperSourceCapability {
    pub status: PaperSourceStatus,
    pub sources: Vec<PaperSourceOption>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub default_source_code: Option<i16>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub detail: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NupLayout {
    pub cols: u32,
    pub rows: u32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CustomPaperDimensions {
    pub width_mm: u32,
    pub height_mm: u32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PaperSizeSpec {
    pub preset: PaperSizePreset,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub custom: Option<CustomPaperDimensions>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum PaperSizePreset {
    SameAsOriginal,
    A4,
    A3,
    Custom,
}

impl PaperSizeSpec {
    pub fn validate(&self, label: &str, allow_same_as_original: bool) -> Result<(), String> {
        if !allow_same_as_original && self.preset == PaperSizePreset::SameAsOriginal {
            return Err(format!("{label}不支持“与原稿相同”选项"));
        }
        if self.preset == PaperSizePreset::Custom {
            let dims = self
                .custom
                .ok_or_else(|| format!("{label}选择自定义时必须指定宽高"))?;
            if dims.width_mm < 50
                || dims.width_mm > 1200
                || dims.height_mm < 50
                || dims.height_mm > 1200
            {
                return Err(format!("{label}自定义宽高必须在 50mm 到 1200mm 之间"));
            }
        }
        Ok(())
    }

    pub fn dimensions_mm(&self) -> (u32, u32) {
        match self.preset {
            PaperSizePreset::A3 => (297, 420),
            PaperSizePreset::Custom => self
                .custom
                .map(|c| (c.width_mm.clamp(50, 1200), c.height_mm.clamp(50, 1200)))
                .unwrap_or((210, 297)),
            PaperSizePreset::A4 | PaperSizePreset::SameAsOriginal => (210, 297),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EffectivePaperSize {
    A4,
    A3,
    Custom { width_mm: u32, height_mm: u32 },
}

impl EffectivePaperSize {
    pub fn resolve(
        original_size: Option<PaperSizeSpec>,
        paper_size: Option<PaperSizeSpec>,
    ) -> Option<Self> {
        let output = paper_size?;
        match output.preset {
            PaperSizePreset::SameAsOriginal => {
                let orig = original_size.unwrap_or(PaperSizeSpec {
                    preset: PaperSizePreset::A4,
                    custom: None,
                });
                Some(Self::from_non_same_spec(orig))
            }
            _ => Some(Self::from_non_same_spec(output)),
        }
    }

    fn from_non_same_spec(spec: PaperSizeSpec) -> Self {
        match spec.preset {
            PaperSizePreset::A3 => Self::A3,
            PaperSizePreset::Custom => {
                let (width_mm, height_mm) = spec.dimensions_mm();
                Self::Custom {
                    width_mm,
                    height_mm,
                }
            }
            PaperSizePreset::A4 | PaperSizePreset::SameAsOriginal => Self::A4,
        }
    }

    pub fn dimensions_mm(&self) -> (u32, u32) {
        match *self {
            Self::A4 => (210, 297),
            Self::A3 => (297, 420),
            Self::Custom {
                width_mm,
                height_mm,
            } => (width_mm, height_mm),
        }
    }
}

/// Computes the proportional scale factor from original paper size to output paper size.
/// Returns 1.0 when both are identical, unspecified, or `paper_size` is `SameAsOriginal`.
pub fn compute_original_to_paper_scale(
    original_size: Option<PaperSizeSpec>,
    paper_size: Option<PaperSizeSpec>,
) -> f64 {
    let Some(output) = paper_size else {
        return 1.0;
    };
    if output.preset == PaperSizePreset::SameAsOriginal {
        return 1.0;
    }
    let orig = original_size.unwrap_or(PaperSizeSpec {
        preset: PaperSizePreset::A4,
        custom: None,
    });
    let (ow, oh) = orig.dimensions_mm();
    let (pw, ph) = output.dimensions_mm();
    let orig_short = ow.min(oh).max(1) as f64;
    let orig_long = ow.max(oh).max(1) as f64;
    let paper_short = pw.min(ph).max(1) as f64;
    let paper_long = pw.max(ph).max(1) as f64;
    if (orig_short - paper_short).abs() < 0.5 && (orig_long - paper_long).abs() < 0.5 {
        return 1.0;
    }
    (paper_short / orig_short).min(paper_long / orig_long)
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolvedPrintSettingsPayload {
    pub printer_name: String,
    pub color_mode: String,
    pub sides_mode: String,
    pub flip_mode: String,
    pub copies: u32,
    pub page_range_mode: String,
    pub page_range_expression: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source_code: Option<i16>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source_name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub original_size: Option<PaperSizeSpec>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub paper_size: Option<PaperSizeSpec>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub scale_mode: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub collate: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub driver_profile_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub nup_layout: Option<NupLayout>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub nup_scope: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cross_file_duplex: Option<bool>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PrintQueueItemPayload {
    pub queue_item_id: String,
    pub path: String,
    pub file_name: String,
    pub settings: ResolvedPrintSettingsPayload,
    pub allow_association_fallback: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PrintBatchRequest {
    pub items: Vec<PrintQueueItemPayload>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub nup_layout: Option<NupLayout>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub nup_scope: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cross_file_duplex: Option<bool>,
}

impl PrintBatchRequest {
    pub fn validate(&self) -> Result<(), String> {
        if self.items.is_empty() {
            return Err("打印队列为空，无法开始打印".to_string());
        }
        if self.items.len() > 1000 {
            return Err("单批次打印文件数量不能超过 1000 个".to_string());
        }

        if let Some(ref layout) = self.nup_layout {
            if layout.cols == 0 || layout.cols > 4 || layout.rows == 0 || layout.rows > 4 {
                return Err("拼版网格行列数必须在 1 到 4 之间".to_string());
            }
            let total_slots = layout
                .cols
                .checked_mul(layout.rows)
                .ok_or_else(|| "拼版网格槽位数溢出".to_string())?;
            if total_slots > 16 {
                return Err("拼版单页总槽位数不能超过 16".to_string());
            }
        }

        let is_cross_file_nup = self.nup_layout.is_some_and(|l| l.cols * l.rows > 1)
            && self.nup_scope.as_deref() == Some("crossFile");
        let is_cross_file_duplex = self.cross_file_duplex.unwrap_or(false)
            && self
                .items
                .first()
                .is_some_and(|it| it.settings.sides_mode == "duplex");
        let is_cross_file = is_cross_file_nup || is_cross_file_duplex;

        let first_printer = &self.items[0].settings.printer_name;

        for item in &self.items {
            if item.settings.copies == 0 || item.settings.copies > 99 {
                return Err(format!(
                    "文件“{}”的打印份数必须在 1 到 99 之间",
                    item.file_name
                ));
            }

            if item.settings.page_range_expression.len() > 500 {
                return Err(format!(
                    "文件“{}”的页码表达式长度不能超过 500 字符",
                    item.file_name
                ));
            }

            if let Some(ref original_size) = item.settings.original_size {
                original_size.validate("原稿尺寸", false)?;
            }
            if let Some(ref paper_size) = item.settings.paper_size {
                paper_size.validate("纸张尺寸", true)?;
            }

            let path = std::path::Path::new(&item.path);
            if !path.exists() {
                return Err(format!("文件不存在：{}", item.path));
            }
            if !path.is_file() {
                return Err(format!("路径不是有效文件：{}", item.path));
            }

            if !crate::documents::is_supported_file(path) {
                return Err(format!("不支持的文件格式：{}", item.file_name));
            }

            if is_cross_file {
                if !item
                    .settings
                    .printer_name
                    .eq_ignore_ascii_case(first_printer)
                {
                    if is_cross_file_nup {
                        return Err("跨文件多页拼接要求队列中所有文件使用同一台打印机".to_string());
                    } else {
                        return Err("跨文件双面打印要求队列中所有文件使用同一台打印机".to_string());
                    }
                }
                let ext = path
                    .extension()
                    .and_then(|e| e.to_str())
                    .unwrap_or("")
                    .to_ascii_lowercase();
                if matches!(ext.as_str(), "txt" | "log" | "md") {
                    if is_cross_file_nup {
                        return Err(format!(
                            "跨文件多页拼接不支持纯文本文件“{}”，请转换为 PDF 或单文件独立打印",
                            item.file_name
                        ));
                    } else {
                        return Err(format!(
                            "跨文件双面打印不支持纯文本文件“{}”，请转换为 PDF 或单文件独立打印",
                            item.file_name
                        ));
                    }
                }
            }
        }

        Ok(())
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PrintItemErrorKind {
    OfficeMissing,
    FileLocked,
    PasswordProtected,
    PrinterUnavailable,
    Unsupported,
    General,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PrintBatchResultItem {
    pub queue_item_id: String,
    pub path: String,
    pub file_name: String,
    pub status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error_kind: Option<PrintItemErrorKind>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PrintBatchResult {
    pub succeeded: u32,
    pub failed: u32,
    pub skipped: u32,
    pub results: Vec<PrintBatchResultItem>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PrinterDriverFingerprint {
    pub fingerprint_version: u32,
    pub printer_name: String,
    pub driver_name: String,
    pub driver_version: u64,
    pub environment: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub port_name: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum PrinterProfileCompatibility {
    Compatible,
    PrinterUnavailable,
    DriverChanged,
    Corrupted,
    UnsupportedSchema,
}

impl std::fmt::Display for PrinterProfileCompatibility {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Compatible => write!(f, "兼容可用"),
            Self::PrinterUnavailable => write!(f, "打印机离线或不存在"),
            Self::DriverChanged => write!(f, "驱动版本已发生变更"),
            Self::Corrupted => write!(f, "配置文件校验损坏"),
            Self::UnsupportedSchema => write!(f, "配置架构版本不兼容"),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SavedPrinterProfileSummary {
    pub id: String,
    pub name: String,
    pub printer_name: String,
    pub settings: PrinterDriverSettings,
    pub summary: String,
    pub is_default: bool,
    pub compatibility: PrinterProfileCompatibility,
    pub created_at: String,
    pub updated_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_used_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub note: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SavePrinterProfileRequest {
    pub name: String,
    pub printer_name: String,
    pub runtime_profile_id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub overwrite_persistent_profile_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub note: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LoadedPrinterProfileResult {
    pub persistent_profile: SavedPrinterProfileSummary,
    pub runtime_profile_id: String,
    pub settings: PrinterDriverSettings,
    pub compatibility: PrinterProfileCompatibility,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportPrinterProfilePayload {
    pub schema_version: u32,
    pub profile: SavedPrinterProfileSummary,
    pub fingerprint: PrinterDriverFingerprint,
    pub devmode_base64: String,
    pub devmode_sha256: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportPrinterProfilesBundlePayload {
    pub schema_version: u32,
    pub printer_name: String,
    pub exported_at: u64,
    pub profiles: Vec<ExportPrinterProfilePayload>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(untagged)]
#[allow(clippy::large_enum_variant)]
pub enum ImportProfileFileContent {
    Bundle(ExportPrinterProfilesBundlePayload),
    List(Vec<ExportPrinterProfilePayload>),
    Single(ExportPrinterProfilePayload),
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn serializes_contract_using_frontend_field_names() {
        let printer = SystemPrinter {
            name: "Office Printer".to_string(),
            port_name: Some("USB001".to_string()),
            is_default: true,
            state: PrinterOperationalState::Ready,
            status_code: 0,
            color: PrinterCapability {
                support: CapabilitySupport::Supported,
                source: CapabilitySource::Driver,
                detail: None,
            },
            duplex: PrinterCapability {
                support: CapabilitySupport::Unknown,
                source: CapabilitySource::Unavailable,
                detail: Some("driver query failed".to_string()),
            },
            error: None,
        };

        let value = serde_json::to_value(printer).expect("contract should serialize");

        assert_eq!(value["portName"], "USB001");
        assert_eq!(value["isDefault"], true);
        assert_eq!(value["color"]["support"], "supported");
        assert_eq!(value["duplex"]["support"], "unknown");
        assert!(value.get("error").is_none());
    }

    #[test]
    fn serializes_printer_properties_result_and_settings() {
        let result = PrinterPropertiesResult {
            status: PrinterPropertiesStatus::Accepted,
            profile_id: Some("profile-123".to_string()),
            settings: Some(PrinterDriverSettings {
                printer_name: "Office Printer".to_string(),
                paper_code: Some(9),
                paper_name: Some("A4".to_string()),
                paper_width_tenth_mm: Some(2100),
                paper_length_tenth_mm: Some(2970),
                source_code: Some(7),
                source_name: Some("Auto".to_string()),
                color_mode: Some("monochrome".to_string()),
                sides_mode: Some("duplex".to_string()),
                flip_mode: Some("longEdge".to_string()),
                orientation: Some("portrait".to_string()),
                print_quality: Some(600),
                collate: Some(true),
                driver_extra_bytes: 512,
            }),
        };

        let value = serde_json::to_value(result).expect("serialize properties result");
        assert_eq!(value["status"], "accepted");
        assert_eq!(value["profileId"], "profile-123");
        assert_eq!(value["settings"]["paperName"], "A4");
        assert_eq!(value["settings"]["driverExtraBytes"], 512);

        let cancelled = PrinterPropertiesResult {
            status: PrinterPropertiesStatus::Cancelled,
            profile_id: None,
            settings: None,
        };
        let cancelled_value = serde_json::to_value(cancelled).expect("serialize cancelled");
        assert_eq!(cancelled_value["status"], "cancelled");
        assert!(cancelled_value.get("profileId").is_none());
        assert!(cancelled_value.get("settings").is_none());
    }

    #[test]
    fn resolves_effective_paper_size_and_scale_ratio() {
        let orig_a4 = Some(PaperSizeSpec {
            preset: PaperSizePreset::A4,
            custom: None,
        });
        let orig_a3 = Some(PaperSizeSpec {
            preset: PaperSizePreset::A3,
            custom: None,
        });
        let paper_same = Some(PaperSizeSpec {
            preset: PaperSizePreset::SameAsOriginal,
            custom: None,
        });
        let paper_a3 = Some(PaperSizeSpec {
            preset: PaperSizePreset::A3,
            custom: None,
        });
        let paper_a4 = Some(PaperSizeSpec {
            preset: PaperSizePreset::A4,
            custom: None,
        });
        let orig_custom = Some(PaperSizeSpec {
            preset: PaperSizePreset::Custom,
            custom: Some(CustomPaperDimensions {
                width_mm: 180,
                height_mm: 260,
            }),
        });

        assert_eq!(
            EffectivePaperSize::resolve(orig_a3, paper_same),
            Some(EffectivePaperSize::A3)
        );
        assert_eq!(
            EffectivePaperSize::resolve(orig_custom, paper_same),
            Some(EffectivePaperSize::Custom {
                width_mm: 180,
                height_mm: 260,
            })
        );
        assert_eq!(
            EffectivePaperSize::resolve(orig_a4, paper_a3),
            Some(EffectivePaperSize::A3)
        );

        assert!((compute_original_to_paper_scale(orig_a3, paper_same) - 1.0).abs() < 1e-6);
        assert!((compute_original_to_paper_scale(orig_a4, paper_a4) - 1.0).abs() < 1e-6);

        let a4_to_a3 = compute_original_to_paper_scale(orig_a4, paper_a3);
        assert!(
            (a4_to_a3 - (297.0 / 210.0)).abs() < 0.01,
            "a4_to_a3={a4_to_a3}"
        );

        let a3_to_a4 = compute_original_to_paper_scale(orig_a3, paper_a4);
        assert!(
            (a3_to_a4 - (210.0 / 297.0)).abs() < 0.01,
            "a3_to_a4={a3_to_a4}"
        );
    }

    #[test]
    fn validates_paper_size_spec_constraints() {
        let same_as_orig = PaperSizeSpec {
            preset: PaperSizePreset::SameAsOriginal,
            custom: None,
        };
        assert!(same_as_orig.validate("原稿尺寸", false).is_err());
        assert!(same_as_orig.validate("纸张尺寸", true).is_ok());

        let invalid_custom = PaperSizeSpec {
            preset: PaperSizePreset::Custom,
            custom: Some(CustomPaperDimensions {
                width_mm: 10,
                height_mm: 297,
            }),
        };
        assert!(invalid_custom.validate("纸张尺寸", true).is_err());

        let valid_custom = PaperSizeSpec {
            preset: PaperSizePreset::Custom,
            custom: Some(CustomPaperDimensions {
                width_mm: 180,
                height_mm: 260,
            }),
        };
        assert!(valid_custom.validate("原稿尺寸", false).is_ok());
    }
}
