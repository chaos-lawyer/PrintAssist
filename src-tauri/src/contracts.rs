use serde::{Deserialize, Serialize};

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
pub struct ResolvedPrintSettingsPayload {
    pub printer_name: String,
    pub color_mode: String,
    pub sides_mode: String,
    pub flip_mode: String,
    pub copies: u32,
    pub page_range_mode: String,
    pub page_range_expression: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub driver_profile_id: Option<String>,
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
pub struct UpdateCheckResult {
    pub available: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub version: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub body: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub download_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub download_size: Option<u64>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProxyConfig {
    pub use_system_proxy: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub custom_proxy_url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub username: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub password: Option<String>,
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
}
