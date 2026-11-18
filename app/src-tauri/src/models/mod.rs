//! The model catalog (models/catalog.json). Downloads arrive in Task 2.3.

use std::path::{Path, PathBuf};
use std::sync::OnceLock;

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelEntry {
    pub id: String,
    pub name: String,
    pub vendor: String,
    pub params_b: f64,
    pub quant: String,
    pub url: String,
    pub file: String,
    pub size_bytes: u64,
    pub sha256: String,
    /// Peak memory measured when this model runs on one device (MB).
    pub min_free_mb: u64,
}

pub fn catalog() -> &'static [ModelEntry] {
    static CATALOG: OnceLock<Vec<ModelEntry>> = OnceLock::new();
    CATALOG.get_or_init(|| serde_json::from_str(include_str!("catalog.json")).expect("catalog.json is valid"))
}

/// Where model `id` lives (or will live) inside `models_dir`.
pub fn model_path(models_dir: &Path, id: &str) -> Result<PathBuf, String> {
    catalog()
        .iter()
        .find(|m| m.id == id)
        .map(|m| models_dir.join(&m.file))
        .ok_or_else(|| format!("unknown model: {id}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn catalog_lists_the_three_models() {
        let ids: Vec<_> = catalog().iter().map(|m| m.id.clone()).collect();
        assert_eq!(ids, ["lfm3-1.7b", "qwen3.5-2b", "qwen3.5-0.8b"]);
        for m in catalog() {
            assert!(m.file.ends_with(".gguf") && m.sha256.len() == 64 && m.size_bytes > 0, "{m:?}");
        }
    }

    #[test]
    fn model_path_resolves_in_models_dir_and_rejects_unknown_ids() {
        let dir = std::path::Path::new("/models");
        assert_eq!(model_path(dir, "qwen3.5-0.8b").unwrap(), dir.join("Qwen3.5-0.8B-Q8_0.gguf"));
        assert!(model_path(dir, "nope").is_err());
    }
}
