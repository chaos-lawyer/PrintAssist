use std::collections::BTreeSet;

/// Parses expressions such as:
/// - "1,3,5-8"
/// - "1-L" (where L or L1 is the last page)
/// - "1-L2" (where L2 is the second-to-last page)
/// - "1-10, !3, !L" (excludes page 3 and last page)
/// - "!1, !L" (implicit all pages, excluding page 1 and last page)
///
/// Supports:
/// - Half-width and full-width commas (',' and '，')
/// - Half-width and full-width exclamation marks ('!' and '！')
/// - Half-width and full-width hyphens/dashes ('-', '－', '—', '–')
/// - Case-insensitive 'L' / 'l' for reverse indexing
///
/// Pages are 1-based, unique, sorted ascending.
pub fn parse_page_range_expression(
    expression: &str,
    total_pages: Option<u32>,
) -> Result<Vec<u32>, String> {
    let normalized = normalize_expression(expression);
    if normalized.is_empty() {
        return Err("页码表达式不能为空".to_string());
    }

    let raw_segments: Vec<&str> = normalized.split(',').collect();
    let mut parsed_segments = Vec::with_capacity(raw_segments.len());

    for raw in raw_segments {
        if raw.is_empty() {
            return Err("页码格式无效，存在连续逗号或空段".to_string());
        }

        let (is_exclude, body) = if let Some(stripped) = raw.strip_prefix('!') {
            if stripped.is_empty() || stripped.starts_with('!') {
                return Err(format!("排除语法无效：{raw}"));
            }
            (true, stripped)
        } else {
            (false, raw)
        };

        if body.contains('-') {
            let mut parts = body.splitn(2, '-');
            let start_text = parts.next().unwrap_or_default();
            let end_text = parts.next().unwrap_or_default();
            if start_text.is_empty() || end_text.is_empty() || end_text.contains('-') {
                return Err(format!("页码范围格式无效：{raw}"));
            }
            let start = parse_endpoint(start_text, raw)?;
            let end = parse_endpoint(end_text, raw)?;
            parsed_segments.push(ParsedSegment {
                is_exclude,
                raw_text: raw.to_string(),
                start,
                end,
            });
        } else {
            let endpoint = parse_endpoint(body, raw)?;
            parsed_segments.push(ParsedSegment {
                is_exclude,
                raw_text: raw.to_string(),
                start: endpoint,
                end: endpoint,
            });
        }
    }

    let has_include = parsed_segments.iter().any(|seg| !seg.is_exclude);

    let mut include_set = BTreeSet::new();
    if !has_include {
        let total = total_pages.ok_or_else(|| "仅指定排除页码时必须提供文档总页数".to_string())?;
        for page in 1..=total {
            include_set.insert(page);
        }
    }

    let mut exclude_set = BTreeSet::new();

    for seg in parsed_segments {
        let start_page = seg.start.resolve(total_pages)?;
        let end_page = seg.end.resolve(total_pages)?;
        if start_page > end_page {
            return Err(format!("页码范围起止颠倒：{}", seg.raw_text));
        }

        let target_set = if seg.is_exclude {
            &mut exclude_set
        } else {
            &mut include_set
        };

        for page in start_page..=end_page {
            target_set.insert(page);
        }
    }

    let final_pages: Vec<u32> = include_set.difference(&exclude_set).copied().collect();

    if final_pages.is_empty() {
        return Err("未解析到有效页码（排除后无剩余页码）".to_string());
    }

    Ok(final_pages)
}

fn normalize_expression(expression: &str) -> String {
    let mut normalized = String::with_capacity(expression.len());
    for ch in expression.chars() {
        match ch {
            ' ' | '\t' | '\r' | '\n' | '\u{3000}' => continue,
            '，' => normalized.push(','),
            '！' => normalized.push('!'),
            '－' | '—' | '–' => normalized.push('-'),
            other => normalized.push(other),
        }
    }
    normalized
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum PageEndpoint {
    Absolute(u32),
    FromEnd(u32), // 1 means last page (L or L1), 2 means second from last (L2), etc.
}

impl PageEndpoint {
    fn resolve(self, total_pages: Option<u32>) -> Result<u32, String> {
        match self {
            PageEndpoint::Absolute(page) => {
                if page < 1 {
                    return Err("页码必须从 1 开始".to_string());
                }
                if let Some(total) = total_pages {
                    if page > total {
                        return Err(format!("页码 {page} 超出文档总页数 {total}"));
                    }
                }
                Ok(page)
            }
            PageEndpoint::FromEnd(offset) => {
                let total = total_pages.ok_or_else(|| {
                    "使用倒数页码语法（如 L 或 L1）需要提供文档总页数".to_string()
                })?;
                if offset < 1 {
                    return Err("倒数页码必须从 1 开始（如 L 或 L1）".to_string());
                }
                if offset > total {
                    return Err(format!("倒数第 {offset} 页超出文档总页数 {total}"));
                }
                Ok(total - offset + 1)
            }
        }
    }
}

struct ParsedSegment {
    is_exclude: bool,
    raw_text: String,
    start: PageEndpoint,
    end: PageEndpoint,
}

fn parse_endpoint(text: &str, raw_segment: &str) -> Result<PageEndpoint, String> {
    if text.is_empty() {
        return Err(format!("页码段无效：{raw_segment}"));
    }

    let lower = text.to_ascii_lowercase();
    if let Some(remainder) = lower.strip_prefix('l') {
        if remainder.is_empty() {
            return Ok(PageEndpoint::FromEnd(1));
        }
        let offset = remainder
            .parse::<u32>()
            .map_err(|_| format!("倒数页码格式无效：{raw_segment}"))?;
        if offset < 1 {
            return Err("倒数页码必须从 1 开始（如 L 或 L1）".to_string());
        }
        return Ok(PageEndpoint::FromEnd(offset));
    }

    let page_number = text
        .parse::<u32>()
        .map_err(|_| format!("页码段无效：{raw_segment}"))?;
    if page_number < 1 {
        return Err("页码必须从 1 开始".to_string());
    }
    Ok(PageEndpoint::Absolute(page_number))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_mixed_commas_and_ranges() {
        let pages = parse_page_range_expression("1,3,5-8", None).expect("valid expression");
        assert_eq!(pages, vec![1, 3, 5, 6, 7, 8]);
    }

    #[test]
    fn rejects_inverted_ranges() {
        assert!(parse_page_range_expression("8-5", None).is_err());
    }

    #[test]
    fn rejects_out_of_bounds_pages() {
        assert!(parse_page_range_expression("1,12", Some(10)).is_err());
    }

    #[test]
    fn rejects_empty_expression() {
        assert!(parse_page_range_expression("   ", None).is_err());
    }

    #[test]
    fn parses_fullwidth_symbols() {
        // Full-width comma and exclamation mark and full-width dash
        let pages = parse_page_range_expression("1，3，5－7，！6", Some(10)).expect("valid");
        assert_eq!(pages, vec![1, 3, 5, 7]);
    }

    #[test]
    fn parses_reverse_indexing_l() {
        // L / L1 is last page (10), L2 is 9, L3 is 8
        let pages = parse_page_range_expression("1-L", Some(10)).expect("valid");
        assert_eq!(pages, (1..=10).collect::<Vec<_>>());

        let pages_l1 = parse_page_range_expression("1-L1", Some(10)).expect("valid");
        assert_eq!(pages_l1, (1..=10).collect::<Vec<_>>());

        let pages_l2 = parse_page_range_expression("1-L2", Some(10)).expect("valid");
        assert_eq!(pages_l2, (1..=9).collect::<Vec<_>>());

        let pages_last_three = parse_page_range_expression("L3-L", Some(10)).expect("valid");
        assert_eq!(pages_last_three, vec![8, 9, 10]);

        // Lowercase 'l'
        let pages_lower = parse_page_range_expression("l2-l", Some(10)).expect("valid");
        assert_eq!(pages_lower, vec![9, 10]);
    }

    #[test]
    fn parses_exclusion() {
        // Range with exclusion
        let pages = parse_page_range_expression("1-10, !3, !5-7, !L", Some(10)).expect("valid");
        assert_eq!(pages, vec![1, 2, 4, 8, 9]);

        // Only exclusions (implicit all pages)
        let pages_only_ex = parse_page_range_expression("!1, !L", Some(5)).expect("valid");
        assert_eq!(pages_only_ex, vec![2, 3, 4]);
    }

    #[test]
    fn rejects_invalid_cases() {
        // Inverted with L: L1 is 10, L3 is 8 -> 10-8 is inverted
        assert!(parse_page_range_expression("L1-L3", Some(10)).is_err());

        // L exceeds total pages
        assert!(parse_page_range_expression("L11", Some(10)).is_err());

        // Reverse indexing without total_pages
        assert!(parse_page_range_expression("1-L", None).is_err());
        assert!(parse_page_range_expression("!1", None).is_err());

        // All excluded
        assert!(parse_page_range_expression("1-3, !1-3", Some(10)).is_err());

        // Invalid syntax
        assert!(parse_page_range_expression("1,,3", Some(10)).is_err());
        assert!(parse_page_range_expression("! ", Some(10)).is_err());
    }
}
