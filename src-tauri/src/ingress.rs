use std::fs;
use std::path::{Path, PathBuf};
use serde::{Deserialize, Serialize};

pub use crate::documents::{is_supported_file, SUPPORTED_EXTENSIONS};

const MAX_REQUEST_FILE_BYTES: u64 = 2 * 1024 * 1024; // 2 MB
const MAX_REQUEST_PATHS: usize = 500;
const MAX_PATH_CHAR_LENGTH: usize = 1024;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ExternalAction {
    Add,
    Print,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum DuplicatePolicy {
    Ask,
    Skip,
    Include,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum BusyPolicy {
    Reject,
    Enqueue,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExternalRequestV1 {
    pub version: u32,
    pub request_id: String,
    pub action: ExternalAction,
    pub paths: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub favorite_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub printer_name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub profile_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub duplicate_policy: Option<DuplicatePolicy>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub busy_policy: Option<BusyPolicy>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub activate_window: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub confirm_before_print: Option<bool>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub result_file: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExternalRequestResult {
    pub request_id: String,
    pub status: String, // "accepted" | "completed" | "rejected" | "failed"
    pub action: ExternalAction,
    pub added_count: usize,
    pub skipped_count: usize,
    pub message: String,
    pub timestamp: u64,
}

fn generate_request_id() -> String {
    format!("req_{}", uuid::Uuid::new_v4().simple())
}

/// Recursively expands path arguments into supported document files.
pub fn expand_path_argument(argument: &str, paths: &mut Vec<String>) {
    let trimmed = argument.trim().trim_matches('"');
    if trimmed.is_empty() || trimmed.len() > MAX_PATH_CHAR_LENGTH {
        return;
    }
    let path = PathBuf::from(trimmed);
    if path.is_dir() {
        for entry in walkdir::WalkDir::new(&path)
            .max_depth(8)
            .into_iter()
            .filter_map(|result| result.ok())
        {
            if entry.file_type().is_file() && is_supported_file(entry.path()) {
                paths.push(entry.path().to_string_lossy().to_string());
                if paths.len() >= MAX_REQUEST_PATHS {
                    break;
                }
            }
        }
        return;
    }
    if is_supported_file(&path) {
        paths.push(path.to_string_lossy().to_string());
    }
}

/// Parses a request JSON file from disk into `ExternalRequestV1`.
pub fn parse_request_file(file_path: &Path) -> Result<ExternalRequestV1, String> {
    let metadata = fs::metadata(file_path)
        .map_err(|e| format!("无法读取请求文件元数据: {}", e))?;
    if metadata.len() > MAX_REQUEST_FILE_BYTES {
        return Err(format!("请求文件超过最大限制 ({} MB)", MAX_REQUEST_FILE_BYTES / (1024 * 1024)));
    }
    let content = fs::read_to_string(file_path)
        .map_err(|e| format!("无法读取请求文件内容: {}", e))?;
    let mut req: ExternalRequestV1 = serde_json::from_str(&content)
        .map_err(|e| format!("请求文件 JSON 解析失败: {}", e))?;

    if req.version != 1 {
        return Err(format!("不支持的请求协议版本: {}", req.version));
    }
    if req.request_id.trim().is_empty() {
        req.request_id = generate_request_id();
    }

    // Expand directories and filter supported documents
    let mut expanded_paths = Vec::new();
    for p in &req.paths {
        expand_path_argument(p, &mut expanded_paths);
        if expanded_paths.len() >= MAX_REQUEST_PATHS {
            break;
        }
    }
    // Deduplicate in-place without cloning strings
    deduplicate_in_place(&mut expanded_paths);
    req.paths = expanded_paths;

    Ok(req)
}

fn deduplicate_in_place(paths: &mut Vec<String>) {
    let mut seen = std::collections::HashSet::new();
    let mut keep = Vec::with_capacity(paths.len());
    for p in paths.iter() {
        keep.push(seen.insert(p.as_str()));
    }
    let mut iter = keep.into_iter();
    paths.retain(|_| iter.next().unwrap_or(false));
}

/// Parses command line arguments (from initial launch or subsequent single-instance invocation)
/// into an `ExternalRequestV1` or returns None if no external action/paths were provided.
pub fn parse_external_request(arguments: &[String]) -> Result<Option<ExternalRequestV1>, String> {
    if arguments.is_empty() {
        return Ok(None);
    }

    let args: Vec<&str> = arguments.iter().skip(1).map(|s| s.trim()).collect();
    if args.is_empty() {
        return Ok(None);
    }

    let mut action: Option<ExternalAction> = None;
    let mut request_file: Option<String> = None;
    let mut favorite_id: Option<String> = None;
    let mut printer_name: Option<String> = None;
    let mut profile_id: Option<String> = None;
    let mut duplicate_policy: Option<DuplicatePolicy> = None;
    let mut busy_policy: Option<BusyPolicy> = None;
    let mut activate_window: Option<bool> = None;
    let mut confirm_before_print: Option<bool> = None;
    let mut result_file: Option<String> = None;
    let mut request_id: Option<String> = None;
    let mut raw_paths: Vec<String> = Vec::new();

    let mut i = 0;
    let mut positional_mode = false;

    while i < args.len() {
        let arg = args[i];

        if positional_mode {
            raw_paths.push(arg.to_string());
            i += 1;
            continue;
        }

        if arg == "--" {
            positional_mode = true;
            i += 1;
            continue;
        }

        if arg == "--action" || arg == "-a" {
            i += 1;
            if i >= args.len() {
                return Err("缺少 --action 参数值".to_string());
            }
            match args[i].to_lowercase().as_str() {
                "add" => action = Some(ExternalAction::Add),
                "print" => action = Some(ExternalAction::Print),
                other => return Err(format!("未知的 --action 参数值: '{}' (支持 add | print)", other)),
            }
            i += 1;
            continue;
        }

        if arg == "--request-file" {
            i += 1;
            if i >= args.len() {
                return Err("缺少 --request-file 参数值".to_string());
            }
            request_file = Some(args[i].to_string());
            i += 1;
            continue;
        }

        if arg == "--request-id" {
            i += 1;
            if i >= args.len() {
                return Err("缺少 --request-id 参数值".to_string());
            }
            request_id = Some(args[i].to_string());
            i += 1;
            continue;
        }

        if arg == "--favorite-id" || arg == "--favorite" {
            i += 1;
            if i >= args.len() {
                return Err("缺少 --favorite-id 参数值".to_string());
            }
            favorite_id = Some(args[i].to_string());
            i += 1;
            continue;
        }

        if arg == "--printer" {
            i += 1;
            if i >= args.len() {
                return Err("缺少 --printer 参数值".to_string());
            }
            printer_name = Some(args[i].to_string());
            i += 1;
            continue;
        }

        if arg == "--profile-id" || arg == "--profile" {
            i += 1;
            if i >= args.len() {
                return Err("缺少 --profile-id 参数值".to_string());
            }
            profile_id = Some(args[i].to_string());
            i += 1;
            continue;
        }

        if arg == "--duplicate" {
            i += 1;
            if i >= args.len() {
                return Err("缺少 --duplicate 参数值".to_string());
            }
            match args[i].to_lowercase().as_str() {
                "ask" => duplicate_policy = Some(DuplicatePolicy::Ask),
                "skip" => duplicate_policy = Some(DuplicatePolicy::Skip),
                "include" => duplicate_policy = Some(DuplicatePolicy::Include),
                other => return Err(format!("未知的 --duplicate 参数值: '{}' (支持 ask | skip | include)", other)),
            }
            i += 1;
            continue;
        }

        if arg == "--busy" {
            i += 1;
            if i >= args.len() {
                return Err("缺少 --busy 参数值".to_string());
            }
            match args[i].to_lowercase().as_str() {
                "reject" => busy_policy = Some(BusyPolicy::Reject),
                "enqueue" => busy_policy = Some(BusyPolicy::Enqueue),
                other => return Err(format!("未知的 --busy 参数值: '{}' (支持 reject | enqueue)", other)),
            }
            i += 1;
            continue;
        }

        if arg == "--confirm" {
            confirm_before_print = Some(true);
            i += 1;
            continue;
        }

        if arg == "--no-confirm" {
            confirm_before_print = Some(false);
            i += 1;
            continue;
        }

        if arg == "--activate" {
            activate_window = Some(true);
            i += 1;
            continue;
        }

        if arg == "--no-activate" {
            activate_window = Some(false);
            i += 1;
            continue;
        }

        if arg == "--result-file" {
            i += 1;
            if i >= args.len() {
                return Err("缺少 --result-file 参数值".to_string());
            }
            result_file = Some(args[i].to_string());
            i += 1;
            continue;
        }

        // Positional argument (file or folder path)
        if !arg.starts_with('-') {
            raw_paths.push(arg.to_string());
            i += 1;
            continue;
        }

        return Err(format!("未知的命令行选项: '{}'", arg));
    }

    // If --request-file was specified, load and merge CLI overrides
    if let Some(req_path) = request_file {
        let mut file_req = parse_request_file(Path::new(&req_path))?;
        if let Some(act) = action {
            file_req.action = act;
        }
        if let Some(fav) = favorite_id {
            file_req.favorite_id = Some(fav);
        }
        if let Some(prn) = printer_name {
            file_req.printer_name = Some(prn);
        }
        if let Some(prf) = profile_id {
            file_req.profile_id = Some(prf);
        }
        if let Some(dup) = duplicate_policy {
            file_req.duplicate_policy = Some(dup);
        }
        if let Some(bsy) = busy_policy {
            file_req.busy_policy = Some(bsy);
        }
        if let Some(act_w) = activate_window {
            file_req.activate_window = Some(act_w);
        }
        if let Some(cnf) = confirm_before_print {
            file_req.confirm_before_print = Some(cnf);
        }
        if let Some(rf) = result_file {
            file_req.result_file = Some(rf);
        }
        if let Some(rid) = request_id {
            file_req.request_id = rid;
        }
        if !raw_paths.is_empty() {
            let mut extra_paths = Vec::new();
            for p in &raw_paths {
                expand_path_argument(p, &mut extra_paths);
            }
            file_req.paths.extend(extra_paths);
            deduplicate_in_place(&mut file_req.paths);
        }
        return Ok(Some(file_req));
    }

    // Collect paths from raw_paths
    let mut expanded_paths = Vec::new();
    for p in &raw_paths {
        expand_path_argument(p, &mut expanded_paths);
        if expanded_paths.len() >= MAX_REQUEST_PATHS {
            break;
        }
    }
    deduplicate_in_place(&mut expanded_paths);

    // If no paths and no action specified, return None
    if expanded_paths.is_empty() && action.is_none() && favorite_id.is_none() {
        return Ok(None);
    }

    let resolved_action = action.unwrap_or(ExternalAction::Add);
    let resolved_req_id = request_id.unwrap_or_else(generate_request_id);

    Ok(Some(ExternalRequestV1 {
        version: 1,
        request_id: resolved_req_id,
        action: resolved_action,
        paths: expanded_paths,
        favorite_id,
        printer_name,
        profile_id,
        duplicate_policy,
        busy_policy,
        activate_window,
        confirm_before_print,
        result_file,
    }))
}

// Backward compatibility helper
pub fn collect_launch_paths(arguments: &[String]) -> Vec<String> {
    match parse_external_request(arguments) {
        Ok(Some(req)) => req.paths,
        _ => Vec::new(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_plain_positional_arguments_as_add_action() {
        let args = vec![
            "PrintAssist.exe".to_string(),
            "file1.pdf".to_string(),
            "file2.docx".to_string(),
        ];
        let req = parse_external_request(&args).unwrap().unwrap();
        assert_eq!(req.version, 1);
        assert_eq!(req.action, ExternalAction::Add);
        assert_eq!(req.paths, vec!["file1.pdf", "file2.docx"]);
        assert!(req.request_id.starts_with("req_"));
    }

    #[test]
    fn parses_structured_cli_flags_for_direct_print() {
        let args = vec![
            "PrintAssist.exe".to_string(),
            "--action".to_string(),
            "print".to_string(),
            "--favorite-id".to_string(),
            "fav_report_1".to_string(),
            "--duplicate".to_string(),
            "skip".to_string(),
            "--busy".to_string(),
            "reject".to_string(),
            "--confirm".to_string(),
            "--".to_string(),
            "D:\\docs\\report.pdf".to_string(),
        ];
        let req = parse_external_request(&args).unwrap().unwrap();
        assert_eq!(req.action, ExternalAction::Print);
        assert_eq!(req.favorite_id.as_deref(), Some("fav_report_1"));
        assert_eq!(req.duplicate_policy, Some(DuplicatePolicy::Skip));
        assert_eq!(req.busy_policy, Some(BusyPolicy::Reject));
        assert_eq!(req.confirm_before_print, Some(true));
        assert_eq!(req.paths, vec!["D:\\docs\\report.pdf"]);
    }

    #[test]
    fn rejects_unknown_flag() {
        let args = vec![
            "PrintAssist.exe".to_string(),
            "--invalid-option".to_string(),
            "file.pdf".to_string(),
        ];
        let err = parse_external_request(&args).unwrap_err();
        assert!(err.contains("未知的命令行选项"));
    }

    #[test]
    fn parses_request_file_json() {
        let temp_dir = std::env::temp_dir();
        let json_file = temp_dir.join(format!("test_req_{}.json", uuid::Uuid::new_v4().simple()));
        let json_content = r#"{
            "version": 1,
            "requestId": "custom_req_123",
            "action": "print",
            "paths": ["test1.pdf", "test2.xlsx"],
            "favoriteId": "fav_test",
            "duplicatePolicy": "include"
        }"#;
        fs::write(&json_file, json_content).unwrap();

        let args = vec![
            "PrintAssist.exe".to_string(),
            "--request-file".to_string(),
            json_file.to_string_lossy().to_string(),
        ];
        let req = parse_external_request(&args).unwrap().unwrap();
        assert_eq!(req.request_id, "custom_req_123");
        assert_eq!(req.action, ExternalAction::Print);
        assert_eq!(req.favorite_id.as_deref(), Some("fav_test"));
        assert_eq!(req.duplicate_policy, Some(DuplicatePolicy::Include));
        assert_eq!(req.paths, vec!["test1.pdf", "test2.xlsx"]);

        let _ = fs::remove_file(json_file);
    }

    #[test]
    fn parses_unicode_and_spaced_paths() {
        let args = vec![
            "PrintAssist.exe".to_string(),
            "--action".to_string(),
            "add".to_string(),
            "--".to_string(),
            "C:\\中文 目录\\测试 文档 1.docx".to_string(),
            "D:\\Photos\\打印 照片 (1).png".to_string(),
        ];
        let req = parse_external_request(&args).unwrap().unwrap();
        assert_eq!(req.action, ExternalAction::Add);
        assert_eq!(
            req.paths,
            vec![
                "C:\\中文 目录\\测试 文档 1.docx",
                "D:\\Photos\\打印 照片 (1).png"
            ]
        );
    }

    #[test]
    fn rejects_missing_action_value() {
        let args = vec!["PrintAssist.exe".to_string(), "--action".to_string()];
        let err = parse_external_request(&args).unwrap_err();
        assert!(err.contains("缺少 --action 参数值"));
    }

    #[test]
    fn handles_empty_arguments() {
        let args: Vec<String> = vec!["PrintAssist.exe".to_string()];
        assert_eq!(parse_external_request(&args).unwrap(), None);
    }
}
