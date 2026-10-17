use crate::protocol::{
    FileUploadRequest, FileUploadResponse, IllustrationRequest, ImageUploadRequest, ImageUploadResponse,
};
use anyhow::{bail, Result};
use base64::{engine::general_purpose::STANDARD, Engine as _};
use std::{
    fs,
    path::PathBuf,
    time::{SystemTime, UNIX_EPOCH},
};

const ASSET_ROOT_NAME: &str = "wps-codex-assets";

fn asset_root() -> PathBuf {
    std::env::temp_dir().join(ASSET_ROOT_NAME)
}

fn image_dir() -> PathBuf {
    asset_root().join("uploads")
}

fn file_dir() -> PathBuf {
    asset_root().join("files")
}

fn now_millis() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|value| value.as_millis())
        .unwrap_or(0)
}

pub fn escape_xml(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}

pub fn wrap_svg_text(text: &str, max_chars: usize) -> Vec<String> {
    let clean = text.split_whitespace().collect::<Vec<_>>().join(" ").trim().to_string();
    if clean.is_empty() {
        return Vec::new();
    }

    let chars: Vec<char> = clean.chars().collect();
    chars
        .chunks(max_chars.max(1))
        .take(4)
        .map(|chunk| chunk.iter().collect::<String>())
        .collect()
}

pub fn sanitize_file_name(value: &str) -> String {
    let filtered: String = value
        .chars()
        .map(|ch| match ch {
            '\\' | '/' | ':' | '*' | '?' | '"' | '<' | '>' | '|' => '_',
            c if c.is_control() => '_',
            other => other,
        })
        .collect();
    let trimmed = filtered.trim();
    if trimmed.is_empty() {
        "image.png".to_string()
    } else {
        trimmed.to_string()
    }
}

pub fn infer_image_ext(name: &str) -> &'static str {
    let lower = name.to_lowercase();
    if lower.ends_with(".png") {
        ".png"
    } else if lower.ends_with(".jpg") || lower.ends_with(".jpeg") {
        ".jpg"
    } else if lower.ends_with(".webp") {
        ".webp"
    } else if lower.ends_with(".gif") {
        ".gif"
    } else {
        ".png"
    }
}

pub fn create_illustration_file(request: &IllustrationRequest) -> Result<PathBuf> {
    fs::create_dir_all(asset_root())?;
    let title = request
        .title
        .as_deref()
        .unwrap_or("Codex 插图")
        .trim()
        .to_string();
    let source = if request.prompt.trim().is_empty() {
        title.clone()
    } else {
        request.prompt.trim().to_string()
    };
    let lines = wrap_svg_text(&source, 22);
    let file_path = asset_root().join(format!("codex-illustration-{}.svg", now_millis()));
    let text_spans = lines
        .iter()
        .enumerate()
        .map(|(index, line)| format!(
            "<text x=\"64\" y=\"{}\" class=\"body\">{}</text>",
            250 + index * 38,
            escape_xml(line)
        ))
        .collect::<Vec<_>>()
        .join("\n");

    let svg = format!(
        r##"<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="960" height="540" viewBox="0 0 960 540">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#eef7f4"/>
      <stop offset="1" stop-color="#d9e8ff"/>
    </linearGradient>
    <style>
      .title{{font:700 46px "Microsoft YaHei",Arial,sans-serif;fill:#152236}}
      .body{{font:400 28px "Microsoft YaHei",Arial,sans-serif;fill:#223246}}
      .label{{font:600 20px "Microsoft YaHei",Arial,sans-serif;fill:#0e8a6a}}
    </style>
  </defs>
  <rect width="960" height="540" rx="28" fill="url(#bg)"/>
  <circle cx="792" cy="124" r="88" fill="#0e8a6a" opacity=".14"/>
  <circle cx="842" cy="180" r="34" fill="#0e8a6a" opacity=".32"/>
  <path d="M72 382 C210 316, 302 430, 432 350 S690 318, 862 396" fill="none" stroke="#0e8a6a" stroke-width="14" stroke-linecap="round" opacity=".55"/>
  <rect x="48" y="48" width="864" height="444" rx="22" fill="white" opacity=".66"/>
  <text x="64" y="132" class="label">Codex for WPS Word</text>
  <text x="64" y="192" class="title">{}</text>
  {}
</svg>
"##,
        escape_xml(&title).chars().take(32).collect::<String>(),
        text_spans
    );

    fs::write(&file_path, svg)?;
    Ok(file_path)
}

pub fn save_uploaded_image(request: &ImageUploadRequest) -> Result<ImageUploadResponse> {
    let clean_name = sanitize_file_name(request.name.trim());
    let ext = infer_image_ext(&clean_name);
    let final_name = if clean_name.to_lowercase().ends_with(ext) {
        clean_name.clone()
    } else {
        format!("{clean_name}{ext}")
    };

    fs::create_dir_all(image_dir())?;
    let file_path = image_dir().join(format!("{}-{}", now_millis(), final_name));
    let buffer = STANDARD.decode(request.data_base64.trim())?;
    if buffer.is_empty() {
        bail!("图片数据为空。");
    }
    fs::write(&file_path, buffer)?;

    Ok(ImageUploadResponse {
        ok: true,
        path: file_path.to_string_lossy().to_string(),
        name: final_name,
        error: None,
    })
}

pub fn save_uploaded_file(request: &FileUploadRequest) -> Result<FileUploadResponse> {
    let clean_name = sanitize_file_name(if request.name.trim().is_empty() {
        "file"
    } else {
        request.name.trim()
    });
    fs::create_dir_all(file_dir())?;
    let file_path = file_dir().join(format!("{}-{}", now_millis(), clean_name));
    let buffer = STANDARD.decode(request.data_base64.trim())?;
    if buffer.is_empty() {
        bail!("文件数据为空。");
    }
    fs::write(&file_path, buffer)?;

    Ok(FileUploadResponse {
        ok: true,
        path: file_path.to_string_lossy().to_string(),
        name: clean_name,
        mime_type: request
            .mime_type
            .as_ref()
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty())
            .or_else(|| Some("application/octet-stream".to_string())),
        size: Some(fs::metadata(&file_path)?.len()),
        error: None,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sanitize_file_name_replaces_invalid_characters() {
        assert_eq!(sanitize_file_name(r#"a/b:c*d?e"f<g>h|i"#), "a_b_c_d_e_f_g_h_i");
    }

    #[test]
    fn infer_image_ext_supports_common_suffixes() {
        assert_eq!(infer_image_ext("a.png"), ".png");
        assert_eq!(infer_image_ext("a.jpeg"), ".jpg");
        assert_eq!(infer_image_ext("a.gif"), ".gif");
        assert_eq!(infer_image_ext("a.bin"), ".png");
    }

    #[test]
    fn wrap_svg_text_limits_line_count() {
        let lines = wrap_svg_text("这是一个很长很长的提示词，用来验证换行是否正确处理", 6);
        assert!(!lines.is_empty());
        assert!(lines.len() <= 4);
    }
}
