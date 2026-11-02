//! The token vault: one bearer per login held for a brain, in the OS
//! keychain (macOS Keychain, the Secret Service on Linux), through
//! keyring-core.
//!
//!   keychain entry   service = the app identifier, user = `<profile>/<session>`
//!   index file       <app data>/vault/<profile>.json: the session ids held,
//!                    and when each was written. Not secret: it lets `load`
//!                    read its entries without searching the keychain.
//!
//! The profile id is the shell's own (resolved from the window that asks,
//! never taken from the page). The SESSION id comes from the page, so it is
//! checked against the same alphabet Electron uses before it is used.
//!
//! When the keychain cannot be used (no Secret Service, a refused keychain),
//! logins are kept in memory for this run only and the user is told once.
//! A token is never written to a file.

use std::collections::{BTreeMap, HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use keyring_core::{CredentialStore, Error as KeyError};
use serde::{Deserialize, Serialize};

/// What the page may name a session (Electron's vault.ts, the page's
/// desktop-vault.ts): no dot, no slash, nothing a path could be built from.
pub fn is_session_id(value: &str) -> bool {
    (1..=80).contains(&value.len())
        && value
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
}

/// A login written in the last two minutes may belong to a window mid-sign-in.
pub const RECENT_MS: u64 = 120_000;

/// Far bigger than a real bearer, small enough that a page cannot fill the
/// keychain with one call.
const MAX_TOKEN_BYTES: usize = 16 * 1024;

#[derive(Debug, Default, Serialize, Deserialize)]
struct Index {
    v: u32,
    /// session id -> when its entry was last written (ms since the epoch).
    sessions: BTreeMap<String, u64>,
}

struct Inner {
    /// None once the keychain failed (or was never there): memory only.
    store: Option<Arc<CredentialStore>>,
    /// Logins held for this run only: (profile, session) -> (token, written at).
    memory: HashMap<(String, String), (String, u64)>,
    /// Set when the keychain first fails; the shell tells the user once.
    told: bool,
}

pub struct Vault {
    service: String,
    dir: PathBuf,
    inner: Mutex<Inner>,
    /// Called once, the first time the keychain fails.
    on_unavailable: Box<dyn Fn() + Send + Sync>,
}

/// Whether an error says the keychain itself cannot be used, as against an
/// entry that is simply not there.
fn unavailable(e: &KeyError) -> bool {
    !matches!(e, KeyError::NoEntry)
}

impl Vault {
    pub fn new(
        service: &str,
        data_dir: &Path,
        store: Option<Arc<CredentialStore>>,
        on_unavailable: Box<dyn Fn() + Send + Sync>,
    ) -> Self {
        Self {
            service: service.to_string(),
            dir: data_dir.join("vault"),
            inner: Mutex::new(Inner {
                store,
                memory: HashMap::new(),
                told: false,
            }),
            on_unavailable,
        }
    }

    /// The platform's keychain store, or None when there is none to be had.
    pub fn platform_store() -> Option<Arc<CredentialStore>> {
        #[cfg(target_os = "macos")]
        {
            apple_native_keyring_store::keychain::Store::new()
                .ok()
                .map(|s| s as Arc<CredentialStore>)
        }
        #[cfg(target_os = "linux")]
        {
            zbus_secret_service_keyring_store::Store::new()
                .ok()
                .map(|s| s as Arc<CredentialStore>)
        }
        #[cfg(not(any(target_os = "macos", target_os = "linux")))]
        {
            None
        }
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, Inner> {
        self.inner.lock().unwrap_or_else(|e| e.into_inner())
    }

    /// Switch to memory for the rest of this run, and say so once.
    fn degrade(&self, inner: &mut Inner) {
        inner.store = None;
        if !inner.told {
            inner.told = true;
            (self.on_unavailable)();
        }
    }

    fn index_path(&self, profile: &str) -> PathBuf {
        self.dir.join(format!("{profile}.json"))
    }

    fn read_index(&self, profile: &str) -> Index {
        std::fs::read_to_string(self.index_path(profile))
            .ok()
            .and_then(|t| serde_json::from_str::<Index>(&t).ok())
            .map(|mut index| {
                index.sessions.retain(|id, _| is_session_id(id));
                index
            })
            .unwrap_or_default()
    }

    fn write_index(&self, profile: &str, index: &Index) {
        if index.sessions.is_empty() {
            let _ = std::fs::remove_file(self.index_path(profile));
            return;
        }
        let _ = std::fs::create_dir_all(&self.dir);
        let body = serde_json::to_string(&Index {
            v: 1,
            sessions: index.sessions.clone(),
        })
        .unwrap_or_default();
        let tmp = self.dir.join(format!("{profile}.json.tmp"));
        if std::fs::write(&tmp, body).is_ok() {
            let _ = std::fs::rename(&tmp, self.index_path(profile));
        }
    }

    fn user(profile: &str, session: &str) -> String {
        format!("{profile}/{session}")
    }

    /// Every login held for this brain: session id to bearer.
    pub fn load(&self, profile: &str) -> HashMap<String, String> {
        let mut inner = self.lock();
        let mut out = HashMap::new();
        let mut index = self.read_index(profile);
        if let Some(store) = inner.store.clone() {
            let mut gone = Vec::new();
            let mut failed = false;
            for session in index.sessions.keys() {
                let read = store
                    .build(&self.service, &Self::user(profile, session), None)
                    .and_then(|entry| entry.get_password());
                match read {
                    Ok(token) if !token.is_empty() => {
                        out.insert(session.clone(), token);
                    }
                    Ok(_) | Err(KeyError::NoEntry) => gone.push(session.clone()),
                    Err(_) => {
                        failed = true;
                        break;
                    }
                }
            }
            if failed {
                // A keychain that will not answer keeps its entries: the
                // index is left alone, and this run holds logins in memory.
                self.degrade(&mut inner);
            } else if !gone.is_empty() {
                for session in gone {
                    index.sessions.remove(&session);
                }
                self.write_index(profile, &index);
            }
        }
        for ((p, session), (token, _)) in &inner.memory {
            if p == profile {
                out.insert(session.clone(), token.clone());
            }
        }
        out
    }

    pub fn set_for(&self, profile: &str, session: &str, token: &str) -> Result<(), String> {
        if !is_session_id(session) || token.is_empty() || token.len() > MAX_TOKEN_BYTES {
            return Err("invalid login".into());
        }
        let mut inner = self.lock();
        let key = (profile.to_string(), session.to_string());
        let now = crate::profiles::now_ms();
        match inner.store.clone() {
            Some(store) => {
                let saved = store
                    .build(&self.service, &Self::user(profile, session), None)
                    .and_then(|entry| entry.set_password(token));
                match saved {
                    Ok(()) => {
                        inner.memory.remove(&key);
                        let mut index = self.read_index(profile);
                        index.sessions.insert(session.to_string(), now);
                        self.write_index(profile, &index);
                        return Ok(());
                    }
                    Err(e) if unavailable(&e) => self.degrade(&mut inner),
                    Err(_) => {}
                }
            }
            // No keychain since start: the first login kept is when to say so.
            None => self.degrade(&mut inner),
        }
        inner.memory.insert(key, (token.to_string(), now));
        Ok(())
    }

    pub fn clear_for(&self, profile: &str, session: &str) -> Result<(), String> {
        if !is_session_id(session) {
            return Err("invalid login".into());
        }
        let mut inner = self.lock();
        inner
            .memory
            .remove(&(profile.to_string(), session.to_string()));
        self.delete_entry(&mut inner, profile, session);
        let mut index = self.read_index(profile);
        if index.sessions.remove(session).is_some() {
            self.write_index(profile, &index);
        }
        Ok(())
    }

    fn delete_entry(&self, inner: &mut Inner, profile: &str, session: &str) {
        if let Some(store) = inner.store.clone() {
            let deleted = store
                .build(&self.service, &Self::user(profile, session), None)
                .and_then(|entry| entry.delete_credential());
            if let Err(e) = deleted {
                if unavailable(&e) {
                    self.degrade(inner);
                }
            }
        }
    }

    /// Drop this brain's leftover logins: those under an id the page's list
    /// does not name AND holding one of `stray_bearers`, the bearers the page
    /// still holds under the ids it keeps (so each one dropped is a copy). A
    /// login written in the last two minutes is left alone: another window
    /// of this brain may be listing it right now. Electron's rule exactly.
    pub fn keep_only(
        &self,
        profile: &str,
        session_ids: &[String],
        stray_bearers: &[String],
        now: u64,
    ) {
        let keep: HashSet<&str> = session_ids
            .iter()
            .map(String::as_str)
            .filter(|id| is_session_id(id))
            .collect();
        let stray: HashSet<&str> = stray_bearers
            .iter()
            .map(String::as_str)
            .filter(|b| !b.is_empty())
            .collect();
        if stray.is_empty() {
            return;
        }
        let mut inner = self.lock();

        let held: Vec<(String, String)> = inner
            .memory
            .iter()
            .filter(|((p, s), (token, at))| {
                p == profile
                    && !keep.contains(s.as_str())
                    && now.saturating_sub(*at) >= RECENT_MS
                    && stray.contains(token.as_str())
            })
            .map(|(k, _)| k.clone())
            .collect();
        for key in held {
            inner.memory.remove(&key);
        }

        let Some(store) = inner.store.clone() else {
            return;
        };
        let mut index = self.read_index(profile);
        let candidates: Vec<String> = index
            .sessions
            .iter()
            .filter(|(s, at)| !keep.contains(s.as_str()) && now.saturating_sub(**at) >= RECENT_MS)
            .map(|(s, _)| s.clone())
            .collect();
        let mut changed = false;
        for session in candidates {
            let Ok(entry) = store.build(&self.service, &Self::user(profile, &session), None) else {
                continue;
            };
            match entry.get_password() {
                Ok(token) if stray.contains(token.as_str()) => {
                    if entry.delete_credential().is_ok() {
                        index.sessions.remove(&session);
                        changed = true;
                    }
                }
                Err(KeyError::NoEntry) => {
                    index.sessions.remove(&session);
                    changed = true;
                }
                _ => {}
            }
        }
        if changed {
            self.write_index(profile, &index);
        }
    }

    /// A brain was removed from the app: none of its logins stay behind.
    pub fn remove_profile(&self, profile: &str) {
        let mut inner = self.lock();
        inner.memory.retain(|(p, _), _| p != profile);
        let index = self.read_index(profile);
        for session in index.sessions.keys() {
            self.delete_entry(&mut inner, profile, session);
        }
        let _ = std::fs::remove_file(self.index_path(profile));
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use keyring_core::api::CredentialStoreApi;
    use std::sync::atomic::{AtomicUsize, Ordering};

    const A: &str = "11111111-1111-4111-8111-111111111111";
    const B: &str = "22222222-2222-4222-8222-222222222222";
    const SERVICE: &str = "engineering.crossworks.mantleos-desktop";

    struct Fixture {
        dir: PathBuf,
        store: Arc<keyring_core::mock::Store>,
        told: Arc<AtomicUsize>,
    }

    impl Fixture {
        fn new() -> Self {
            let dir =
                std::env::temp_dir().join(format!("mantle-desktop-vault-{}", uuid::Uuid::new_v4()));
            std::fs::create_dir_all(&dir).unwrap();
            Self {
                dir,
                store: keyring_core::mock::Store::new().unwrap(),
                told: Arc::new(AtomicUsize::new(0)),
            }
        }

        fn vault(&self) -> Vault {
            self.vault_with(Some(self.store.clone() as Arc<CredentialStore>))
        }

        fn vault_with(&self, store: Option<Arc<CredentialStore>>) -> Vault {
            let told = self.told.clone();
            Vault::new(
                SERVICE,
                &self.dir,
                store,
                Box::new(move || {
                    told.fetch_add(1, Ordering::SeqCst);
                }),
            )
        }

        fn keychain(&self, profile: &str, session: &str) -> Option<String> {
            self.store
                .build(SERVICE, &format!("{profile}/{session}"), None)
                .unwrap()
                .get_password()
                .ok()
        }

        /// Every byte the vault wrote to disk, to show no token is in it.
        fn disk(&self) -> String {
            let mut all = String::new();
            if let Ok(entries) = std::fs::read_dir(self.dir.join("vault")) {
                for e in entries.flatten() {
                    all.push_str(&std::fs::read_to_string(e.path()).unwrap_or_default());
                }
            }
            all
        }
    }

    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.dir);
        }
    }

    #[test]
    fn round_trips_through_the_keychain_and_never_puts_a_token_on_disk() {
        let f = Fixture::new();
        let vault = f.vault();
        vault.set_for(A, "session-1", "bearer.one").unwrap();
        assert_eq!(f.keychain(A, "session-1").as_deref(), Some("bearer.one"));
        assert_eq!(
            vault.load(A).get("session-1").map(String::as_str),
            Some("bearer.one")
        );
        // A fresh vault (the next run) reads it back through the index.
        let next = f.vault();
        assert_eq!(next.load(A).len(), 1);
        assert!(f.disk().contains("session-1"));
        assert!(!f.disk().contains("bearer.one"));
    }

    #[test]
    fn keeps_the_logins_of_one_brain_apart_and_the_brains_apart() {
        let f = Fixture::new();
        let vault = f.vault();
        vault.set_for(A, "s1", "a.one").unwrap();
        vault.set_for(A, "s2", "a.two").unwrap();
        vault.set_for(B, "s1", "b.one").unwrap();
        vault.clear_for(A, "s1").unwrap();
        let a = vault.load(A);
        assert_eq!(a.len(), 1);
        assert_eq!(a["s2"], "a.two");
        assert_eq!(vault.load(B)["s1"], "b.one");
        assert_eq!(f.keychain(A, "s1"), None);
    }

    #[test]
    fn refuses_a_session_id_a_path_could_be_built_from() {
        let f = Fixture::new();
        let vault = f.vault();
        for bad in ["", "../x", "a/b", "a.b", "a b", &"x".repeat(81), "é"] {
            assert!(vault.set_for(A, bad, "t").is_err(), "{bad}");
            assert!(vault.clear_for(A, bad).is_err(), "{bad}");
        }
        assert!(vault.set_for(A, "ok_id-1", "").is_err());
        assert!(vault.set_for(A, "ok_id-1", &"t".repeat(17 * 1024)).is_err());
        assert!(vault.load(A).is_empty());
        assert!(is_session_id(&"x".repeat(80)));
    }

    #[test]
    fn keep_only_drops_only_old_copies_of_kept_bearers() {
        let f = Fixture::new();
        let vault = f.vault();
        vault.set_for(A, "kept", "bearer.k").unwrap();
        vault.set_for(A, "copy", "bearer.k").unwrap();
        vault.set_for(A, "other", "bearer.o").unwrap();
        vault.set_for(B, "copy", "bearer.k").unwrap();
        let now = crate::profiles::now_ms();

        // Too young: another window may be mid-sign-in.
        vault.keep_only(A, &["kept".into()], &["bearer.k".into()], now);
        assert_eq!(vault.load(A).len(), 3);

        // Nothing stray named: nothing goes.
        vault.keep_only(A, &["kept".into()], &[], now + RECENT_MS);
        assert_eq!(vault.load(A).len(), 3);

        vault.keep_only(
            A,
            &["kept".into(), "../x".into()],
            &["bearer.k".into(), "".into()],
            now + RECENT_MS,
        );
        let a = vault.load(A);
        assert_eq!(a.len(), 2);
        assert!(a.contains_key("kept") && a.contains_key("other"));
        // Another brain's copy is not this brain's to drop.
        assert_eq!(vault.load(B).len(), 1);
    }

    #[test]
    fn remove_profile_leaves_nothing_of_that_brain() {
        let f = Fixture::new();
        let vault = f.vault();
        vault.set_for(A, "s1", "a.one").unwrap();
        vault.set_for(A, "s2", "a.two").unwrap();
        vault.set_for(B, "s1", "b.one").unwrap();
        vault.remove_profile(A);
        assert!(vault.load(A).is_empty());
        assert_eq!(f.keychain(A, "s1"), None);
        assert_eq!(f.keychain(A, "s2"), None);
        assert!(!f.dir.join("vault").join(format!("{A}.json")).exists());
        assert_eq!(vault.load(B).len(), 1);
    }

    #[test]
    fn an_entry_gone_from_the_keychain_leaves_the_index() {
        let f = Fixture::new();
        let vault = f.vault();
        vault.set_for(A, "s1", "a.one").unwrap();
        f.store
            .build(SERVICE, &format!("{A}/s1"), None)
            .unwrap()
            .delete_credential()
            .unwrap();
        assert!(vault.load(A).is_empty());
        assert!(!f.disk().contains("s1"));
    }

    /// A store that refuses everything, like a missing Secret Service.
    struct NoKeychain;

    impl keyring_core::api::CredentialStoreApi for NoKeychain {
        fn vendor(&self) -> String {
            "none".into()
        }
        fn id(&self) -> String {
            "none".into()
        }
        fn build(
            &self,
            _: &str,
            _: &str,
            _: Option<&HashMap<&str, &str>>,
        ) -> keyring_core::Result<keyring_core::Entry> {
            Err(KeyError::NoStorageAccess("no Secret Service".into()))
        }
        fn as_any(&self) -> &dyn std::any::Any {
            self
        }
    }

    #[test]
    fn without_a_keychain_logins_live_in_memory_and_the_user_is_told_once() {
        let f = Fixture::new();
        let vault = f.vault_with(Some(Arc::new(NoKeychain) as Arc<CredentialStore>));
        vault.set_for(A, "s1", "a.one").unwrap();
        vault.set_for(A, "s2", "a.two").unwrap();
        assert_eq!(vault.load(A).len(), 2);
        assert_eq!(f.told.load(Ordering::SeqCst), 1);
        vault.clear_for(A, "s1").unwrap();
        assert_eq!(vault.load(A).len(), 1);
        assert_eq!(f.disk(), "");
        // The next run starts empty: nothing was written anywhere.
        assert!(f.vault_with(None).load(A).is_empty());
    }

    #[test]
    fn a_keychain_that_fails_mid_run_keeps_the_login_in_memory() {
        let f = Fixture::new();
        let vault = f.vault();
        vault.set_for(A, "s1", "a.one").unwrap();
        let entry = f.store.build(SERVICE, &format!("{A}/s2"), None).unwrap();
        let mock: &keyring_core::mock::Cred = entry.as_any().downcast_ref().unwrap();
        mock.set_error(KeyError::PlatformFailure("locked".into()));
        vault.set_for(A, "s2", "a.two").unwrap();
        assert_eq!(f.told.load(Ordering::SeqCst), 1);
        let held = vault.load(A);
        assert_eq!(held.get("s2").map(String::as_str), Some("a.two"));
        assert!(!f.disk().contains("a.two"));
    }

    #[test]
    fn no_store_at_all_is_memory_from_the_start() {
        let f = Fixture::new();
        let vault = f.vault_with(None);
        assert!(vault.load(A).is_empty());
        assert_eq!(f.told.load(Ordering::SeqCst), 0);
        vault.set_for(A, "s1", "a.one").unwrap();
        vault.set_for(A, "s2", "a.two").unwrap();
        assert_eq!(vault.load(A)["s1"], "a.one");
        assert_eq!(f.told.load(Ordering::SeqCst), 1);
        assert_eq!(f.disk(), "");
    }
}
