use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, RwLock};
use std::time::{SystemTime, UNIX_EPOCH};

static PROFILE_COUNTER: AtomicU64 = AtomicU64::new(1);

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StoredPrinterProfile {
    pub printer_name: String,
    pub devmode: Vec<u8>,
}

#[derive(Clone, Default)]
pub struct PrinterProfileStore {
    profiles: Arc<RwLock<HashMap<String, StoredPrinterProfile>>>,
}

impl PrinterProfileStore {
    pub fn new() -> Self {
        Self {
            profiles: Arc::new(RwLock::new(HashMap::new())),
        }
    }

    /// Stores a DEVMODE buffer for a printer and returns a unique profileId.
    pub fn save_profile(&self, printer_name: &str, devmode: Vec<u8>) -> String {
        let counter = PROFILE_COUNTER.fetch_add(1, Ordering::Relaxed);
        let timestamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|duration| duration.as_millis())
            .unwrap_or(0);
        let profile_id = format!("prof-{timestamp:x}-{counter:x}");

        let stored = StoredPrinterProfile {
            printer_name: printer_name.to_string(),
            devmode,
        };

        if let Ok(mut lock) = self.profiles.write() {
            lock.insert(profile_id.clone(), stored);
        }

        profile_id
    }

    /// Retrieves the raw DEVMODE for a profileId, strictly checking that the printer name matches.
    pub fn get_profile(&self, profile_id: &str, printer_name: &str) -> Option<Vec<u8>> {
        let lock = self.profiles.read().ok()?;
        let stored = lock.get(profile_id)?;
        if stored.printer_name.eq_ignore_ascii_case(printer_name) {
            Some(stored.devmode.clone())
        } else {
            None
        }
    }

    /// Retrieves the stored profile metadata (printer_name + devmode) if profileId exists.
    pub fn get_stored_profile(&self, profile_id: &str) -> Option<StoredPrinterProfile> {
        let lock = self.profiles.read().ok()?;
        lock.get(profile_id).cloned()
    }

    /// Removes a profile by ID.
    pub fn remove_profile(&self, profile_id: &str) -> Option<StoredPrinterProfile> {
        let mut lock = self.profiles.write().ok()?;
        lock.remove(profile_id)
    }

    /// Cleans up profiles for printers that no longer exist in the system.
    pub fn prune_missing_printers(&self, valid_printer_names: &[String]) {
        if let Ok(mut lock) = self.profiles.write() {
            lock.retain(|_, stored| {
                valid_printer_names
                    .iter()
                    .any(|name| name.eq_ignore_ascii_case(&stored.printer_name))
            });
        }
    }

    /// Clears all stored profiles.
    pub fn clear(&self) {
        if let Ok(mut lock) = self.profiles.write() {
            lock.clear();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn saves_and_retrieves_profile_for_matching_printer() {
        let store = PrinterProfileStore::new();
        let dummy_devmode = vec![1, 2, 3, 4, 5];
        let profile_id = store.save_profile("Canon TS8300", dummy_devmode.clone());

        assert!(!profile_id.is_empty());
        let retrieved = store.get_profile(&profile_id, "Canon TS8300");
        assert_eq!(retrieved, Some(dummy_devmode.clone()));

        // Case-insensitive match on printer name
        let retrieved_case = store.get_profile(&profile_id, "canon ts8300");
        assert_eq!(retrieved_case, Some(dummy_devmode));
    }

    #[test]
    fn isolates_profiles_between_different_printers() {
        let store = PrinterProfileStore::new();
        let dummy_devmode = vec![10, 20, 30];
        let profile_id = store.save_profile("HP LaserJet Pro", dummy_devmode);

        // Mismatched printer name must be rejected to prevent cross-applying private DEVMODEs
        let wrong_printer = store.get_profile(&profile_id, "Epson L3150");
        assert_eq!(wrong_printer, None);
    }

    #[test]
    fn prunes_missing_printers() {
        let store = PrinterProfileStore::new();
        let id1 = store.save_profile("Printer A", vec![1]);
        let id2 = store.save_profile("Printer B", vec![2]);

        store.prune_missing_printers(&["Printer A".to_string()]);

        assert!(store.get_profile(&id1, "Printer A").is_some());
        assert!(store.get_profile(&id2, "Printer B").is_none());
    }
}
