use std::path::PathBuf;

pub use crate::documents::{is_supported_file, SUPPORTED_EXTENSIONS};

pub fn collect_launch_paths(arguments: &[String]) -> Vec<String> {
    let mut paths = Vec::new();
    for argument in arguments.iter().skip(1) {
        collect_path_argument(argument, &mut paths);
    }
    paths
}

pub fn collect_path_argument(argument: &str, paths: &mut Vec<String>) {
    let trimmed = argument.trim().trim_matches('"');
    if trimmed.is_empty() || trimmed.starts_with('-') {
        return;
    }
    let path = PathBuf::from(trimmed);
    if path.is_file() {
        if is_supported_file(&path) {
            paths.push(path.to_string_lossy().to_string());
        }
        return;
    }
    if path.is_dir() {
        for entry in walkdir::WalkDir::new(&path)
            .max_depth(8)
            .into_iter()
            .filter_map(|result| result.ok())
        {
            if entry.file_type().is_file() && is_supported_file(entry.path()) {
                paths.push(entry.path().to_string_lossy().to_string());
            }
        }
    }
}
