//! Models: the catalog and resumable, checksum-verified downloads.

mod catalog;
pub mod download;

pub use catalog::{catalog, model_path, ModelEntry};
pub use download::{model_state, ModelState};
