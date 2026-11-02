//! The brains this app knows: `profiles.json` in the app's config folder,
//! the same shape Electron writes (`{id, origin, name, version?, lastUsedAt?}`).
//! Config, never secrets: the bearers are in the OS keychain (vault.rs).

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::fence::{normalize_origin, saved_origin_ok};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Profile {
    pub id: String,
    pub origin: String,
    pub name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub version: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_used_at: Option<u64>,
}

/// The id is the shell's own: a UUID it minted. It names the brain's data
/// store, its folder and its keychain entries, so only the canonical
/// lower-case hyphenated form is accepted back.
pub fn valid_id(id: &str) -> bool {
    uuid::Uuid::parse_str(id).is_ok_and(|u| u.hyphenated().to_string() == id)
}

/// The window label of a brain, `brain-<uuid>`.
pub fn label_for(id: &str) -> String {
    format!("brain-{id}")
}

/// The profile id a window label names, if it is a brain window's label.
pub fn id_from_label(label: &str) -> Option<&str> {
    label.strip_prefix("brain-").filter(|id| valid_id(id))
}

pub fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

pub struct Profiles {
    path: PathBuf,
}

impl Profiles {
    pub fn new(config_dir: &Path) -> Self {
        Self {
            path: config_dir.join("profiles.json"),
        }
    }

    /// Every read checks each address again, not only when a brain is added:
    /// the origin goes into the window's CSP, and a file saved by an older
    /// build or edited by hand never passed today's check. A profile that
    /// fails (or is not a profile at all) is left out, and dropped from the
    /// file at the next save. So is a second profile with an id already
    /// seen: the id names a window, a data store and keychain entries, so it
    /// must name one brain; the first one listed is kept.
    pub fn load(&self) -> Vec<Profile> {
        let Ok(text) = std::fs::read_to_string(&self.path) else {
            return Vec::new();
        };
        let Ok(serde_json::Value::Array(items)) = serde_json::from_str(&text) else {
            return Vec::new();
        };
        let mut seen = std::collections::HashSet::new();
        items
            .into_iter()
            .filter_map(|item| serde_json::from_value::<Profile>(item).ok())
            .filter(|p| saved_origin_ok(&p.origin) && valid_id(&p.id))
            .filter(|p| seen.insert(p.id.clone()))
            .collect()
    }

    /// Written whole to a temporary file and renamed over the old one, so a
    /// crash mid-write never leaves half a list.
    pub fn save(&self, profiles: &[Profile]) -> Result<(), String> {
        if let Some(dir) = self.path.parent() {
            std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
        }
        let text = serde_json::to_string_pretty(profiles).map_err(|e| e.to_string())?;
        let tmp = self.path.with_extension("json.tmp");
        std::fs::write(&tmp, text).map_err(|e| e.to_string())?;
        std::fs::rename(&tmp, &self.path).map_err(|e| e.to_string())
    }

    pub fn find(&self, id: &str) -> Option<Profile> {
        self.load().into_iter().find(|p| p.id == id)
    }

    /// The brain to reopen at start: the one used last.
    pub fn last_used(&self) -> Option<Profile> {
        self.load()
            .into_iter()
            .filter(|p| p.last_used_at.is_some())
            .max_by_key(|p| p.last_used_at)
    }

    pub fn touch(&self, id: &str) -> Result<(), String> {
        let mut all = self.load();
        if let Some(p) = all.iter_mut().find(|p| p.id == id) {
            p.last_used_at = Some(now_ms());
        }
        self.save(&all)
    }

    /// Probe-before-save. A brain already in the list is refreshed, not
    /// doubled. `probe` answers the brain's version (net::probe_version).
    pub fn add(
        &self,
        raw_url: &str,
        probe: impl Fn(&str) -> Result<String, String>,
    ) -> Result<Profile, String> {
        if raw_url.len() > 2048 {
            return Err("That does not look like a valid URL.".into());
        }
        let origin = normalize_origin(raw_url)
            .map_err(|_| "That does not look like a valid URL.".to_string())?;
        let version =
            probe(&origin).map_err(|_| format!("Couldn't reach a MantleOS server at {origin}."))?;
        let mut all = self.load();
        if let Some(existing) = all.iter_mut().find(|p| p.origin == origin) {
            existing.version = Some(version);
            let profile = existing.clone();
            self.save(&all)?;
            return Ok(profile);
        }
        let host = url::Url::parse(&origin)
            .ok()
            .and_then(|u| u.host_str().map(str::to_string))
            .unwrap_or_else(|| origin.clone());
        let profile = Profile {
            id: uuid::Uuid::new_v4().hyphenated().to_string(),
            origin,
            name: host,
            version: Some(version),
            last_used_at: None,
        };
        all.push(profile.clone());
        self.save(&all)?;
        Ok(profile)
    }

    /// Only an id this app minted and still lists: the id names things to
    /// delete. Answers whether one was removed.
    pub fn remove(&self, id: &str) -> Result<bool, String> {
        let all = self.load();
        if !all.iter().any(|p| p.id == id) {
            return Ok(false);
        }
        let rest: Vec<Profile> = all.into_iter().filter(|p| p.id != id).collect();
        self.save(&rest)?;
        Ok(true)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "mantle-desktop-test-{name}-{}",
            uuid::Uuid::new_v4()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    const A: &str = "11111111-1111-4111-8111-111111111111";

    #[test]
    fn load_filters_what_fails_todays_checks() {
        let dir = temp_dir("profiles-load");
        std::fs::write(
            dir.join("profiles.json"),
            serde_json::json!([
                { "id": A, "origin": "https://brain.example", "name": "ok", "lastUsedAt": 5 },
                { "id": "22222222-2222-4222-8222-222222222222", "origin": "https://*.attacker.example", "name": "wild" },
                { "id": "33333333-3333-4333-8333-333333333333", "origin": "https://brain.example/", "name": "slash" },
                { "id": "44444444-4444-4444-8444-444444444444", "origin": 42, "name": "number" },
                { "id": "44444444-4444-4444-8444-444444444445", "name": "missing" },
                { "id": "../../evil", "origin": "https://b2.example", "name": "bad id" },
                { "id": "AAAAAAAA-1111-4111-8111-111111111111", "origin": "https://b3.example", "name": "upper id" },
                "not a profile"
            ])
            .to_string(),
        )
        .unwrap();
        let profiles = Profiles::new(&dir).load();
        assert_eq!(profiles.len(), 1);
        assert_eq!(profiles[0].name, "ok");
        assert_eq!(profiles[0].last_used_at, Some(5));
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn load_keeps_the_first_of_two_profiles_with_one_id() {
        let dir = temp_dir("profiles-dup");
        std::fs::write(
            dir.join("profiles.json"),
            serde_json::json!([
                { "id": A, "origin": "https://first.example", "name": "first" },
                { "id": A, "origin": "https://second.example", "name": "second" },
                { "id": "22222222-2222-4222-8222-222222222222", "origin": "https://b.example", "name": "b" }
            ])
            .to_string(),
        )
        .unwrap();
        let profiles = Profiles::new(&dir);
        let all = profiles.load();
        assert_eq!(all.len(), 2);
        assert_eq!(all[0].origin, "https://first.example");
        assert_eq!(profiles.find(A).unwrap().name, "first");
        // A save writes the list as loaded: the duplicate is gone for good.
        profiles.touch(A).unwrap();
        assert_eq!(profiles.load().len(), 2);
        let raw = std::fs::read_to_string(dir.join("profiles.json")).unwrap();
        assert!(!raw.contains("second.example"));
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn a_missing_or_broken_file_is_no_brains() {
        let dir = temp_dir("profiles-broken");
        assert!(Profiles::new(&dir).load().is_empty());
        std::fs::write(dir.join("profiles.json"), "{ not json").unwrap();
        assert!(Profiles::new(&dir).load().is_empty());
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn add_probes_then_saves_once_per_origin() {
        let dir = temp_dir("profiles-add");
        let profiles = Profiles::new(&dir);
        let first = profiles
            .add("brain.example/", |o| {
                assert_eq!(o, "https://brain.example");
                Ok("1.0".into())
            })
            .unwrap();
        assert!(valid_id(&first.id));
        assert_eq!(first.name, "brain.example");
        let again = profiles
            .add("https://brain.example", |_| Ok("1.1".into()))
            .unwrap();
        assert_eq!(again.id, first.id);
        assert_eq!(profiles.load().len(), 1);
        assert_eq!(profiles.load()[0].version.as_deref(), Some("1.1"));

        assert!(profiles.add("ftp://x.example", |_| Ok("1".into())).is_err());
        assert!(profiles
            .add("https://down.example", |_| Err("no".into()))
            .is_err());
        assert_eq!(profiles.load().len(), 1);
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn add_against_a_real_stub_brain() {
        let (brain, _) = crate::net::tests::stub(
            crate::net::tests::ok_json(r#"{"version":"0.400.73"}"#),
            std::time::Duration::ZERO,
        );
        let dir = temp_dir("profiles-stub");
        let profile = Profiles::new(&dir)
            .add(&brain, crate::net::probe_version)
            .unwrap();
        assert_eq!(profile.origin, brain);
        assert_eq!(profile.name, "127.0.0.1");
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn remove_only_a_listed_id_and_touch_marks_the_last_used() {
        let dir = temp_dir("profiles-remove");
        let profiles = Profiles::new(&dir);
        let a = profiles
            .add("https://a.example", |_| Ok("1".into()))
            .unwrap();
        let b = profiles
            .add("https://b.example", |_| Ok("1".into()))
            .unwrap();
        assert_eq!(profiles.last_used(), None);
        profiles.touch(&b.id).unwrap();
        assert_eq!(profiles.last_used().unwrap().id, b.id);
        assert!(!profiles.remove("not-an-id").unwrap());
        assert!(profiles.remove(&a.id).unwrap());
        assert_eq!(profiles.load().len(), 1);
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn labels_name_only_valid_ids() {
        assert_eq!(id_from_label(&label_for(A)), Some(A));
        assert_eq!(id_from_label("connect"), None);
        assert_eq!(id_from_label("brain-"), None);
        assert_eq!(id_from_label("brain-../x"), None);
        assert_eq!(
            id_from_label("brain-AAAAAAAA-1111-4111-8111-111111111111"),
            None
        );
        assert!(id_from_label("brain-aaaaaaaa-1111-4111-8111-111111111111").is_some());
    }
}
