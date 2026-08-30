//! PDF printable annotation and electronic seal flattening module.
//!
//! Windows.Data.Pdf engine ignores certain custom or stamp annotations (e.g. /GoldGrid:AddSeal)
//! during rasterization, causing digital seals on legal/governmental PDFs to be missing in prints.
//!
//! This module scans for printable annotations (flags & 4 != 0, not hidden), computes the
//! exact coordinate transformation mapping the Form XObject appearance to the page, and
//! produces a temporary flattened PDF for the print pipeline while preserving the original file.

use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};

use lopdf::{Dictionary, Document, Object, ObjectId, Stream};

use super::pdf_pages::{prepare_document_for_full_rewrite, staging_dir};

const MAX_ANNOTATIONS_PER_FILE: usize = 500;
const MAX_APPEARANCE_STREAM_BYTES: usize = 50 * 1024 * 1024; // 50 MB safety cap

/// Scan summary of printable annotations in a PDF.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PrintableAnnotationScan {
    pub count: usize,
    pub unsupported_count: usize,
}

/// Represents a prepared PDF for rendering.
/// If temporary, it is automatically removed upon Drop.
#[derive(Debug)]
pub enum PreparedPdf {
    Original(PathBuf),
    Temporary(PathBuf),
}

impl PreparedPdf {
    pub fn path(&self) -> &Path {
        match self {
            PreparedPdf::Original(p) => p.as_path(),
            PreparedPdf::Temporary(p) => p.as_path(),
        }
    }
}

impl Drop for PreparedPdf {
    fn drop(&mut self) {
        if let PreparedPdf::Temporary(ref p) = self {
            let _ = fs::remove_file(p);
        }
    }
}

/// 2D affine transformation matrix `[a, b, c, d, e, f]`.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Matrix2D {
    pub a: f64,
    pub b: f64,
    pub c: f64,
    pub d: f64,
    pub e: f64,
    pub f: f64,
}

impl Default for Matrix2D {
    fn default() -> Self {
        Self::IDENTITY
    }
}

impl Matrix2D {
    pub const IDENTITY: Self = Self {
        a: 1.0,
        b: 0.0,
        c: 0.0,
        d: 1.0,
        e: 0.0,
        f: 0.0,
    };

    pub fn transform_point(&self, x: f64, y: f64) -> (f64, f64) {
        (
            x * self.a + y * self.c + self.e,
            x * self.b + y * self.d + self.f,
        )
    }
}

fn to_f64(obj: &Object) -> Option<f64> {
    match obj {
        Object::Real(r) => Some(*r as f64),
        Object::Integer(i) => Some(*i as f64),
        _ => None,
    }
}

fn parse_rect(obj: &Object) -> Option<[f64; 4]> {
    let arr = obj.as_array().ok()?;
    if arr.len() < 4 {
        return None;
    }
    Some([
        to_f64(&arr[0])?,
        to_f64(&arr[1])?,
        to_f64(&arr[2])?,
        to_f64(&arr[3])?,
    ])
}

fn parse_matrix(obj: &Object) -> Option<Matrix2D> {
    let arr = obj.as_array().ok()?;
    if arr.len() < 6 {
        return None;
    }
    Some(Matrix2D {
        a: to_f64(&arr[0])?,
        b: to_f64(&arr[1])?,
        c: to_f64(&arr[2])?,
        d: to_f64(&arr[3])?,
        e: to_f64(&arr[4])?,
        f: to_f64(&arr[5])?,
    })
}

/// Compute the transformation matrix `[sx, 0, 0, sy, tx, ty]` needed to map
/// the Form XObject's BBox (after its internal Matrix) into the annotation's page Rect.
pub fn compute_flatten_transform(
    rect: [f64; 4],
    bbox: [f64; 4],
    form_matrix: Matrix2D,
) -> Result<Matrix2D, String> {
    let rx0 = rect[0].min(rect[2]);
    let rx1 = rect[0].max(rect[2]);
    let ry0 = rect[1].min(rect[3]);
    let ry1 = rect[1].max(rect[3]);
    let rect_w = rx1 - rx0;
    let rect_h = ry1 - ry0;

    if rect_w <= 1e-6 || rect_h <= 1e-6 {
        return Err("批注矩形尺寸无效 (width/height <= 0)".to_string());
    }

    let bx0 = bbox[0].min(bbox[2]);
    let bx1 = bbox[0].max(bbox[2]);
    let by0 = bbox[1].min(bbox[3]);
    let by1 = bbox[1].max(bbox[3]);

    let corners = [
        form_matrix.transform_point(bx0, by0),
        form_matrix.transform_point(bx1, by0),
        form_matrix.transform_point(bx0, by1),
        form_matrix.transform_point(bx1, by1),
    ];

    let min_x = corners.iter().map(|c| c.0).fold(f64::INFINITY, f64::min);
    let max_x = corners.iter().map(|c| c.0).fold(f64::NEG_INFINITY, f64::max);
    let min_y = corners.iter().map(|c| c.1).fold(f64::INFINITY, f64::min);
    let max_y = corners.iter().map(|c| c.1).fold(f64::NEG_INFINITY, f64::max);

    let transformed_w = max_x - min_x;
    let transformed_h = max_y - min_y;

    if transformed_w <= 1e-6 || transformed_h <= 1e-6 {
        return Err("外观包围盒尺寸无效 (width/height <= 0)".to_string());
    }

    let sx = rect_w / transformed_w;
    let sy = rect_h / transformed_h;
    let tx = rx0 - min_x * sx;
    let ty = ry0 - min_y * sy;

    Ok(Matrix2D {
        a: sx,
        b: 0.0,
        c: 0.0,
        d: sy,
        e: tx,
        f: ty,
    })
}

fn format_pdf_number(val: f64) -> String {
    let s = format!("{:.6}", val);
    let trimmed = s.trim_end_matches('0').trim_end_matches('.');
    if trimmed.is_empty() || trimmed == "-0" {
        "0".to_string()
    } else {
        trimmed.to_string()
    }
}

/// Metadata extracted for a single printable annotation.
#[derive(Debug)]
struct PrintableAnnotationInfo {
    annot_ref: Option<ObjectId>,
    form_xobject_obj_id: ObjectId,
    transform: Matrix2D,
}

fn deref_dictionary<'a>(doc: &'a Document, obj: &'a Object) -> Option<&'a Dictionary> {
    match obj {
        Object::Dictionary(ref d) => Some(d),
        Object::Reference(id) => doc.get_dictionary(*id).ok(),
        _ => None,
    }
}

fn deref_stream<'a>(doc: &'a Document, obj: &'a Object) -> Option<(Option<ObjectId>, &'a Stream)> {
    match obj {
        Object::Stream(ref s) => Some((None, s)),
        Object::Reference(id) => {
            if let Ok(Object::Stream(ref s)) = doc.get_object(*id) {
                Some((Some(*id), s))
            } else {
                None
            }
        }
        _ => None,
    }
}

fn extract_normal_appearance_stream<'a>(
    doc: &'a Document,
    annot_dict: &'a Dictionary,
) -> Result<Option<(Option<ObjectId>, &'a Stream)>, String> {
    let ap_obj = match annot_dict.get(b"AP") {
        Ok(obj) => obj,
        Err(_) => return Ok(None),
    };

    let ap_dict = match deref_dictionary(doc, ap_obj) {
        Some(d) => d,
        None => return Ok(None),
    };

    let n_obj = match ap_dict.get(b"N") {
        Ok(obj) => obj,
        Err(_) => return Ok(None),
    };

    // Case 1: /N is directly a Stream or Reference to Stream
    if let Some(stream_info) = deref_stream(doc, n_obj) {
        return Ok(Some(stream_info));
    }

    // Case 2: /N is a dictionary of states (e.g. /On, /Off)
    if let Some(states_dict) = deref_dictionary(doc, n_obj) {
        // Try /AS (Appearance State) from annotation dictionary
        let state_name = annot_dict
            .get(b"AS")
            .ok()
            .and_then(|obj| obj.as_name_str().ok());

        if let Some(name) = state_name {
            if let Ok(target_obj) = states_dict.get(name.as_bytes()) {
                if let Some(stream_info) = deref_stream(doc, target_obj) {
                    return Ok(Some(stream_info));
                }
            }
        }

        // Fallback: Pick first state that is not /Off
        for (k, v) in states_dict.iter() {
            if k != b"Off" {
                if let Some(stream_info) = deref_stream(doc, v) {
                    return Ok(Some(stream_info));
                }
            }
        }

        // Last resort: Pick first entry
        if let Some((_, v)) = states_dict.iter().next() {
            if let Some(stream_info) = deref_stream(doc, v) {
                return Ok(Some(stream_info));
            }
        }
    }

    Ok(None)
}

/// Inspects an annotation dictionary.
/// Returns:
/// - `Ok(Some(info))` if it is a valid printable annotation to flatten.
/// - `Ok(None)` if it is not a printable annotation or should be skipped (e.g. non-visual link/popup).
/// - `Err(msg)` if it has printable flag but contains unsupported / corrupted appearance.
fn inspect_annotation(
    doc: &mut Document,
    annot_dict: &Dictionary,
    annot_ref: Option<ObjectId>,
) -> Result<Option<PrintableAnnotationInfo>, String> {
    let subtype = annot_dict
        .get(b"Subtype")
        .ok()
        .and_then(|o| o.as_name_str().ok())
        .unwrap_or("");

    // Flags: /F
    let flags = annot_dict
        .get(b"F")
        .ok()
        .and_then(|o| o.as_i64().ok())
        .unwrap_or(0);

    let is_print = (flags & 4) != 0;
    let is_hidden = (flags & 2) != 0;

    if !is_print || is_hidden {
        return Ok(None);
    }

    // Popup and Link annotations are non-visual or interactive helpers
    if (subtype == "Popup" || subtype == "Link") && annot_dict.get(b"AP").is_err() {
        return Ok(None);
    }

    // Must have Rect
    let rect_obj = annot_dict
        .get(b"Rect")
        .map_err(|_| "批注缺少 /Rect 矩形定义".to_string())?;
    let rect = parse_rect(rect_obj).ok_or_else(|| "批注 /Rect 格式无效".to_string())?;

    // Extract appearance stream
    let (existing_stream_id, stream) = extract_normal_appearance_stream(doc, annot_dict)?
        .ok_or_else(|| "可打印批注缺少正常外观流 (/AP /N)".to_string())?;

    if stream.content.len() > MAX_APPEARANCE_STREAM_BYTES {
        return Err("批注外观流超出安全大小上限 (50MB)".to_string());
    }

    // Extract BBox and Matrix from Form XObject stream dictionary
    let bbox = if let Ok(bbox_obj) = stream.dict.get(b"BBox") {
        parse_rect(bbox_obj).ok_or_else(|| "外观流 /BBox 格式无效".to_string())?
    } else {
        // If it's an Image XObject, default bbox is [0, 0, 1, 1]
        let sub = stream
            .dict
            .get(b"Subtype")
            .ok()
            .and_then(|o| o.as_name_str().ok())
            .unwrap_or("");
        if sub == "Image" {
            [0.0, 0.0, 1.0, 1.0]
        } else {
            return Err("外观流缺少 /BBox 包围盒定义".to_string());
        }
    };

    let form_matrix = stream
        .dict
        .get(b"Matrix")
        .ok()
        .and_then(parse_matrix)
        .unwrap_or_default();

    let transform = compute_flatten_transform(rect, bbox, form_matrix)?;

    let form_xobject_obj_id = if let Some(id) = existing_stream_id {
        id
    } else {
        doc.add_object(Object::Stream(stream.clone()))
    };

    Ok(Some(PrintableAnnotationInfo {
        annot_ref,
        form_xobject_obj_id,
        transform,
    }))
}

/// Scans a PDF document for printable annotations.
pub fn scan_printable_annotations(path: &Path) -> Result<PrintableAnnotationScan, String> {
    if !path.exists() {
        return Err(format!("文件不存在：{}", path.display()));
    }

    let mut doc = Document::load(path).map_err(|err| format!("读取 PDF 失败：{err}"))?;
    let mut count = 0;
    let mut unsupported_count = 0;

    let pages = doc.get_pages();
    for (_page_num, page_id) in pages {
        let page_dict = match doc.get_dictionary(page_id) {
            Ok(d) => d.clone(),
            Err(_) => continue,
        };

        let annots_obj = match page_dict.get(b"Annots") {
            Ok(obj) => obj.clone(),
            Err(_) => continue,
        };

        let annot_items: Vec<(Option<ObjectId>, Dictionary)> = match annots_obj {
            Object::Array(ref arr) => arr
                .iter()
                .filter_map(|item| match item {
                    Object::Reference(id) => doc
                        .get_dictionary(*id)
                        .ok()
                        .map(|dict| (Some(*id), dict.clone())),
                    Object::Dictionary(ref dict) => Some((None, dict.clone())),
                    _ => None,
                })
                .collect(),
            Object::Reference(id) => {
                if let Ok(Object::Array(ref arr)) = doc.get_object(id) {
                    arr.iter()
                        .filter_map(|item| match item {
                            Object::Reference(item_id) => doc
                                .get_dictionary(*item_id)
                                .ok()
                                .map(|dict| (Some(*item_id), dict.clone())),
                            Object::Dictionary(ref dict) => Some((None, dict.clone())),
                            _ => None,
                        })
                        .collect()
                } else {
                    Vec::new()
                }
            }
            _ => Vec::new(),
        };

        for (annot_ref, annot_dict) in annot_items {
            if count + unsupported_count > MAX_ANNOTATIONS_PER_FILE {
                return Err("批注总数超出安全上限 (500)".to_string());
            }

            match inspect_annotation(&mut doc, &annot_dict, annot_ref) {
                Ok(Some(_)) => count += 1,
                Ok(None) => {}
                Err(_) => unsupported_count += 1,
            }
        }
    }

    Ok(PrintableAnnotationScan {
        count,
        unsupported_count,
    })
}

/// Prepares a PDF for Windows rendering.
/// If printable annotations (like digital seals) are found, a temporary flattened copy
/// is created and returned in `PreparedPdf::Temporary`.
/// If no printable annotations exist, returns `PreparedPdf::Original`.
pub fn prepare_pdf_for_windows_rendering(path: &Path) -> Result<PreparedPdf, String> {
    if !path.exists() {
        return Err(format!("文件不存在：{}", path.display()));
    }

    let scan = scan_printable_annotations(path)?;
    if scan.count == 0 && scan.unsupported_count == 0 {
        return Ok(PreparedPdf::Original(path.to_path_buf()));
    }

    if scan.unsupported_count > 0 {
        return Err(
            "检测到电子印章或可打印批注，但当前文件无法安全合成。为避免打印内容缺失，请使用 PDF 阅读器的“打印为图像”功能。".to_string()
        );
    }

    // Flatten annotations into a temporary PDF
    let mut doc = Document::load(path).map_err(|err| format!("加载 PDF 失败：{err}"))?;
    let pages = doc.get_pages();

    for (page_num, page_id) in pages {
        let page_dict = match doc.get_dictionary(page_id) {
            Ok(d) => d.clone(),
            Err(_) => continue,
        };

        let annots_obj = match page_dict.get(b"Annots") {
            Ok(obj) => obj.clone(),
            Err(_) => continue,
        };

        let annot_items: Vec<(Option<ObjectId>, Dictionary)> = match annots_obj {
            Object::Array(ref arr) => arr
                .iter()
                .filter_map(|item| match item {
                    Object::Reference(id) => doc
                        .get_dictionary(*id)
                        .ok()
                        .map(|dict| (Some(*id), dict.clone())),
                    Object::Dictionary(ref dict) => Some((None, dict.clone())),
                    _ => None,
                })
                .collect(),
            Object::Reference(id) => {
                if let Ok(Object::Array(ref arr)) = doc.get_object(id) {
                    arr.iter()
                        .filter_map(|item| match item {
                            Object::Reference(item_id) => doc
                                .get_dictionary(*item_id)
                                .ok()
                                .map(|dict| (Some(*item_id), dict.clone())),
                            Object::Dictionary(ref dict) => Some((None, dict.clone())),
                            _ => None,
                        })
                        .collect()
                } else {
                    Vec::new()
                }
            }
            _ => Vec::new(),
        };

        let mut to_flatten = Vec::new();
        for (annot_ref, annot_dict) in annot_items {
            if let Ok(Some(info)) = inspect_annotation(&mut doc, &annot_dict, annot_ref) {
                to_flatten.push(info);
            }
        }

        if to_flatten.is_empty() {
            continue;
        }

        // 1. Ensure page has /Resources
        ensure_page_resources(&mut doc, page_id)?;

        // 2. Build content stream and register Form XObjects into page's /Resources /XObject
        let mut content_buffer = Vec::new();
        let mut flattened_refs = HashSet::new();

        for (idx, info) in to_flatten.into_iter().enumerate() {
            let res_name = format!("PA_Seal_{}_{}", page_num, idx);

            add_xobject_to_page_resources(
                &mut doc,
                page_id,
                res_name.as_bytes(),
                info.form_xobject_obj_id,
            )?;

            let cm_command = format!(
                "\nq\n{} {} {} {} {} {} cm\n/{} Do\nQ\n",
                format_pdf_number(info.transform.a),
                format_pdf_number(info.transform.b),
                format_pdf_number(info.transform.c),
                format_pdf_number(info.transform.d),
                format_pdf_number(info.transform.e),
                format_pdf_number(info.transform.f),
                res_name
            );
            content_buffer.extend_from_slice(cm_command.as_bytes());

            if let Some(r) = info.annot_ref {
                flattened_refs.insert(r);
            }
        }

        // 3. Append content stream to page
        let new_stream_id = doc.add_object(Object::Stream(Stream::new(
            Dictionary::new(),
            content_buffer,
        )));

        let page_dict_mut = doc
            .get_dictionary_mut(page_id)
            .map_err(|e| format!("更新页面内容流失败：{e}"))?;

        match page_dict_mut.get_mut(b"Contents") {
            Ok(Object::Reference(orig_ref)) => {
                let existing_id = *orig_ref;
                page_dict_mut.set(
                    b"Contents",
                    Object::Array(vec![
                        Object::Reference(existing_id),
                        Object::Reference(new_stream_id),
                    ]),
                );
            }
            Ok(Object::Array(ref mut arr)) => {
                arr.push(Object::Reference(new_stream_id));
            }
            _ => {
                page_dict_mut.set(b"Contents", Object::Reference(new_stream_id));
            }
        }

        // 4. Remove flattened annotations from /Annots
        remove_flattened_annotations(&mut doc, page_id, &flattened_refs)?;
    }

    prepare_document_for_full_rewrite(&mut doc);

    let output_path = staging_dir()?.join(format!(
        "printassist-flattened-{}-{}-{}.pdf",
        std::process::id(),
        uuid::Uuid::new_v4(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|duration| duration.as_millis())
            .unwrap_or(0)
    ));

    {
        let file = doc
            .save(&output_path)
            .map_err(|err| format!("写入扁平化临时 PDF 失败：{err}"))?;
        drop(file);
    }

    // Verify reloadable
    Document::load(&output_path).map_err(|err| {
        let _ = fs::remove_file(&output_path);
        format!("扁平化 PDF 校验重载失败：{err}")
    })?;

    Ok(PreparedPdf::Temporary(output_path))
}

fn ensure_page_resources(doc: &mut Document, page_id: ObjectId) -> Result<(), String> {
    let page_dict = doc
        .get_dictionary(page_id)
        .map_err(|e| format!("获取页面字典失败：{e}"))?;

    if page_dict.get(b"Resources").is_ok() {
        return Ok(());
    }

    // Check parent tree for inherited /Resources
    let mut current_id = page_id;
    let mut inherited_res: Option<Object> = None;

    while let Ok(current_dict) = doc.get_dictionary(current_id) {
        if let Ok(res) = current_dict.get(b"Resources") {
            inherited_res = Some(res.clone());
            break;
        }
        if let Ok(Object::Reference(parent_id)) = current_dict.get(b"Parent") {
            current_id = *parent_id;
        } else {
            break;
        }
    }

    let page_dict_mut = doc
        .get_dictionary_mut(page_id)
        .map_err(|e| format!("更新页面字典失败：{e}"))?;

    let res_obj = inherited_res.unwrap_or_else(|| Object::Dictionary(Dictionary::new()));
    page_dict_mut.set(b"Resources", res_obj);
    Ok(())
}

fn add_xobject_to_page_resources(
    doc: &mut Document,
    page_id: ObjectId,
    name: &[u8],
    xobject_id: ObjectId,
) -> Result<(), String> {
    let page_dict = doc
        .get_dictionary(page_id)
        .map_err(|e| format!("获取页面字典失败：{e}"))?;

    let res_obj = page_dict
        .get(b"Resources")
        .map_err(|e| format!("页面缺少 Resources：{e}"))?
        .clone();

    // Check if /XObject inside /Resources is an indirect reference
    let xobject_indirect_id: Option<ObjectId> = match res_obj {
        Object::Reference(res_dict_id) => {
            let res_dict = doc
                .get_dictionary(res_dict_id)
                .map_err(|e| format!("获取资源字典失败：{e}"))?;
            match res_dict.get(b"XObject") {
                Ok(Object::Reference(xid)) => Some(*xid),
                _ => None,
            }
        }
        Object::Dictionary(ref res_dict) => match res_dict.get(b"XObject") {
            Ok(Object::Reference(xid)) => Some(*xid),
            _ => None,
        },
        _ => return Err("无效的 Resources 对象格式".to_string()),
    };

    if let Some(xid) = xobject_indirect_id {
        let xobj_dict = doc
            .get_dictionary_mut(xid)
            .map_err(|e| format!("获取 XObject 字典失败：{e}"))?;
        xobj_dict.set(name, Object::Reference(xobject_id));
        return Ok(());
    }

    // Otherwise, XObject dictionary is either direct inside Resources or not present yet.
    match res_obj {
        Object::Reference(res_dict_id) => {
            let res_dict = doc
                .get_dictionary_mut(res_dict_id)
                .map_err(|e| format!("获取资源字典失败：{e}"))?;
            insert_direct_xobject(res_dict, name, xobject_id);
        }
        Object::Dictionary(_) => {
            let page_dict_mut = doc
                .get_dictionary_mut(page_id)
                .map_err(|e| format!("获取页面字典失败：{e}"))?;
            if let Ok(Object::Dictionary(ref mut res_dict)) = page_dict_mut.get_mut(b"Resources") {
                insert_direct_xobject(res_dict, name, xobject_id);
            }
        }
        _ => {}
    }

    Ok(())
}

fn insert_direct_xobject(res_dict: &mut Dictionary, name: &[u8], xobject_id: ObjectId) {
    if let Ok(Object::Dictionary(ref mut dict)) = res_dict.get_mut(b"XObject") {
        dict.set(name, Object::Reference(xobject_id));
        return;
    }
    let mut dict = Dictionary::new();
    dict.set(name, Object::Reference(xobject_id));
    res_dict.set(b"XObject", Object::Dictionary(dict));
}

fn remove_flattened_annotations(
    doc: &mut Document,
    page_id: ObjectId,
    flattened_refs: &HashSet<ObjectId>,
) -> Result<(), String> {
    if flattened_refs.is_empty() {
        return Ok(());
    }

    let page_dict_mut = doc
        .get_dictionary_mut(page_id)
        .map_err(|e| format!("获取页面字典失败：{e}"))?;

    let annots_entry = match page_dict_mut.get_mut(b"Annots") {
        Ok(entry) => entry,
        Err(_) => return Ok(()),
    };

    match annots_entry {
        Object::Array(ref mut arr) => {
            arr.retain(|item| {
                if let Object::Reference(id) = item {
                    !flattened_refs.contains(id)
                } else {
                    true
                }
            });
        }
        Object::Reference(annots_id) => {
            let id = *annots_id;
            if let Ok(Object::Array(ref mut arr)) = doc.get_object_mut(id) {
                arr.retain(|item| {
                    if let Object::Reference(item_id) = item {
                        !flattened_refs.contains(item_id)
                    } else {
                        true
                    }
                });
            }
        }
        _ => {}
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use lopdf::{dictionary, Stream};

    #[test]
    fn matrix_identity_and_points() {
        let m = Matrix2D::IDENTITY;
        assert_eq!(m.transform_point(10.0, 20.0), (10.0, 20.0));

        let translated = Matrix2D {
            a: 1.0,
            b: 0.0,
            c: 0.0,
            d: 1.0,
            e: 5.0,
            f: -3.0,
        };
        assert_eq!(translated.transform_point(10.0, 20.0), (15.0, 17.0));
    }

    #[test]
    fn compute_flatten_transform_standard_box() {
        // Form BBox: [0, 0, 100, 100], Matrix: identity
        // Page Rect: [200, 300, 300, 400] (width 100, height 100)
        let rect = [200.0, 300.0, 300.0, 400.0];
        let bbox = [0.0, 0.0, 100.0, 100.0];
        let form_matrix = Matrix2D::IDENTITY;

        let res = compute_flatten_transform(rect, bbox, form_matrix).expect("valid transform");
        assert!((res.a - 1.0).abs() < 1e-6);
        assert!((res.d - 1.0).abs() < 1e-6);
        assert!((res.e - 200.0).abs() < 1e-6);
        assert!((res.f - 300.0).abs() < 1e-6);
    }

    #[test]
    fn compute_flatten_transform_scaled_with_non_zero_origin() {
        // Form BBox: [50, 50, 150, 250] (w=100, h=200)
        // Page Rect: [10, 20, 210, 420] (w=200, h=400)
        let rect = [10.0, 20.0, 210.0, 420.0];
        let bbox = [50.0, 50.0, 150.0, 250.0];
        let form_matrix = Matrix2D::IDENTITY;

        let res = compute_flatten_transform(rect, bbox, form_matrix).expect("valid transform");
        // sx = 200/100 = 2.0, sy = 400/200 = 2.0
        // tx = 10 - 50 * 2.0 = -90
        // ty = 20 - 50 * 2.0 = -80
        assert!((res.a - 2.0).abs() < 1e-6);
        assert!((res.d - 2.0).abs() < 1e-6);
        assert!((res.e - (-90.0)).abs() < 1e-6);
        assert!((res.f - (-80.0)).abs() < 1e-6);
    }

    #[test]
    fn compute_flatten_transform_rejects_zero_rect_or_bbox() {
        let invalid_rect = [10.0, 20.0, 10.0, 420.0]; // w=0
        let bbox = [0.0, 0.0, 100.0, 100.0];
        assert!(compute_flatten_transform(invalid_rect, bbox, Matrix2D::IDENTITY).is_err());

        let rect = [10.0, 20.0, 110.0, 120.0];
        let invalid_bbox = [50.0, 50.0, 50.0, 50.0]; // w=0, h=0
        assert!(compute_flatten_transform(rect, invalid_bbox, Matrix2D::IDENTITY).is_err());
    }

    struct TestTempDir(PathBuf);
    impl Drop for TestTempDir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    fn create_test_pdf_with_annotation(
        flags: i64,
        has_appearance: bool,
        subtype: &str,
    ) -> (TestTempDir, PathBuf) {
        let temp_dir_path =
            std::env::temp_dir().join(format!("test_annot_{}", uuid::Uuid::new_v4()));
        let _ = fs::create_dir_all(&temp_dir_path);
        let pdf_path = temp_dir_path.join("test_annot.pdf");
        let temp_dir = TestTempDir(temp_dir_path);

        let mut doc = Document::with_version("1.5");
        let pages_id = doc.new_object_id();

        // 1. Create Form XObject stream if needed
        let form_xobject_id = if has_appearance {
            let form_dict = dictionary! {
                "Type" => Object::Name(b"XObject".to_vec()),
                "Subtype" => Object::Name(b"Form".to_vec()),
                "BBox" => Object::Array(vec![
                    Object::Integer(0),
                    Object::Integer(0),
                    Object::Integer(100),
                    Object::Integer(100),
                ]),
            };
            let stream = Stream::new(form_dict, b"1 0 0 rg 0 0 100 100 re f".to_vec());
            Some(doc.add_object(Object::Stream(stream)))
        } else {
            None
        };

        // 2. Create Annotation dictionary
        let mut annot_dict = dictionary! {
            "Type" => Object::Name(b"Annot".to_vec()),
            "Subtype" => Object::Name(subtype.as_bytes().to_vec()),
            "Rect" => Object::Array(vec![
                Object::Integer(50),
                Object::Integer(100),
                Object::Integer(150),
                Object::Integer(200),
            ]),
            "F" => Object::Integer(flags),
        };

        if let Some(xobj_id) = form_xobject_id {
            let ap_dict = dictionary! {
                "N" => Object::Reference(xobj_id),
            };
            annot_dict.set("AP", Object::Dictionary(ap_dict));
        }

        let annot_id = doc.add_object(Object::Dictionary(annot_dict));

        // 3. Content stream
        let content_id = doc.add_object(Object::Stream(Stream::new(
            Dictionary::new(),
            b"BT /F1 12 Tf 100 700 Td (Test Page) Tj ET".to_vec(),
        )));

        // 4. Page dictionary
        let page_dict = dictionary! {
            "Type" => Object::Name(b"Page".to_vec()),
            "Parent" => Object::Reference(pages_id),
            "MediaBox" => Object::Array(vec![
                Object::Integer(0),
                Object::Integer(0),
                Object::Integer(595),
                Object::Integer(842),
            ]),
            "Contents" => Object::Reference(content_id),
            "Annots" => Object::Array(vec![Object::Reference(annot_id)]),
        };
        let page_id = doc.add_object(Object::Dictionary(page_dict));

        // 5. Pages dictionary
        let pages_dict = dictionary! {
            "Type" => Object::Name(b"Pages".to_vec()),
            "Kids" => Object::Array(vec![Object::Reference(page_id)]),
            "Count" => Object::Integer(1),
        };
        doc.objects.insert(pages_id, Object::Dictionary(pages_dict));

        // 6. Catalog
        let catalog_id = doc.add_object(dictionary! {
            "Type" => Object::Name(b"Catalog".to_vec()),
            "Pages" => Object::Reference(pages_id),
        });
        doc.trailer.set("Root", Object::Reference(catalog_id));

        doc.save(&pdf_path).expect("save test pdf");
        (temp_dir, pdf_path)
    }

    #[test]
    fn scan_finds_printable_custom_seal_and_flattens_it() {
        // flags: 4 (Print)
        let (_dir, pdf_path) =
            create_test_pdf_with_annotation(4, true, "GoldGrid:AddSeal");

        let scan = scan_printable_annotations(&pdf_path).expect("scan succeeds");
        assert_eq!(scan.count, 1);
        assert_eq!(scan.unsupported_count, 0);

        let prepared =
            prepare_pdf_for_windows_rendering(&pdf_path).expect("prepare succeeds");
        match prepared {
            PreparedPdf::Temporary(ref temp_path) => {
                assert!(temp_path.exists());
                // Verify that flattened temp PDF contains Do and PA_Seal
                let doc = Document::load(temp_path).expect("reloaded flattened");
                let pages = doc.get_pages();
                let page_id = pages.values().next().expect("page exists");
                let page_dict = doc.get_dictionary(*page_id).expect("page dict");

                // Check that annotation was removed from /Annots
                if let Ok(Object::Array(ref arr)) = page_dict.get(b"Annots") {
                    assert!(arr.is_empty());
                }

                // Check that /Resources /XObject exists
                let res = page_dict.get(b"Resources").expect("resources exists");
                let res_dict = deref_dictionary(&doc, res).expect("res dict");
                assert!(res_dict.get(b"XObject").is_ok());

                // Check that Contents has the new stream
                let contents = page_dict.get(b"Contents").expect("contents exists");
                let arr = contents.as_array().expect("contents array");
                assert_eq!(arr.len(), 2);
            }
            PreparedPdf::Original(_) => panic!("Expected Temporary prepared PDF"),
        }
    }

    #[test]
    fn scan_ignores_non_printable_annotation() {
        // flags: 0 (Not marked for print)
        let (_dir, pdf_path) =
            create_test_pdf_with_annotation(0, true, "Stamp");

        let scan = scan_printable_annotations(&pdf_path).expect("scan succeeds");
        assert_eq!(scan.count, 0);
        assert_eq!(scan.unsupported_count, 0);

        let prepared =
            prepare_pdf_for_windows_rendering(&pdf_path).expect("prepare succeeds");
        match prepared {
            PreparedPdf::Original(ref p) => assert_eq!(p, &pdf_path),
            PreparedPdf::Temporary(_) => panic!("Expected Original prepared PDF"),
        }
    }

    #[test]
    fn scan_reports_unsupported_when_print_flag_has_no_appearance() {
        // flags: 4 (Print), but has_appearance: false
        let (_dir, pdf_path) =
            create_test_pdf_with_annotation(4, false, "Stamp");

        let scan = scan_printable_annotations(&pdf_path).expect("scan succeeds");
        assert_eq!(scan.count, 0);
        assert_eq!(scan.unsupported_count, 1);

        let prepared = prepare_pdf_for_windows_rendering(&pdf_path);
        assert!(prepared.is_err());
        let err = prepared.unwrap_err();
        assert!(err.contains("无法安全合成"));
    }

    #[test]
    fn prepared_pdf_cleans_up_temporary_file_on_drop() {
        let (_dir, pdf_path) =
            create_test_pdf_with_annotation(4, true, "GoldGrid:AddSeal");

        let temp_file_path;
        {
            let prepared =
                prepare_pdf_for_windows_rendering(&pdf_path).expect("prepare succeeds");
            match prepared {
                PreparedPdf::Temporary(ref p) => {
                    temp_file_path = p.clone();
                    assert!(temp_file_path.exists());
                }
                _ => panic!("Expected temporary"),
            }
        }
        // After drop:
        assert!(!temp_file_path.exists());
    }
}
