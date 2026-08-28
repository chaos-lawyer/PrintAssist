use std::collections::{HashMap, HashSet};
use std::fs::{self, File};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::{Arc, RwLock};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use uuid::Uuid;

use crate::contracts::{
    ExportPrinterProfilePayload, PrinterDriverFingerprint, PrinterDriverSettings,
    PrinterProfileCompatibility, SavedPrinterProfileSummary,
};

pub const SCHEMA_VERSION: u32 = 1;
pub const MAX_DEVMODE_BYTES: usize = 1024 * 1024; // 1 MiB

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PrinterProfileIndex {
    pub schema_version: u32,
    pub profiles: Vec<PersistedPrinterProfile>,
    pub defaults: HashMap<String, String>, // lowercase(printer_name) -> persistent_profile_id
}

impl Default for PrinterProfileIndex {
    fn default() -> Self {
        Self {
            schema_version: SCHEMA_VERSION,
            profiles: Vec::new(),
            defaults: HashMap::new(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PersistedPrinterProfile {
    pub id: String,
    pub name: String,
    pub printer: PrinterDriverFingerprint,
    pub settings_snapshot: PrinterDriverSettings,
    pub devmode_file: String,
    pub devmode_sha256: String,
    pub devmode_bytes: usize,
    pub created_at: String,
    pub updated_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_used_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub note: Option<String>,
}

impl PersistedPrinterProfile {
    pub fn to_summary(
        &self,
        is_default: bool,
        compatibility: PrinterProfileCompatibility,
    ) -> SavedPrinterProfileSummary {
        let summary = format_settings_summary(&self.settings_snapshot);
        SavedPrinterProfileSummary {
            id: self.id.clone(),
            name: self.name.clone(),
            printer_name: self.printer.printer_name.clone(),
            settings: self.settings_snapshot.clone(),
            summary,
            is_default,
            compatibility,
            created_at: self.created_at.clone(),
            updated_at: self.updated_at.clone(),
            last_used_at: self.last_used_at.clone(),
            note: self.note.clone(),
        }
    }
}

fn format_settings_summary(settings: &PrinterDriverSettings) -> String {
    let mut parts = Vec::new();
    if let Some(ref paper) = settings.paper_name {
        parts.push(paper.clone());
    } else if let Some(code) = settings.paper_code {
        parts.push(format!("纸张 #{code}"));
    }

    if let Some(ref tray) = settings.source_name {
        parts.push(tray.clone());
    } else if let Some(code) = settings.source_code {
        parts.push(format!("纸盘 #{code}"));
    }

    if let Some(ref sides) = settings.sides_mode {
        if sides == "duplex" {
            if let Some(ref flip) = settings.flip_mode {
                if flip == "shortEdge" {
                    parts.push("双面（短边）".to_string());
                } else {
                    parts.push("双面（长边）".to_string());
                }
            } else {
                parts.push("双面（长边）".to_string());
            }
        } else if sides == "simplex" {
            parts.push("单面".to_string());
        }
    }

    if let Some(ref color) = settings.color_mode {
        if color == "color" {
            parts.push("彩色".to_string());
        } else if color == "monochrome" {
            parts.push("黑白".to_string());
        }
    }

    if parts.is_empty() {
        "驱动自定义配置".to_string()
    } else {
        parts.join(" · ")
    }
}

#[derive(Clone)]
pub struct PersistentPrinterProfileStore {
    base_dir: PathBuf,
    data_dir: PathBuf,
    index: Arc<RwLock<PrinterProfileIndex>>,
}

impl PersistentPrinterProfileStore {
    /// Detects if portable mode is active via CLI flag, environment variable, or portable marker file.
    pub fn is_portable_mode(exe_dir: Option<&Path>) -> bool {
        // 1. Explicit CLI arguments
        if std::env::args().any(|arg| arg == "--portable" || arg == "-p") {
            return true;
        }
        // 2. Explicit Environment Variable
        if std::env::var("PRINTASSIST_PORTABLE")
            .map(|v| v == "1" || v.eq_ignore_ascii_case("true"))
            .unwrap_or(false)
        {
            return true;
        }
        // 3. Explicit marker file in executable directory
        if let Some(dir) = exe_dir {
            if dir.join("portable.flag").exists()
                || dir.join("portable").is_file()
                || dir.join(".portable").exists()
            {
                return true;
            }
            // 4. Existing portable data folder from a previous portable run
            if dir.join("printer-profiles").join("index.json").is_file() {
                return true;
            }
        }
        false
    }

    pub fn normalize_storage_dir(dir: &Path) -> PathBuf {
        if dir.ends_with("printer-profiles") {
            dir.to_path_buf()
        } else {
            dir.join("printer-profiles")
        }
    }

    /// Resolves the storage directory.
    /// In Portable mode: uses `<exe_dir>/printer-profiles` if writable.
    /// In Standard Installation mode: always uses `%APPDATA%/com.ws1993.printassist/printer-profiles`.
    pub fn resolve_storage_dir(app_data_fallback: &Path) -> PathBuf {
        let exe_dir = std::env::current_exe()
            .ok()
            .and_then(|p| p.parent().map(|d| d.to_path_buf()));

        if Self::is_portable_mode(exe_dir.as_deref()) {
            if let Some(ref dir) = exe_dir {
                let exe_profile_dir = dir.join("printer-profiles");
                if fs::create_dir_all(&exe_profile_dir).is_ok() {
                    let test_file = exe_profile_dir.join(".write_test");
                    if fs::write(&test_file, b"ok").is_ok() {
                        let _ = fs::remove_file(test_file);
                        // Transactional migrate if needed
                        let _ = Self::transactional_migrate(&exe_profile_dir, app_data_fallback);
                        return exe_profile_dir;
                    }
                }
            }
        }

        // Standard installer mode: always use user AppData
        let fallback_dir = Self::normalize_storage_dir(app_data_fallback);
        let _ = fs::create_dir_all(&fallback_dir);
        fallback_dir
    }

    /// Transactionally migrates profiles from source AppData to target directory.
    /// If any file is missing or copy fails, cleans up the temporary directory without corrupting target.
    pub fn transactional_migrate(target_dir: &Path, app_data_dir: &Path) -> Result<(), String> {
        let target_dir = Self::normalize_storage_dir(target_dir);
        let target_index = target_dir.join("index.json");
        if target_index.is_file() {
            return Ok(()); // Already populated
        }

        let source_dir = Self::normalize_storage_dir(app_data_dir);
        let source_index = source_dir.join("index.json");
        if !source_index.is_file() {
            return Ok(()); // Nothing to migrate
        }

        // 1. Read and validate source index
        let content =
            fs::read_to_string(&source_index).map_err(|e| format!("读取源索引失败: {e}"))?;
        let index: PrinterProfileIndex =
            serde_json::from_str(&content).map_err(|e| format!("解析源索引失败: {e}"))?;

        let source_data = source_dir.join("data");

        // 2. Prepare temporary directory next to target_dir
        let tmp_dir = target_dir.with_extension(format!("tmp_migration_{}", Uuid::new_v4()));
        let tmp_data = tmp_dir.join("data");
        if let Err(e) = fs::create_dir_all(&tmp_data) {
            let _ = fs::remove_dir_all(&tmp_dir);
            return Err(format!("创建临时迁移目录失败: {e}"));
        }

        // 3. Copy each data file and verify existence
        for profile in &index.profiles {
            let src_file = source_data.join(&profile.devmode_file);
            if !src_file.is_file() {
                let _ = fs::remove_dir_all(&tmp_dir);
                return Err(format!("源配置数据文件缺失: {}", profile.devmode_file));
            }
            let dest_file = tmp_data.join(&profile.devmode_file);
            if let Err(e) = fs::copy(&src_file, &dest_file) {
                let _ = fs::remove_dir_all(&tmp_dir);
                return Err(format!("复制配置数据文件失败: {e}"));
            }
        }

        // 4. Copy index.json and index.json.bak
        let tmp_index = tmp_dir.join("index.json");
        if let Err(e) = fs::write(&tmp_index, &content) {
            let _ = fs::remove_dir_all(&tmp_dir);
            return Err(format!("写入临时索引失败: {e}"));
        }
        let source_bak = source_dir.join("index.json.bak");
        if source_bak.is_file() {
            let _ = fs::copy(&source_bak, tmp_dir.join("index.json.bak"));
        }

        // 5. Atomic commit: move verified files into target_dir
        let _ = fs::create_dir_all(&target_dir);
        let target_data = target_dir.join("data");
        let _ = fs::create_dir_all(&target_data);

        for profile in &index.profiles {
            let tmp_file = tmp_data.join(&profile.devmode_file);
            let final_file = target_data.join(&profile.devmode_file);
            if let Err(e) = fs::copy(&tmp_file, &final_file) {
                let _ = fs::remove_dir_all(&tmp_dir);
                return Err(format!("提交配置数据失败: {e}"));
            }
        }

        if let Err(e) = fs::copy(&tmp_index, &target_index) {
            let _ = fs::remove_dir_all(&tmp_dir);
            return Err(format!("提交索引文件失败: {e}"));
        }

        let _ = fs::remove_dir_all(&tmp_dir);
        Ok(())
    }

    pub fn new(storage_dir: &Path) -> Self {
        let base_dir = Self::normalize_storage_dir(storage_dir);
        let data_dir = base_dir.join("data");

        let _ = fs::create_dir_all(&data_dir);

        let index = Self::load_index(&base_dir);

        Self {
            base_dir,
            data_dir,
            index: Arc::new(RwLock::new(index)),
        }
    }

    fn load_index(base_dir: &Path) -> PrinterProfileIndex {
        let index_file = base_dir.join("index.json");
        let backup_file = base_dir.join("index.json.bak");

        if index_file.exists() {
            if let Ok(content) = fs::read_to_string(&index_file) {
                if let Ok(parsed) = serde_json::from_str::<PrinterProfileIndex>(&content) {
                    return parsed;
                }
            }
        }

        // Fallback to backup if index.json is corrupted
        if backup_file.exists() {
            if let Ok(content) = fs::read_to_string(&backup_file) {
                if let Ok(parsed) = serde_json::from_str::<PrinterProfileIndex>(&content) {
                    return parsed;
                }
            }
        }

        PrinterProfileIndex::default()
    }

    fn save_index_internal(&self, index: &PrinterProfileIndex) -> Result<(), String> {
        let index_file = self.base_dir.join("index.json");
        let temp_file = self.base_dir.join("index.json.tmp");
        let backup_file = self.base_dir.join("index.json.bak");

        let json_str = serde_json::to_string_pretty(index)
            .map_err(|err| format!("序列化配置索引失败：{err}"))?;

        let mut file =
            File::create(&temp_file).map_err(|err| format!("创建临时索引文件失败：{err}"))?;
        file.write_all(json_str.as_bytes())
            .map_err(|err| format!("写入临时索引文件失败：{err}"))?;
        file.flush()
            .map_err(|err| format!("刷新索引文件失败：{err}"))?;
        drop(file);

        if index_file.exists() {
            let _ = fs::copy(&index_file, &backup_file);
        }

        fs::rename(&temp_file, &index_file).map_err(|err| format!("更新主索引文件失败：{err}"))?;

        Ok(())
    }

    pub fn validate_profile_name(
        &self,
        name: &str,
        printer_name: &str,
        current_profile_id: Option<&str>,
    ) -> Result<String, String> {
        let trimmed = name.trim();
        if trimmed.is_empty() {
            return Err("配置名称不能为空".to_string());
        }
        if trimmed.chars().count() > 60 {
            return Err("配置名称不能超过 60 个字符".to_string());
        }
        if trimmed == "系统默认" || trimmed == "未保存的当前配置" {
            return Err(format!("“{trimmed}”为系统保留名称，不可使用"));
        }

        let lock = self
            .index
            .read()
            .map_err(|_| "读取配置索引失败".to_string())?;
        for profile in &lock.profiles {
            if profile
                .printer
                .printer_name
                .eq_ignore_ascii_case(printer_name)
                && profile.name.eq_ignore_ascii_case(trimmed)
            {
                if let Some(id) = current_profile_id {
                    if profile.id == id {
                        continue;
                    }
                }
                return Err(format!("当前打印机已存在名为“{trimmed}”的配置"));
            }
        }

        Ok(trimmed.to_string())
    }

    pub fn list_profiles(&self, printer_name: Option<&str>) -> Vec<PersistedPrinterProfile> {
        let Ok(lock) = self.index.read() else {
            return Vec::new();
        };

        match printer_name {
            Some(name) if !name.trim().is_empty() => lock
                .profiles
                .iter()
                .filter(|p| p.printer.printer_name.eq_ignore_ascii_case(name))
                .cloned()
                .collect(),
            _ => lock.profiles.clone(),
        }
    }

    pub fn get_profile(&self, profile_id: &str) -> Option<PersistedPrinterProfile> {
        let Ok(lock) = self.index.read() else {
            return None;
        };
        lock.profiles.iter().find(|p| p.id == profile_id).cloned()
    }

    pub fn get_default_profile_id(&self, printer_name: &str) -> Option<String> {
        let Ok(lock) = self.index.read() else {
            return None;
        };
        let key = printer_name.trim().to_lowercase();
        lock.defaults.get(&key).cloned()
    }

    pub fn reorder_profiles(
        &self,
        printer_name: &str,
        ordered_profile_ids: &[String],
    ) -> Result<(), String> {
        let printer_name = printer_name.trim();
        if printer_name.is_empty() {
            return Err("打印机名称不能为空".to_string());
        }

        let mut lock = self
            .index
            .write()
            .map_err(|_| "获取配置索引写锁失败".to_string())?;

        let matching_indices: Vec<usize> = lock
            .profiles
            .iter()
            .enumerate()
            .filter_map(|(index, profile)| {
                profile
                    .printer
                    .printer_name
                    .eq_ignore_ascii_case(printer_name)
                    .then_some(index)
            })
            .collect();

        if matching_indices.len() != ordered_profile_ids.len() {
            return Err("排序列表与当前打印机的配置数量不一致，请刷新后重试".to_string());
        }

        let expected_ids: HashSet<&str> = matching_indices
            .iter()
            .map(|index| lock.profiles[*index].id.as_str())
            .collect();
        let supplied_ids: HashSet<&str> = ordered_profile_ids.iter().map(String::as_str).collect();
        if supplied_ids.len() != ordered_profile_ids.len() || supplied_ids != expected_ids {
            return Err("排序列表包含重复、缺失或不属于当前打印机的配置".to_string());
        }

        let profiles_by_id: HashMap<String, PersistedPrinterProfile> = matching_indices
            .iter()
            .map(|index| {
                let profile = lock.profiles[*index].clone();
                (profile.id.clone(), profile)
            })
            .collect();

        for (index, profile_id) in matching_indices.iter().zip(ordered_profile_ids) {
            lock.profiles[*index] = profiles_by_id
                .get(profile_id)
                .cloned()
                .ok_or_else(|| format!("未找到 ID 为 {profile_id} 的配置"))?;
        }

        self.save_index_internal(&lock)
    }

    pub fn load_devmode_bytes(&self, profile_id: &str) -> Result<Vec<u8>, String> {
        let profile = self
            .get_profile(profile_id)
            .ok_or_else(|| format!("未找到 ID 为 {profile_id} 的配置"))?;

        let devmode_path = self.data_dir.join(&profile.devmode_file);
        if !devmode_path.is_file() {
            return Err(format!("配置文件不存在：{}", devmode_path.display()));
        }

        let metadata =
            fs::metadata(&devmode_path).map_err(|err| format!("读取配置文件属性失败：{err}"))?;
        if metadata.len() as usize > MAX_DEVMODE_BYTES {
            return Err("配置文件大小超过 1MB 限制".to_string());
        }

        let mut file =
            File::open(&devmode_path).map_err(|err| format!("打开配置文件失败：{err}"))?;
        let mut buffer = Vec::new();
        file.read_to_end(&mut buffer)
            .map_err(|err| format!("读取配置文件内容失败：{err}"))?;

        let mut hasher = Sha256::new();
        hasher.update(&buffer);
        let calculated_hash = format!("{:x}", hasher.finalize());

        if calculated_hash != profile.devmode_sha256 {
            return Err("配置文件完整性校验失败（SHA-256 不匹配）".to_string());
        }

        Ok(buffer)
    }

    pub fn save_profile(
        &self,
        name: &str,
        printer_name: &str,
        devmode_bytes: &[u8],
        settings_snapshot: PrinterDriverSettings,
        fingerprint: PrinterDriverFingerprint,
        overwrite_id: Option<&str>,
        note: Option<String>,
    ) -> Result<PersistedPrinterProfile, String> {
        if devmode_bytes.len() > MAX_DEVMODE_BYTES {
            return Err("DEVMODE 缓冲区大小超过 1MB 限制".to_string());
        }

        let validated_name = self.validate_profile_name(name, printer_name, overwrite_id)?;

        let mut hasher = Sha256::new();
        hasher.update(devmode_bytes);
        let devmode_sha256 = format!("{:x}", hasher.finalize());

        let now = now_iso();
        let id = overwrite_id
            .map(|s| s.to_string())
            .unwrap_or_else(|| Uuid::new_v4().to_string());
        let devmode_file = format!("{id}.devmode");

        // 1. Atomic write devmode binary
        let devmode_tmp = self.data_dir.join(format!("{devmode_file}.tmp"));
        let devmode_target = self.data_dir.join(&devmode_file);

        let mut file = File::create(&devmode_tmp)
            .map_err(|err| format!("创建临时 DEVMODE 文件失败：{err}"))?;
        file.write_all(devmode_bytes)
            .map_err(|err| format!("写入 DEVMODE 数据失败：{err}"))?;
        file.flush()
            .map_err(|err| format!("刷新 DEVMODE 文件失败：{err}"))?;
        drop(file);

        fs::rename(&devmode_tmp, &devmode_target)
            .map_err(|err| format!("更新正式 DEVMODE 文件失败：{err}"))?;

        // 2. Update index
        let mut lock = self
            .index
            .write()
            .map_err(|_| "获取配置索引写锁失败".to_string())?;

        let created_at = if let Some(existing) = lock.profiles.iter().find(|p| p.id == id) {
            existing.created_at.clone()
        } else {
            now.clone()
        };

        let new_profile = PersistedPrinterProfile {
            id: id.clone(),
            name: validated_name,
            printer: fingerprint,
            settings_snapshot,
            devmode_file,
            devmode_sha256,
            devmode_bytes: devmode_bytes.len(),
            created_at,
            updated_at: now,
            last_used_at: Some(now_iso()),
            note,
        };

        if let Some(idx) = lock.profiles.iter().position(|p| p.id == id) {
            lock.profiles[idx] = new_profile.clone();
        } else {
            lock.profiles.push(new_profile.clone());
        }

        self.save_index_internal(&lock)?;

        Ok(new_profile)
    }

    pub fn rename_profile(
        &self,
        profile_id: &str,
        new_name: &str,
    ) -> Result<PersistedPrinterProfile, String> {
        let current = self
            .get_profile(profile_id)
            .ok_or_else(|| format!("未找到 ID 为 {profile_id} 的配置"))?;

        let validated_name =
            self.validate_profile_name(new_name, &current.printer.printer_name, Some(profile_id))?;

        let mut lock = self
            .index
            .write()
            .map_err(|_| "获取配置索引写锁失败".to_string())?;

        let idx = lock
            .profiles
            .iter()
            .position(|p| p.id == profile_id)
            .ok_or_else(|| "配置已不存在".to_string())?;

        lock.profiles[idx].name = validated_name;
        lock.profiles[idx].updated_at = now_iso();
        let updated = lock.profiles[idx].clone();

        self.save_index_internal(&lock)?;
        Ok(updated)
    }

    pub fn duplicate_profile(
        &self,
        profile_id: &str,
        new_name: &str,
    ) -> Result<PersistedPrinterProfile, String> {
        let current = self
            .get_profile(profile_id)
            .ok_or_else(|| format!("未找到 ID 为 {profile_id} 的配置"))?;

        let validated_name =
            self.validate_profile_name(new_name, &current.printer.printer_name, None)?;

        let devmode_bytes = self.load_devmode_bytes(profile_id)?;

        let printer_name = current.printer.printer_name.clone();
        self.save_profile(
            &validated_name,
            &printer_name,
            &devmode_bytes,
            current.settings_snapshot,
            current.printer,
            None,
            current.note,
        )
    }

    pub fn delete_profile(&self, profile_id: &str) -> Result<(), String> {
        let mut lock = self
            .index
            .write()
            .map_err(|_| "获取配置索引写锁失败".to_string())?;

        let idx = lock
            .profiles
            .iter()
            .position(|p| p.id == profile_id)
            .ok_or_else(|| format!("未找到 ID 为 {profile_id} 的配置"))?;

        let deleted = lock.profiles.remove(idx);

        // Remove from defaults if it was default
        lock.defaults.retain(|_, id| id != profile_id);

        self.save_index_internal(&lock)?;

        // Remove binary file
        let file_path = self.data_dir.join(&deleted.devmode_file);
        let _ = fs::remove_file(file_path);

        Ok(())
    }

    pub fn set_default_profile(
        &self,
        printer_name: &str,
        profile_id: Option<&str>,
    ) -> Result<(), String> {
        let mut lock = self
            .index
            .write()
            .map_err(|_| "获取配置索引写锁失败".to_string())?;

        let key = printer_name.trim().to_lowercase();
        if let Some(id) = profile_id {
            if !lock.profiles.iter().any(|p| p.id == id) {
                return Err(format!("未找到 ID 为 {id} 的配置"));
            }
            lock.defaults.insert(key, id.to_string());
        } else {
            lock.defaults.remove(&key);
        }

        self.save_index_internal(&lock)?;
        Ok(())
    }

    pub fn touch_last_used(&self, profile_id: &str) {
        if let Ok(mut lock) = self.index.write() {
            if let Some(profile) = lock.profiles.iter_mut().find(|p| p.id == profile_id) {
                profile.last_used_at = Some(now_iso());
                let _ = self.save_index_internal(&lock);
            }
        }
    }

    pub fn export_profile(&self, profile_id: &str) -> Result<ExportPrinterProfilePayload, String> {
        let profile = self
            .get_profile(profile_id)
            .ok_or_else(|| format!("未找到 ID 为 {profile_id} 的配置"))?;

        let devmode_bytes = self.load_devmode_bytes(profile_id)?;
        let base64 = base64_encode(&devmode_bytes);

        let default_id = self.get_default_profile_id(&profile.printer.printer_name);
        let is_default = default_id.as_deref() == Some(profile_id);
        let summary = profile.to_summary(is_default, PrinterProfileCompatibility::Compatible);

        Ok(ExportPrinterProfilePayload {
            schema_version: SCHEMA_VERSION,
            profile: summary,
            fingerprint: profile.printer,
            devmode_base64: base64,
            devmode_sha256: profile.devmode_sha256,
        })
    }

    pub fn import_profile(
        &self,
        payload: ExportPrinterProfilePayload,
        target_printer_name: Option<&str>,
    ) -> Result<PersistedPrinterProfile, String> {
        let printer = target_printer_name
            .filter(|s| !s.trim().is_empty())
            .map(|s| s.to_string())
            .unwrap_or_else(|| payload.fingerprint.printer_name.clone());

        let devmode_bytes = base64_decode(&payload.devmode_base64)?;
        let mut hasher = Sha256::new();
        hasher.update(&devmode_bytes);
        let calculated_hash = format!("{:x}", hasher.finalize());

        if calculated_hash != payload.devmode_sha256 {
            return Err("导入数据完整性校验失败（SHA-256 不匹配）".to_string());
        }

        // Generate unique name if existing name collides
        let mut name = payload.profile.name.clone();
        let mut counter = 2_u32;
        while self.validate_profile_name(&name, &printer, None).is_err() {
            name = format!("{}-{counter}", payload.profile.name);
            counter += 1;
        }

        let mut fingerprint = payload.fingerprint;
        fingerprint.printer_name = printer.clone();

        self.save_profile(
            &name,
            &printer,
            &devmode_bytes,
            payload.profile.settings,
            fingerprint,
            None,
            payload.profile.note,
        )
    }
}

fn now_iso() -> String {
    let millis = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    format!("{millis}")
}

fn base64_encode(bytes: &[u8]) -> String {
    const CHARS: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut result = String::new();
    for chunk in bytes.chunks(3) {
        let b0 = chunk[0] as usize;
        let b1 = chunk.get(1).copied().unwrap_or(0) as usize;
        let b2 = chunk.get(2).copied().unwrap_or(0) as usize;

        let n = (b0 << 16) | (b1 << 8) | b2;
        result.push(CHARS[(n >> 18) & 63] as char);
        result.push(CHARS[(n >> 12) & 63] as char);
        if chunk.len() > 1 {
            result.push(CHARS[(n >> 6) & 63] as char);
        } else {
            result.push('=');
        }
        if chunk.len() > 2 {
            result.push(CHARS[n & 63] as char);
        } else {
            result.push('=');
        }
    }
    result
}

fn base64_decode(input: &str) -> Result<Vec<u8>, String> {
    let clean = input.trim();
    let mut buffer = Vec::new();
    let mut values = [0_u8; 4];
    let mut count = 0;

    for &byte in clean.as_bytes() {
        if byte == b'\r' || byte == b'\n' || byte == b' ' {
            continue;
        }
        let val = match byte {
            b'A'..=b'Z' => byte - b'A',
            b'a'..=b'z' => byte - b'a' + 26,
            b'0'..=b'9' => byte - b'0' + 52,
            b'+' => 62,
            b'/' => 63,
            b'=' => 64, // padding
            _ => return Err("无效的 Base64 字符".to_string()),
        };
        values[count] = val;
        count += 1;
        if count == 4 {
            let (v0, v1, v2, v3) = (values[0], values[1], values[2], values[3]);
            if v0 >= 64 || v1 >= 64 {
                return Err("Base64 填充格式错误".to_string());
            }
            buffer.push((v0 << 2) | (v1 >> 4));
            if v2 < 64 {
                buffer.push((v1 << 4) | (v2 >> 2));
                if v3 < 64 {
                    buffer.push((v2 << 6) | v3);
                }
            }
            count = 0;
        }
    }
    Ok(buffer)
}

#[cfg(test)]
mod tests {
    use super::*;

    struct TempDirGuard(PathBuf);
    impl Drop for TempDirGuard {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    fn make_test_store() -> (PersistentPrinterProfileStore, TempDirGuard) {
        let temp_path = std::env::temp_dir().join(format!("printassist-test-{}", Uuid::new_v4()));
        let _ = fs::create_dir_all(&temp_path);
        let store = PersistentPrinterProfileStore::new(&temp_path);
        (store, TempDirGuard(temp_path))
    }

    fn sample_fingerprint(printer: &str) -> PrinterDriverFingerprint {
        PrinterDriverFingerprint {
            fingerprint_version: 1,
            printer_name: printer.to_string(),
            driver_name: format!("{printer} Driver"),
            driver_version: 4,
            environment: "Windows x64".to_string(),
            port_name: Some("USB001".to_string()),
        }
    }

    fn sample_settings(printer: &str) -> PrinterDriverSettings {
        PrinterDriverSettings {
            printer_name: printer.to_string(),
            paper_code: Some(9),
            paper_name: Some("A4".to_string()),
            paper_width_tenth_mm: Some(2100),
            paper_length_tenth_mm: Some(2970),
            source_code: Some(15),
            source_name: Some("自动纸盒".to_string()),
            color_mode: Some("monochrome".to_string()),
            sides_mode: Some("duplex".to_string()),
            flip_mode: Some("longEdge".to_string()),
            orientation: Some("portrait".to_string()),
            print_quality: Some(600),
            driver_extra_bytes: 512,
        }
    }

    #[test]
    fn saves_and_loads_profile() {
        let (store, _dir) = make_test_store();
        let dummy_devmode = vec![1, 2, 3, 4, 5, 6, 7, 8];

        let saved = store
            .save_profile(
                "日常双面",
                "HP LaserJet",
                &dummy_devmode,
                sample_settings("HP LaserJet"),
                sample_fingerprint("HP LaserJet"),
                None,
                None,
            )
            .expect("save profile");

        assert_eq!(saved.name, "日常双面");
        assert!(!saved.id.is_empty());

        let retrieved_bytes = store
            .load_devmode_bytes(&saved.id)
            .expect("load devmode bytes");
        assert_eq!(retrieved_bytes, dummy_devmode);
    }

    #[test]
    fn validates_and_rejects_duplicate_names_for_same_printer() {
        let (store, _dir) = make_test_store();
        let dummy_devmode = vec![10, 20, 30];

        store
            .save_profile(
                "A4 单面",
                "Canon TS8300",
                &dummy_devmode,
                sample_settings("Canon TS8300"),
                sample_fingerprint("Canon TS8300"),
                None,
                None,
            )
            .expect("save profile 1");

        // Duplicate name on same printer must fail
        let duplicate_res = store.save_profile(
            "a4 单面",
            "Canon TS8300",
            &dummy_devmode,
            sample_settings("Canon TS8300"),
            sample_fingerprint("Canon TS8300"),
            None,
            None,
        );
        assert!(duplicate_res.is_err());

        // Same name on a different printer must succeed
        let other_printer_res = store.save_profile(
            "A4 单面",
            "HP LaserJet",
            &dummy_devmode,
            sample_settings("HP LaserJet"),
            sample_fingerprint("HP LaserJet"),
            None,
            None,
        );
        assert!(other_printer_res.is_ok());
    }

    #[test]
    fn renames_and_duplicates_profile() {
        let (store, _dir) = make_test_store();
        let dummy_devmode = vec![1, 2, 3];

        let saved = store
            .save_profile(
                "原名称",
                "HP LaserJet",
                &dummy_devmode,
                sample_settings("HP LaserJet"),
                sample_fingerprint("HP LaserJet"),
                None,
                None,
            )
            .expect("save profile");

        let renamed = store.rename_profile(&saved.id, "新名称").expect("rename");
        assert_eq!(renamed.name, "新名称");
        assert_eq!(renamed.id, saved.id);

        let duplicated = store
            .duplicate_profile(&saved.id, "复制配置")
            .expect("duplicate");
        assert_eq!(duplicated.name, "复制配置");
        assert_ne!(duplicated.id, saved.id);

        let list = store.list_profiles(Some("HP LaserJet"));
        assert_eq!(list.len(), 2);
    }

    #[test]
    fn sets_and_deletes_default_profile() {
        let (store, _dir) = make_test_store();
        let dummy_devmode = vec![5, 6, 7];

        let saved = store
            .save_profile(
                "默认项",
                "HP LaserJet",
                &dummy_devmode,
                sample_settings("HP LaserJet"),
                sample_fingerprint("HP LaserJet"),
                None,
                None,
            )
            .expect("save profile");

        store
            .set_default_profile("HP LaserJet", Some(&saved.id))
            .expect("set default");
        assert_eq!(
            store.get_default_profile_id("HP LaserJet"),
            Some(saved.id.clone())
        );

        store.delete_profile(&saved.id).expect("delete profile");
        assert_eq!(store.get_default_profile_id("HP LaserJet"), None);
        assert!(store.get_profile(&saved.id).is_none());
    }

    #[test]
    fn reorders_profiles_for_one_printer_without_moving_other_printers() {
        let (store, _dir) = make_test_store();
        let dummy_devmode = vec![1, 2, 3];

        let first = store
            .save_profile(
                "第一项",
                "HP LaserJet",
                &dummy_devmode,
                sample_settings("HP LaserJet"),
                sample_fingerprint("HP LaserJet"),
                None,
                None,
            )
            .expect("save first");
        let other = store
            .save_profile(
                "其他打印机",
                "Canon TS8300",
                &dummy_devmode,
                sample_settings("Canon TS8300"),
                sample_fingerprint("Canon TS8300"),
                None,
                None,
            )
            .expect("save other");
        let second = store
            .save_profile(
                "第二项",
                "HP LaserJet",
                &dummy_devmode,
                sample_settings("HP LaserJet"),
                sample_fingerprint("HP LaserJet"),
                None,
                None,
            )
            .expect("save second");
        let third = store
            .save_profile(
                "第三项",
                "HP LaserJet",
                &dummy_devmode,
                sample_settings("HP LaserJet"),
                sample_fingerprint("HP LaserJet"),
                None,
                None,
            )
            .expect("save third");

        store
            .reorder_profiles(
                "HP LaserJet",
                &[third.id.clone(), first.id.clone(), second.id.clone()],
            )
            .expect("reorder profiles");

        let hp_ids: Vec<String> = store
            .list_profiles(Some("HP LaserJet"))
            .into_iter()
            .map(|profile| profile.id)
            .collect();
        assert_eq!(hp_ids, vec![third.id, first.id, second.id]);

        let all_ids: Vec<String> = store
            .list_profiles(None)
            .into_iter()
            .map(|profile| profile.id)
            .collect();
        assert_eq!(all_ids[1], other.id);
    }

    #[test]
    fn rejects_incomplete_profile_order() {
        let (store, _dir) = make_test_store();
        let dummy_devmode = vec![1, 2, 3];
        let first = store
            .save_profile(
                "第一项",
                "HP LaserJet",
                &dummy_devmode,
                sample_settings("HP LaserJet"),
                sample_fingerprint("HP LaserJet"),
                None,
                None,
            )
            .expect("save first");
        store
            .save_profile(
                "第二项",
                "HP LaserJet",
                &dummy_devmode,
                sample_settings("HP LaserJet"),
                sample_fingerprint("HP LaserJet"),
                None,
                None,
            )
            .expect("save second");

        let result = store.reorder_profiles("HP LaserJet", &[first.id]);
        assert!(result.is_err());
    }

    #[test]
    fn portable_mode_detection_and_flag_test() {
        let temp_dir =
            std::env::temp_dir().join(format!("printassist-portable-{}", Uuid::new_v4()));
        let _ = fs::create_dir_all(&temp_dir);
        let _guard = TempDirGuard(temp_dir.clone());

        // Without flag -> false
        assert!(!PersistentPrinterProfileStore::is_portable_mode(Some(
            &temp_dir
        )));

        // With portable.flag -> true
        let flag_path = temp_dir.join("portable.flag");
        fs::write(&flag_path, b"").expect("write flag");
        assert!(PersistentPrinterProfileStore::is_portable_mode(Some(
            &temp_dir
        )));
    }

    #[test]
    fn transactional_migration_succeeds_and_verifies_files() {
        let (source_store, source_guard) = make_test_store();
        let target_temp =
            std::env::temp_dir().join(format!("printassist-target-{}", Uuid::new_v4()));
        let _target_guard = TempDirGuard(target_temp.clone());

        let devmode_data = vec![42, 43, 44];
        let profile = source_store
            .save_profile(
                "迁移测试配置",
                "Canon TS8300",
                &devmode_data,
                sample_settings("Canon TS8300"),
                sample_fingerprint("Canon TS8300"),
                None,
                None,
            )
            .expect("save profile");

        let res =
            PersistentPrinterProfileStore::transactional_migrate(&target_temp, &source_guard.0);
        assert!(res.is_ok());

        let target_store = PersistentPrinterProfileStore::new(&target_temp);
        let loaded = target_store
            .get_profile(&profile.id)
            .expect("get profile in target");
        assert_eq!(loaded.name, "迁移测试配置");

        let loaded_bytes = target_store
            .load_devmode_bytes(&profile.id)
            .expect("load devmode bytes in target");
        assert_eq!(loaded_bytes, devmode_data);
    }

    #[test]
    fn transactional_migration_aborts_and_cleans_up_on_missing_file() {
        let (source_store, source_guard) = make_test_store();
        let target_temp =
            std::env::temp_dir().join(format!("printassist-target-fail-{}", Uuid::new_v4()));
        let _target_guard = TempDirGuard(target_temp.clone());

        let devmode_data = vec![10, 20, 30];
        let profile = source_store
            .save_profile(
                "损坏测试配置",
                "HP LaserJet",
                &devmode_data,
                sample_settings("HP LaserJet"),
                sample_fingerprint("HP LaserJet"),
                None,
                None,
            )
            .expect("save profile");

        // Intentionally delete the source data file to simulate corrupted/incomplete source
        let file_to_delete = source_guard
            .0
            .join("printer-profiles")
            .join("data")
            .join(&profile.devmode_file);
        let _ = fs::remove_file(file_to_delete);

        let res =
            PersistentPrinterProfileStore::transactional_migrate(&target_temp, &source_guard.0);
        assert!(res.is_err());

        // Target index.json must NOT exist (no partial corruption)
        assert!(!target_temp.join("index.json").exists());
    }
}
