//! The token vault: the bearers a brain window holds, in the OS keychain
//! (macOS Keychain, the Secret Service on Linux), through keyring-core.
//! The same shape and rules as Electron's vault (client/desktop/src/main/
//! vault.ts), with the keychain where Electron has its files:
//!
//!   keychain entry   service = the app identifier
//!                    user    = `<profile>`             the one unscoped slot
//!                    user    = `<profile>/<session>`   one bearer per login
//!   index file       <app data>/vault/<profile>.json: the session ids held,
//!                    and when each was written. Not secret: it is what
//!                    `keep_only` and `remove_profile` walk, and what stands
//!                    in for Electron's file times (the two-minute grace).
//!
//! The keychain is the ONLY copy of a bearer. Nothing is kept in memory:
//! every read asks the keychain, so what the page gets is what is stored.
//! A write the keychain refuses is simply not stored (as in Electron), and
//! the next read tells the truth. The first time the keychain fails in a
//! run, the shell is told once, AFTER the vault's lock is released: the
//! callback may show UI, and nothing that shows UI runs under the lock.
//!
//! The profile id is the shell's own (from the window that asks, never from
//! the page). The SESSION id comes from the page, so it is checked against
//! Electron's alphabet before it is used.
//!
//! One lock per process serializes every call: index reads and writes, and
//! the keychain calls between them. Callers run off the main thread.

use std::collections::{BTreeMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use keyring_core::{CredentialStore, Error as KeyError};
use serde::{Deserialize, Serialize};

/// What the page may name a session (Electron's vault.ts): no dot, no
/// slash, nothing a path could be built from.
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
pub const MAX_TOKEN_BYTES: usize = 16 * 1024;

#[derive(Debug, Default, Serialize, Deserialize)]
struct Index {
    v: u32,
    /// session id -> when its entry was last written (ms since the epoch).
    sessions: BTreeMap<String, u64>,
}

/// What went wrong during one call, reported once the lock is released.
#[derive(Default)]
struct Failures(Vec<String>);

impl Failures {
    fn note(&mut self, what: &str, error: &KeyError) {
        // The error's text names the store's own failure, never a secret.
        self.0.push(format!("{what}: {error}"));
    }
}

pub struct Vault {
    service: String,
    dir: PathBuf,
    /// None when the platform has no keychain this app can use.
    store: Option<Arc<CredentialStore>>,
    lock: Mutex<()>,
    /// Set once the user has been told the keychain is not usable.
    told: AtomicBool,
    /// Called once per run, the first time the keychain fails (or at start
    /// when there is none). Never called with the lock held.
    on_unavailable: Box<dyn Fn() + Send + Sync>,
    /// A line per failure on stderr, never a token (MANTLE_DESKTOP_TRACE).
    trace: bool,
}

impl Vault {
    pub fn new(
        service: &str,
        data_dir: &Path,
        store: Option<Arc<CredentialStore>>,
        on_unavailable: Box<dyn Fn() + Send + Sync>,
        trace: bool,
    ) -> Self {
        Self {
            service: service.to_string(),
            dir: data_dir.join("vault"),
            store,
            lock: Mutex::new(()),
            told: AtomicBool::new(false),
            on_unavailable,
            trace,
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

    /// Whether there is a keychain at all. Without one nothing is stored,
    /// and the shell says so at start.
    pub fn has_store(&self) -> bool {
        self.store.is_some()
    }

    /// Tell the user, once per run, that logins cannot be kept.
    pub fn tell_unavailable(&self) {
        if !self.told.swap(true, Ordering::SeqCst) {
            (self.on_unavailable)();
        }
    }

    /// Runs one call under the lock, then (lock released) reports what failed.
    fn with_lock<T>(&self, call: impl FnOnce(&mut Failures) -> T) -> T {
        let mut failures = Failures::default();
        let out = {
            let _guard = self.lock.lock().unwrap_or_else(|e| e.into_inner());
            call(&mut failures)
        };
        if !failures.0.is_empty() {
            if self.trace {
                for line in &failures.0 {
                    eprintln!("[mantle-desktop] vault: {line}");
                }
            }
            self.tell_unavailable();
        }
        out
    }

    fn slot(profile: &str) -> String {
        profile.to_string()
    }

    fn login(profile: &str, session: &str) -> String {
        format!("{profile}/{session}")
    }

    /// The bearer under `user`: Some, None when there is none, or None with
    /// a failure noted when the keychain would not answer.
    fn read(&self, user: &str, failures: &mut Failures) -> Result<Option<String>, ()> {
        let Some(store) = &self.store else {
            return Ok(None);
        };
        match store
            .build(&self.service, user, None)
            .and_then(|e| e.get_password())
        {
            Ok(token) if !token.is_empty() => Ok(Some(token)),
            Ok(_) | Err(KeyError::NoEntry) => Ok(None),
            Err(e) => {
                failures.note("read", &e);
                Err(())
            }
        }
    }

    fn write(&self, user: &str, token: &str, failures: &mut Failures) -> bool {
        let Some(store) = &self.store else {
            return false;
        };
        match store
            .build(&self.service, user, None)
            .and_then(|e| e.set_password(token))
        {
            Ok(()) => true,
            Err(e) => {
                failures.note("write", &e);
                false
            }
        }
    }

    /// Whether the entry is gone afterwards (deleted, or never there).
    fn delete(&self, user: &str, failures: &mut Failures) -> bool {
        let Some(store) = &self.store else {
            return true;
        };
        match store
            .build(&self.service, user, None)
            .and_then(|e| e.delete_credential())
        {
            Ok(()) | Err(KeyError::NoEntry) => true,
            Err(e) => {
                failures.note("delete", &e);
                false
            }
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

    fn index_add(&self, profile: &str, session: &str, now: u64) {
        let mut index = self.read_index(profile);
        index.sessions.insert(session.to_string(), now);
        self.write_index(profile, &index);
    }

    fn index_remove(&self, profile: &str, session: &str) {
        let mut index = self.read_index(profile);
        if index.sessions.remove(session).is_some() {
            self.write_index(profile, &index);
        }
    }

    fn token_ok(token: &str) -> bool {
        !token.is_empty() && token.len() <= MAX_TOKEN_BYTES
    }

    // ── the unscoped slot: what an earlier build kept, one per brain ───────

    pub fn get(&self, profile: &str) -> Option<String> {
        self.with_lock(|f| self.read(&Self::slot(profile), f).ok().flatten())
    }

    pub fn set(&self, profile: &str, token: &str) {
        if !Self::token_ok(token) {
            return;
        }
        self.with_lock(|f| {
            self.write(&Self::slot(profile), token, f);
        });
    }

    pub fn clear(&self, profile: &str) {
        self.with_lock(|f| {
            self.delete(&Self::slot(profile), f);
        });
    }

    // ── one bearer per login ────────────────────────────────────────────────

    pub fn get_for(&self, profile: &str, session: &str) -> Option<String> {
        if !is_session_id(session) {
            return None;
        }
        self.with_lock(|f| self.read(&Self::login(profile, session), f).ok().flatten())
    }

    pub fn set_for(&self, profile: &str, session: &str, token: &str, now: u64) {
        if !is_session_id(session) || !Self::token_ok(token) || self.store.is_none() {
            return;
        }
        self.with_lock(|f| {
            // The index first: an entry the index names but the keychain
            // lacks is harmless (it is dropped when found missing), while an
            // entry the index does not name could outlive its brain.
            self.index_add(profile, session, now);
            self.write(&Self::login(profile, session), token, f);
        });
    }

    pub fn clear_for(&self, profile: &str, session: &str) {
        if !is_session_id(session) {
            return;
        }
        self.with_lock(|f| {
            if self.delete(&Self::login(profile, session), f) {
                self.index_remove(profile, session);
            }
        });
    }

    /// Give the unscoped bearer to a login that has none, and answer with
    /// it: a move, as Electron's rename is. A login that already has a
    /// bearer of its own keeps it and the slot is left alone. When the slot
    /// cannot be emptied the copy is taken back, so the bearer is never left
    /// in both places by this call.
    pub fn adopt(&self, profile: &str, session: &str, now: u64) -> Option<String> {
        if !is_session_id(session) {
            return None;
        }
        let target = Self::login(profile, session);
        let slot = Self::slot(profile);
        self.with_lock(|f| {
            match self.read(&target, f) {
                Ok(Some(own)) => return Some(own),
                Ok(None) => {}
                Err(()) => return None,
            }
            let token = self.read(&slot, f).ok().flatten()?;
            self.index_add(profile, session, now);
            if !self.write(&target, &token, f) {
                self.index_remove(profile, session);
                return None;
            }
            if !self.delete(&slot, f) {
                if self.delete(&target, f) {
                    self.index_remove(profile, session);
                }
                return None;
            }
            Some(token)
        })
    }

    /// Drop this brain's leftover logins: those under an id the page's list
    /// does not name AND holding one of `stray_bearers`, the bearers the page
    /// still holds under the ids it keeps (so each one dropped is a copy). A
    /// login written in the last two minutes is left alone: another window
    /// of this brain may be listing it right now. Ids that are not session
    /// ids are ignored, and the unscoped slot is not a login. Electron's rule.
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
        if stray.is_empty() || self.store.is_none() {
            return;
        }
        self.with_lock(|f| {
            let mut index = self.read_index(profile);
            let candidates: Vec<String> = index
                .sessions
                .iter()
                .filter(|(s, at)| {
                    !keep.contains(s.as_str()) && now.saturating_sub(**at) >= RECENT_MS
                })
                .map(|(s, _)| s.clone())
                .collect();
            let mut changed = false;
            for session in candidates {
                let user = Self::login(profile, &session);
                let gone = match self.read(&user, f) {
                    Ok(Some(token)) if stray.contains(token.as_str()) => self.delete(&user, f),
                    Ok(None) => true,
                    _ => false,
                };
                if gone {
                    index.sessions.remove(&session);
                    changed = true;
                }
            }
            if changed {
                self.write_index(profile, &index);
            }
        });
    }

    /// A brain was removed from the app: none of its logins stay behind.
    pub fn remove_profile(&self, profile: &str) {
        self.with_lock(|f| {
            self.delete(&Self::slot(profile), f);
            let mut index = self.read_index(profile);
            let held: Vec<String> = index.sessions.keys().cloned().collect();
            for session in held {
                if self.delete(&Self::login(profile, &session), f) {
                    index.sessions.remove(&session);
                }
            }
            // What could not be deleted stays listed, for a later removal.
            self.write_index(profile, &index);
        });
    }
}

#[cfg(test)]
mod tests {
    //! Electron's vault.test.ts, case for case where the keychain allows,
    //! on keyring-core's mock store; plus what the keychain adds: a write it
    //! refuses is not stored, the user is told once, and never under the lock.

    use super::*;
    use keyring_core::api::{CredentialApi, CredentialStoreApi};
    use keyring_core::{Credential, Entry};
    use std::sync::atomic::AtomicUsize;

    const A: &str = "11111111-1111-4111-8111-111111111111";
    const B: &str = "22222222-2222-4222-8222-222222222222";
    const SERVICE: &str = "engineering.crossworks.mantleos-desktop";
    const LATER: u64 = 10 * 60_000;

    /// What the mock store is told to refuse, for as long as it is set.
    #[derive(Default)]
    struct Refuse {
        all: AtomicBool,
        writes: AtomicBool,
        deletes_of: Mutex<Option<String>>,
    }

    /// keyring-core's mock store, with failures that last until cleared
    /// (the mock's own `set_error` is one-shot).
    struct Flaky {
        inner: Arc<keyring_core::mock::Store>,
        refuse: Arc<Refuse>,
    }

    struct FlakyCred {
        inner: Entry,
        user: String,
        refuse: Arc<Refuse>,
    }

    fn locked() -> KeyError {
        KeyError::PlatformFailure("locked".into())
    }

    impl CredentialApi for FlakyCred {
        fn set_secret(&self, secret: &[u8]) -> keyring_core::Result<()> {
            if self.refuse.all.load(Ordering::SeqCst) || self.refuse.writes.load(Ordering::SeqCst) {
                return Err(locked());
            }
            self.inner.set_secret(secret)
        }
        fn get_secret(&self) -> keyring_core::Result<Vec<u8>> {
            if self.refuse.all.load(Ordering::SeqCst) {
                return Err(locked());
            }
            self.inner.get_secret()
        }
        fn delete_credential(&self) -> keyring_core::Result<()> {
            let refused = self.refuse.all.load(Ordering::SeqCst)
                || self.refuse.deletes_of.lock().unwrap().as_deref() == Some(self.user.as_str());
            if refused {
                return Err(locked());
            }
            self.inner.delete_credential()
        }
        fn get_credential(&self) -> keyring_core::Result<Option<Arc<Credential>>> {
            Ok(None)
        }
        fn get_specifiers(&self) -> Option<(String, String)> {
            None
        }
        fn as_any(&self) -> &dyn std::any::Any {
            self
        }
    }

    impl CredentialStoreApi for Flaky {
        fn vendor(&self) -> String {
            "flaky".into()
        }
        fn id(&self) -> String {
            "flaky".into()
        }
        fn build(
            &self,
            service: &str,
            user: &str,
            _: Option<&std::collections::HashMap<&str, &str>>,
        ) -> keyring_core::Result<Entry> {
            let inner = self.inner.build(service, user, None)?;
            Ok(Entry::new_with_credential(Arc::new(FlakyCred {
                inner,
                user: user.to_string(),
                refuse: self.refuse.clone(),
            })))
        }
        fn as_any(&self) -> &dyn std::any::Any {
            self
        }
    }

    struct Fixture {
        dir: PathBuf,
        store: Arc<keyring_core::mock::Store>,
        refuse: Arc<Refuse>,
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
                refuse: Arc::new(Refuse::default()),
                told: Arc::new(AtomicUsize::new(0)),
            }
        }

        fn vault(&self) -> Vault {
            let store = Arc::new(Flaky {
                inner: self.store.clone(),
                refuse: self.refuse.clone(),
            });
            self.vault_with(Some(store as Arc<CredentialStore>))
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
                false,
            )
        }

        fn keychain(&self, user: &str) -> Option<String> {
            self.store
                .build(SERVICE, user, None)
                .unwrap()
                .get_password()
                .ok()
        }

        fn told(&self) -> usize {
            self.told.load(Ordering::SeqCst)
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

        fn indexed(&self, profile: &str) -> Vec<String> {
            std::fs::read_to_string(self.dir.join("vault").join(format!("{profile}.json")))
                .ok()
                .and_then(|t| serde_json::from_str::<Index>(&t).ok())
                .map(|i| i.sessions.into_keys().collect())
                .unwrap_or_default()
        }
    }

    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.dir);
        }
    }

    fn now() -> u64 {
        crate::profiles::now_ms()
    }

    // ── one bearer per login ────────────────────────────────────────────────

    #[test]
    fn round_trips_through_the_keychain_and_never_puts_a_token_on_disk() {
        let f = Fixture::new();
        let vault = f.vault();
        vault.set_for(A, "session-1", "bearer.one", now());
        assert_eq!(
            f.keychain(&format!("{A}/session-1")).as_deref(),
            Some("bearer.one")
        );
        assert_eq!(vault.get_for(A, "session-1").as_deref(), Some("bearer.one"));
        // A fresh vault (the next run) reads the same keychain.
        assert_eq!(
            f.vault().get_for(A, "session-1").as_deref(),
            Some("bearer.one")
        );
        assert!(f.disk().contains("session-1"));
        assert!(!f.disk().contains("bearer.one"));
    }

    #[test]
    fn keeps_the_logins_of_one_brain_apart_and_the_brains_apart() {
        let f = Fixture::new();
        let vault = f.vault();
        vault.set_for(A, "s1", "a.one", now());
        vault.set_for(A, "s2", "a.two", now());
        vault.set_for(B, "s1", "b.one", now());
        assert_eq!(vault.get_for(A, "s1").as_deref(), Some("a.one"));
        assert_eq!(vault.get_for(A, "s2").as_deref(), Some("a.two"));
        assert_eq!(vault.get_for(B, "s1").as_deref(), Some("b.one"));

        vault.clear_for(A, "s1");
        assert_eq!(vault.get_for(A, "s1"), None);
        assert_eq!(vault.get_for(A, "s2").as_deref(), Some("a.two"));
        assert_eq!(vault.get_for(B, "s1").as_deref(), Some("b.one"));
        assert_eq!(f.indexed(A), vec!["s2".to_string()]);
    }

    #[test]
    fn a_session_id_is_the_pages_so_it_is_not_trusted() {
        let f = Fixture::new();
        let vault = f.vault();
        vault.set_for(B, "s1", "b.one", now());
        let long = "x".repeat(81);
        let hostile = [
            "../other-brain/s1",
            "..",
            ".",
            "a/b",
            "a\\b",
            "with.dot",
            "",
            long.as_str(),
            "nul\0byte",
            "é",
        ];
        assert!(is_session_id("3f0e8a52-6f0b-4b5e-9d5e-2f0f6f1f7a10"));
        assert!(is_session_id("sl9x2k4abcd"));
        assert!(is_session_id(&"x".repeat(80)));
        for id in hostile {
            assert!(!is_session_id(id), "{id:?}");
            vault.set_for(A, id, "x", now());
            assert_eq!(vault.get_for(A, id), None, "{id:?}");
            assert_eq!(vault.adopt(A, id, now()), None, "{id:?}");
            vault.clear_for(A, id);
        }
        // The neighbour a traversal was aiming at is untouched, and nothing
        // at all was created for this brain.
        assert_eq!(vault.get_for(B, "s1").as_deref(), Some("b.one"));
        assert!(f.indexed(A).is_empty());
        assert_eq!(f.keychain(&format!("{A}/..")), None);
    }

    #[test]
    fn refuses_an_empty_or_oversized_bearer() {
        let f = Fixture::new();
        let vault = f.vault();
        vault.set_for(A, "s1", "", now());
        vault.set_for(A, "s1", &"t".repeat(MAX_TOKEN_BYTES + 1), now());
        vault.set(A, "");
        assert_eq!(vault.get_for(A, "s1"), None);
        assert_eq!(vault.get(A), None);
        assert!(f.indexed(A).is_empty());
    }

    // ── the update from one slot per brain ──────────────────────────────────

    #[test]
    fn adopts_the_unscoped_bearer_into_a_login_and_the_slot_is_emptied() {
        let f = Fixture::new();
        let vault = f.vault();
        vault.set(A, "legacy.bearer");
        assert_eq!(f.keychain(A).as_deref(), Some("legacy.bearer"));

        assert_eq!(
            vault.adopt(A, "s1", now()).as_deref(),
            Some("legacy.bearer")
        );
        assert_eq!(vault.get_for(A, "s1").as_deref(), Some("legacy.bearer"));
        assert_eq!(vault.get(A), None);
        assert_eq!(f.keychain(A), None);
        assert_eq!(f.indexed(A), vec!["s1".to_string()]);
    }

    #[test]
    fn never_overwrites_a_login_that_already_has_a_bearer_of_its_own() {
        let f = Fixture::new();
        let vault = f.vault();
        vault.set_for(A, "s1", "own.bearer", now());
        vault.set(A, "legacy.bearer");
        assert_eq!(vault.adopt(A, "s1", now()).as_deref(), Some("own.bearer"));
        assert_eq!(vault.get(A).as_deref(), Some("legacy.bearer"));
    }

    #[test]
    fn adopts_once_a_second_login_finds_nothing() {
        let f = Fixture::new();
        let vault = f.vault();
        vault.set(A, "legacy.bearer");
        vault.adopt(A, "s1", now());
        assert_eq!(vault.adopt(A, "s2", now()), None);
        assert_eq!(f.indexed(A), vec!["s1".to_string()]);
    }

    #[test]
    fn with_nothing_to_adopt_answers_none_and_creates_nothing() {
        let f = Fixture::new();
        let vault = f.vault();
        assert_eq!(vault.adopt(A, "s1", now()), None);
        assert!(!f.dir.join("vault").exists());
        assert_eq!(f.keychain(&format!("{A}/s1")), None);
    }

    #[test]
    fn an_adopt_that_cannot_empty_the_slot_takes_its_copy_back() {
        let f = Fixture::new();
        let vault = f.vault();
        vault.set(A, "legacy.bearer");
        *f.refuse.deletes_of.lock().unwrap() = Some(A.to_string());
        assert_eq!(vault.adopt(A, "s1", now()), None);
        // One place only: still the slot, not the login.
        assert_eq!(f.keychain(A).as_deref(), Some("legacy.bearer"));
        assert_eq!(f.keychain(&format!("{A}/s1")), None);
        assert!(f.indexed(A).is_empty());
        assert_eq!(f.told(), 1);
        // Once the keychain lets go, the next try moves it.
        *f.refuse.deletes_of.lock().unwrap() = None;
        assert_eq!(
            vault.adopt(A, "s1", now()).as_deref(),
            Some("legacy.bearer")
        );
        assert_eq!(f.keychain(A), None);
    }

    #[test]
    fn the_unscoped_slot_round_trips_and_clears() {
        let f = Fixture::new();
        let vault = f.vault();
        vault.set(A, "legacy.bearer");
        assert_eq!(vault.get(A).as_deref(), Some("legacy.bearer"));
        assert_eq!(vault.get(B), None);
        vault.clear(A);
        assert_eq!(vault.get(A), None);
        assert!(!f.disk().contains("legacy"));
    }

    // ── removing a brain ────────────────────────────────────────────────────

    #[test]
    fn remove_profile_leaves_nothing_of_that_brain_and_every_other_alone() {
        let f = Fixture::new();
        let vault = f.vault();
        vault.set(A, "legacy");
        vault.set_for(A, "s1", "a.one", now());
        vault.set_for(A, "s2", "a.two", now());
        vault.set_for(B, "s1", "b.one", now());
        vault.remove_profile(A);
        assert_eq!(f.keychain(A), None);
        assert_eq!(f.keychain(&format!("{A}/s1")), None);
        assert_eq!(f.keychain(&format!("{A}/s2")), None);
        assert!(!f.dir.join("vault").join(format!("{A}.json")).exists());
        assert_eq!(vault.get_for(B, "s1").as_deref(), Some("b.one"));
    }

    // ── leftover logins ─────────────────────────────────────────────────────

    #[test]
    fn keep_only_drops_copies_the_page_no_longer_names_and_nothing_else() {
        let f = Fixture::new();
        let vault = f.vault();
        let t = now();
        vault.set(A, "legacy");
        vault.set_for(A, "keep", "a.keep", t);
        vault.set_for(A, "copy1", "a.keep", t);
        vault.set_for(A, "copy2", "a.keep", t);
        vault.set_for(B, "copy1", "a.keep", t);

        vault.keep_only(
            A,
            &["keep".into(), "../escape".into()],
            &["a.keep".into(), "".into()],
            t + LATER,
        );

        assert_eq!(f.indexed(A), vec!["keep".to_string()]);
        assert_eq!(vault.get_for(A, "keep").as_deref(), Some("a.keep"));
        assert_eq!(vault.get_for(A, "copy1"), None);
        assert_eq!(vault.get_for(A, "copy2"), None);
        // The slot and the other brain are not this call's.
        assert_eq!(vault.get(A).as_deref(), Some("legacy"));
        assert_eq!(vault.get_for(B, "copy1").as_deref(), Some("a.keep"));
    }

    #[test]
    fn keep_only_keeps_another_windows_new_login() {
        let f = Fixture::new();
        let vault = f.vault();
        let t = now();
        vault.set_for(A, "keep", "a.keep", t);
        vault.set_for(A, "other-window", "brand.new", t);
        vault.keep_only(A, &["keep".into()], &["a.keep".into()], t + LATER);
        assert_eq!(
            vault.get_for(A, "other-window").as_deref(),
            Some("brand.new")
        );
    }

    #[test]
    fn keep_only_keeps_a_copy_written_in_the_last_two_minutes() {
        let f = Fixture::new();
        let vault = f.vault();
        let t = now();
        vault.set_for(A, "keep", "a.keep", t);
        vault.set_for(A, "just-now", "a.keep", t);
        vault.keep_only(A, &["keep".into()], &["a.keep".into()], t + 60_000);
        assert_eq!(vault.get_for(A, "just-now").as_deref(), Some("a.keep"));
        vault.keep_only(A, &["keep".into()], &["a.keep".into()], t + LATER);
        assert_eq!(vault.get_for(A, "just-now"), None);
    }

    #[test]
    fn keep_only_with_no_bearers_or_no_index_does_nothing() {
        let f = Fixture::new();
        let vault = f.vault();
        let t = now();
        vault.set_for(A, "s1", "a.one", t);
        vault.keep_only(A, &[], &[], t + LATER);
        vault.keep_only(A, &[], &["".into()], t + LATER);
        assert_eq!(vault.get_for(A, "s1").as_deref(), Some("a.one"));
        vault.keep_only(B, &[], &["x".into()], t + LATER);
    }

    #[test]
    fn an_entry_gone_from_the_keychain_leaves_the_index() {
        let f = Fixture::new();
        let vault = f.vault();
        let t = now();
        vault.set_for(A, "s1", "a.one", t);
        f.store
            .build(SERVICE, &format!("{A}/s1"), None)
            .unwrap()
            .delete_credential()
            .unwrap();
        assert_eq!(vault.get_for(A, "s1"), None);
        vault.keep_only(A, &[], &["x".into()], t + LATER);
        assert!(f.indexed(A).is_empty());
    }

    // ── when the keychain says no ───────────────────────────────────────────

    #[test]
    fn a_refused_write_is_not_stored_and_the_next_read_tells_the_truth() {
        let f = Fixture::new();
        let vault = f.vault();
        vault.set_for(A, "s1", "a.one", now());
        f.refuse.writes.store(true, Ordering::SeqCst);
        vault.set_for(A, "s2", "a.two", now());
        vault.set_for(A, "s1", "a.rotated", now());
        // Nothing held anywhere but the keychain: s2 is not there, and s1 is
        // what the keychain still has.
        assert_eq!(vault.get_for(A, "s2"), None);
        assert_eq!(vault.get_for(A, "s1").as_deref(), Some("a.one"));
        assert!(!f.disk().contains("a.two"));
        assert_eq!(f.told(), 1, "told once, however often it fails");
        f.refuse.writes.store(false, Ordering::SeqCst);
        vault.set_for(A, "s2", "a.two", now());
        assert_eq!(vault.get_for(A, "s2").as_deref(), Some("a.two"));
    }

    #[test]
    fn a_keychain_that_will_not_answer_reads_as_nothing_and_says_so_once() {
        let f = Fixture::new();
        let vault = f.vault();
        vault.set_for(A, "s1", "a.one", now());
        vault.set(A, "legacy");
        f.refuse.all.store(true, Ordering::SeqCst);
        assert_eq!(vault.get_for(A, "s1"), None);
        assert_eq!(vault.get(A), None);
        assert_eq!(vault.adopt(A, "s2", now()), None);
        vault.clear_for(A, "s1");
        // A delete that failed keeps the login listed, to be found again.
        assert_eq!(f.indexed(A), vec!["s1".to_string()]);
        assert_eq!(f.told(), 1);
        f.refuse.all.store(false, Ordering::SeqCst);
        assert_eq!(vault.get_for(A, "s1").as_deref(), Some("a.one"));
    }

    #[test]
    fn no_store_at_all_stores_nothing_and_writes_nothing_to_disk() {
        let f = Fixture::new();
        let vault = f.vault_with(None);
        assert!(!vault.has_store());
        vault.set_for(A, "s1", "a.one", now());
        vault.set(A, "legacy");
        assert_eq!(vault.get_for(A, "s1"), None);
        assert_eq!(vault.get(A), None);
        assert_eq!(vault.adopt(A, "s1", now()), None);
        assert_eq!(f.disk(), "");
        // The shell tells the user at start; the calls do not repeat it.
        assert_eq!(f.told(), 0);
        vault.tell_unavailable();
        vault.tell_unavailable();
        assert_eq!(f.told(), 1);
    }

    /// The notice is never shown under the lock: a callback that calls back
    /// into the vault (as a UI run loop could) finishes instead of hanging.
    #[test]
    fn the_notice_runs_after_the_lock_is_released() {
        let f = Fixture::new();
        let slot: Arc<Mutex<Option<Arc<Vault>>>> = Arc::new(Mutex::new(None));
        let inner = slot.clone();
        let reentered = Arc::new(AtomicBool::new(false));
        let flag = reentered.clone();
        let store = Arc::new(Flaky {
            inner: f.store.clone(),
            refuse: f.refuse.clone(),
        });
        let vault = Arc::new(Vault::new(
            SERVICE,
            &f.dir,
            Some(store as Arc<CredentialStore>),
            Box::new(move || {
                let vault = inner.lock().unwrap().clone().unwrap();
                let _ = vault.get_for(A, "s1");
                flag.store(true, Ordering::SeqCst);
            }),
            false,
        ));
        *slot.lock().unwrap() = Some(vault.clone());
        f.refuse.writes.store(true, Ordering::SeqCst);
        let (done_tx, done_rx) = std::sync::mpsc::channel();
        let worker = vault.clone();
        std::thread::spawn(move || {
            worker.set_for(A, "s1", "a.one", now());
            let _ = done_tx.send(());
        });
        assert!(
            done_rx
                .recv_timeout(std::time::Duration::from_secs(5))
                .is_ok(),
            "the vault deadlocked on its own notice"
        );
        assert!(reentered.load(Ordering::SeqCst));
        *slot.lock().unwrap() = None;
    }
}
